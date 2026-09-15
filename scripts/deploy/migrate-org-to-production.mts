import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import pg from "pg";
import { migrationDatabaseUrl, stripSslMode, supabaseHeaders, supabaseSecretKey } from "../../src/lib/config/deploy-env.ts";
import {
  applyMigrationPlan,
  buildMigrationPlan,
  checkFiles,
  existingOrgRows,
  ExistingDataError,
  MigrationError,
  productionEnv,
  summarizePlan,
  uploadFiles,
  type ApplyResult,
  type RawSql,
} from "../../src/lib/deploy/migrate-org.ts";

/**
 * Adepta Oy:n datan siirto paikallisesta kannasta tuotantoon.
 * Logiikka ja perustelut: src/lib/deploy/migrate-org.ts.
 *
 *   npx tsx scripts/deploy/migrate-org-to-production.mts --lahde %TEMP%\erappu-pglite-migrate          kuivaharjoitus
 *   npx tsx scripts/deploy/migrate-org-to-production.mts --lahde %TEMP%\erappu-pglite-migrate --aja    kirjoittaa
 *
 * Valinnaiset:
 *   --lahde <hakemisto>          PGlite-hakemisto (oletus .data/pglite; kehityspalvelin ei saa olla käynnissä)
 *   --tiedostot <hakemisto>      paikallinen tiedostovarasto (oletus .data/files)
 *   --ymparisto <tiedosto>       tuotannon muuttujat (oletus .env.production.local)
 *   --kayttaja <sähköposti>      paikallinen käyttäjä, joka kartoitetaan tuotannon pääkäyttäjään (oletus jukka.taskinen@adepta.fi)
 *   --ohita <taulu,taulu>        lisää poissuljettavia tauluja
 *   --korvaa-org-data            poistaa tuotannon organisaatiodatan ensin (organisaatio, käyttäjä, jäsenyys ja kutsu säilyvät)
 *   --salli-puuttuvat-tiedostot  --aja ei kieltäydy, vaikka jokin dokumentin tiedosto puuttuu levyltä
 *
 * Kuivaharjoitus tekee kaikki lisäykset tuotantoon yhdessä transaktiossa,
 * tarkistaa rivimäärät, viite-eheyden ja RLS-näkyvyyden ja peruu transaktion.
 * Tiedostoista se vain listaa. --aja lataa tiedostot ensin (upsert) ja
 * hyväksyy sitten saman transaktion.
 */

const BUSINESS_ID = "2237131-2";
const DEFAULT_USER_EMAIL = "jukka.taskinen@adepta.fi";
const DEV_SERVER_PORT = 3107;

function arg(nimi: string): string | undefined {
  const i = process.argv.indexOf(nimi);
  return i === -1 ? undefined : process.argv[i + 1];
}

function portOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.connect({ host: "127.0.0.1", port });
    s.setTimeout(500);
    s.once("connect", () => (s.destroy(), resolve(true)));
    s.once("timeout", () => (s.destroy(), resolve(false)));
    s.once("error", () => resolve(false));
  });
}

async function ajo(): Promise<void> {
  const aja = process.argv.includes("--aja");
  const korvaa = process.argv.includes("--korvaa-org-data");
  const salliPuuttuvat = process.argv.includes("--salli-puuttuvat-tiedostot");
  const tiedosto = arg("--ymparisto") ?? ".env.production.local";
  const oletusLahde = path.resolve(".data/pglite");
  const lahde = path.resolve(arg("--lahde") ?? oletusLahde);
  const tiedostot = path.resolve(arg("--tiedostot") ?? ".data/files");
  const kayttaja = arg("--kayttaja") ?? DEFAULT_USER_EMAIL;
  const ohita = Object.fromEntries((arg("--ohita") ?? "").split(",").map((t) => t.trim()).filter(Boolean).map((t) => [t, "Poissuljettu komentoriviltä (--ohita)."]));

  if (!existsSync(tiedosto)) throw new Error(`${tiedosto} puuttuu. Hae tuotannon muuttujat: npx vercel env pull ${tiedosto} --environment production`);
  // Tiedostossa on tuotannon salaisuudet; se ei saa päätyä gittiin.
  const ignore = spawnSync("git", ["check-ignore", "-q", tiedosto], { encoding: "utf8" });
  if (ignore.status === 1) throw new Error(`${tiedosto} ei ole .gitignoressa. Lisää se ennen ajoa, ja poista tiedosto ajon jälkeen.`);

  if (!existsSync(path.join(lahde, "PG_VERSION"))) throw new Error(`${lahde} ei ole PGlite-hakemisto.`);
  if (lahde === oletusLahde && (await portOpen(DEV_SERVER_PORT))) {
    throw new Error(
      `Kehityspalvelin näyttää olevan käynnissä (portti ${DEV_SERVER_PORT}), ja se pitää kannan .data/pglite auki. ` +
        "Pysäytä palvelin tai kopioi kanta ja anna kopio: --lahde %TEMP%\\erappu-pglite-migrate",
    );
  }

  const env = productionEnv(readFileSync(tiedosto, "utf8"));
  const url = migrationDatabaseUrl(env);
  if (!url) throw new Error(`${tiedosto}: tietokantayhteys puuttuu (POSTGRES_URL_NON_POOLING tai DATABASE_URL, muotoa postgres://).`);
  const supabaseUrl = env.SUPABASE_URL;
  const secretKey = supabaseSecretKey(env);
  const storageOngelma = !supabaseUrl
    ? "SUPABASE_URL puuttuu tai on paikkamerkki (arvon on alettava https://)"
    : !secretKey
      ? "SUPABASE_SECRET_KEY puuttuu tai on paikkamerkki (arvon on alettava sb_secret_)"
      : null;

  const kohde = new URL(url);
  console.log("");
  console.log(`Lähde: ${lahde}`);
  console.log(`Tiedostot: ${tiedostot}`);
  console.log(`Kohde: ${kohde.hostname}${kohde.pathname} (tiedostosta ${tiedosto})`);
  console.log(aja ? "Tila: KIRJOITETAAN" : "Tila: kuivaharjoitus, muutokset perutaan");
  if (korvaa) console.log("Tuotannon nykyinen organisaatiodata poistetaan ensin (--korvaa-org-data).");
  console.log("");

  const source = await PGlite.create({ dataDir: lahde, extensions: { btree_gist } });
  const client = new pg.Client({ connectionString: stripSslMode(url), ssl: { rejectUnauthorized: false } });
  await client.connect();
  const sourceSql: RawSql = { query: async (t, p) => (await source.query(t, p as never[])).rows as never[] };
  const targetSql: RawSql = { query: async (t, p) => (await client.query(t, p)).rows };

  const raportti: string[] = [];
  let tulos: ApplyResult | null = null;
  try {
    const [skeema] = await targetSql.query<{ ok: string | null }>("select to_regclass('public.er_housing_companies')::text as ok");
    if (!skeema?.ok) throw new Error("Kohdekannasta puuttuvat eRapun taulut. Aja migraatiot ensin.");

    console.log("Luetaan lähde ja muodostetaan siirtosuunnitelma...");
    const plan = await buildMigrationPlan(sourceSql, targetSql, { businessId: BUSINESS_ID, sourceUserEmail: kayttaja, sourceUserAuthSub: "dev|jukka", excludeTables: ohita });
    console.log(`Organisaatio ${plan.organizationName} (${BUSINESS_ID}): paikallinen ${plan.sourceOrgId} → tuotanto ${plan.targetOrgId}`);

    const files = await checkFiles(plan, tiedostot);
    let bucket = "ei tarkistettu";
    if (storageOngelma) {
      console.log(`Tiedostovaihe: ${storageOngelma}. Lisää arvo tiedostoon ${tiedosto} ennen --aja-ajoa.`);
    } else {
      const res = await fetch(`${supabaseUrl!.replace(/\/+$/, "")}/storage/v1/bucket/documents`, { headers: supabaseHeaders(secretKey!) });
      bucket = res.ok ? "documents on olemassa" : `documents ei vastaa (${res.status})`;
      console.log(`Tiedostovarasto: ${bucket}`);
    }

    if (aja) {
      if (storageOngelma) throw new Error(`Tiedostoja ei voi ladata: ${storageOngelma}. Mitään ei kirjoitettu.`);
      if (!bucket.startsWith("documents on")) throw new Error(`Bucket ${bucket}. Aja npm run db:migrate:remote SUPABASE_URL-arvon kanssa. Mitään ei kirjoitettu.`);
      if (files.missing.length && !salliPuuttuvat) {
        throw new Error(`${files.missing.length} dokumentin tiedosto puuttuu levyltä. Tarkista kuivaharjoituksen luettelo tai käytä --salli-puuttuvat-tiedostot. Mitään ei kirjoitettu.`);
      }
      const olemassa = await existingOrgRows(targetSql, plan);
      if (olemassa.length && !korvaa) throw new ExistingDataError(olemassa);

      const ladattavat = plan.files.filter((f) => !files.missing.includes(f));
      console.log(`Ladataan ${ladattavat.length} tiedostoa...`);
      const up = await uploadFiles(ladattavat, {
        filesRoot: tiedostot,
        supabaseUrl: supabaseUrl!,
        secretKey: secretKey!,
        onProgress: (n, kaikki) => {
          if (n % 10 === 0 || n === kaikki) console.log(`  ${n}/${kaikki}`);
        },
      });
      console.log(`Tiedostot ladattu: ${up.uploaded} kpl, ${(up.bytes / (1024 * 1024)).toFixed(1)} Mt.`);
    }

    console.log(aja ? "Kirjoitetaan kanta..." : "Kokeillaan kirjoitus tuotantoon transaktiossa (perutaan)...");
    tulos = await applyMigrationPlan(targetSql, plan, { commit: aja, replaceExisting: korvaa });

    raportti.push(
      `# Tuotantosiirto ${new Date().toISOString().slice(0, 10)}: ${plan.organizationName}`,
      "",
      `- Tila: ${aja ? "--aja" : "kuivaharjoitus"}${korvaa ? " --korvaa-org-data" : ""}`,
      `- Kohde: ${kohde.hostname}`,
      `- Organisaatio: paikallinen ${plan.sourceOrgId} → tuotanto ${plan.targetOrgId}`,
      `- Tiedostovarasto: ${storageOngelma ?? bucket}`,
      "",
      ...summarizePlan(plan, files, tulos),
    );
    console.log("");
    console.log(raportti.join("\n"));
    console.log("");

    if (tulos.errors.length) {
      process.exitCode = 1;
      console.log("Kuivaharjoituksessa oli virheitä (yllä). Korjaa ennen --aja-ajoa.");
    } else if (!aja) {
      console.log("Kuivaharjoitus onnistui, ja kaikki muutokset peruttiin.");
      console.log(`Oikea ajo: npx tsx scripts/deploy/migrate-org-to-production.mts --lahde "${lahde}" --aja${korvaa ? " --korvaa-org-data" : ""}`);
    }

    if (aja && tulos.committed) {
      const polku = path.join("data", "private", `production-migration-${new Date().toISOString().slice(0, 10)}.md`);
      await mkdir(path.dirname(polku), { recursive: true });
      await writeFile(polku, raportti.join("\n") + "\n", "utf8");
      console.log(`Siirto valmis. Raportti: ${polku}`);
    }
    console.log(`Poista ${tiedosto}, kun olet valmis: siinä on tuotannon salaisuudet.`);
  } finally {
    await client.end().catch(() => undefined);
    await source.close().catch(() => undefined);
  }
}

try {
  await ajo();
} catch (virhe) {
  console.error("");
  console.error(virhe instanceof MigrationError || virhe instanceof Error ? virhe.message : String(virhe));
  console.error("");
  process.exitCode = 1;
}
