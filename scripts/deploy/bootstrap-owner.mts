import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { migrationDatabaseUrl } from "../../src/lib/config/deploy-env.ts";
import { createPostgresDatabase } from "../../src/lib/db/postgres.ts";
import { BOOTSTRAP_ORGANIZATION, bootstrapOwner, isPlausibleEmail, type BootstrapResult } from "../../src/lib/deploy/bootstrap-owner.ts";
import { lueYmparistoArvo } from "../../src/lib/auth/tenant-setup.ts";

/**
 * Tuotantokannan ensimmäinen organisaatio (Adepta Oy) ja pääkäyttäjä.
 * Logiikka ja perustelu: src/lib/deploy/bootstrap-owner.ts. Ohje: auth0/AJO-OHJE.md, kohta 9.
 *
 *   npx vercel env pull .env.production.local --environment production
 *   npx tsx scripts/deploy/bootstrap-owner.mts --email etunimi.sukunimi@adepta.fi          kuivaharjoitus
 *   npx tsx scripts/deploy/bootstrap-owner.mts --email etunimi.sukunimi@adepta.fi --aja    kirjoittaa
 *
 * Valinnaiset: --ymparisto <tiedosto> (oletus .env.production.local),
 * --osoite <perusosoite kutsulinkkiin> (oletus tiedoston APP_BASE_URL tai https://www.erappu.fi).
 *
 * Kanta luetaan VAIN annetusta tiedostosta, ei prosessin ympäristöstä: kohde on
 * se, mitä tiedostossa lukee, eikä jokin terminaaliin unohtunut muuttuja.
 * Kuivaharjoitus ajaa saman transaktion ja peruu sen, joten tuloste kertoo
 * täsmälleen, mitä --aja tekisi.
 */

function arg(nimi: string): string | undefined {
  const i = process.argv.indexOf(nimi);
  return i === -1 ? undefined : process.argv[i + 1];
}

class Peruttu extends Error {
  constructor(readonly tulos: BootstrapResult) {
    super("kuivaharjoitus");
  }
}

async function ajo(): Promise<void> {
  const aja = process.argv.includes("--aja");
  const email = arg("--email");
  const tiedosto = arg("--ymparisto") ?? ".env.production.local";

  if (!email || !isPlausibleEmail(email)) throw new Error("Anna pääkäyttäjän sähköposti: --email etunimi.sukunimi@adepta.fi");
  if (!existsSync(tiedosto)) {
    throw new Error(`${tiedosto} puuttuu. Hae tuotannon muuttujat: npx vercel env pull ${tiedosto} --environment production`);
  }

  // Tiedostossa on tuotannon salaisuudet; se ei saa päätyä gittiin.
  const ignore = spawnSync("git", ["check-ignore", "-q", tiedosto], { encoding: "utf8" });
  if (ignore.status === 1) throw new Error(`${tiedosto} ei ole .gitignoressa. Lisää se ennen ajoa, ja poista tiedosto ajon jälkeen.`);

  const sisalto = readFileSync(tiedosto, "utf8");
  const env: Record<string, string | undefined> = {};
  for (const nimi of ["DATABASE_URL_DIRECT", "POSTGRES_URL_NON_POOLING", "DATABASE_URL", "POSTGRES_URL", "APP_BASE_URL"]) {
    env[nimi] = lueYmparistoArvo(sisalto, nimi) ?? undefined;
  }
  const url = migrationDatabaseUrl(env);
  if (!url) throw new Error(`${tiedosto}: tietokantayhteys puuttuu (POSTGRES_URL_NON_POOLING, DATABASE_URL tai POSTGRES_URL).`);
  const baseUrl = arg("--osoite") ?? env.APP_BASE_URL ?? "https://www.erappu.fi";

  const kohde = new URL(url);
  console.log("");
  console.log(`Kanta: ${kohde.hostname}${kohde.pathname} (tiedostosta ${tiedosto})`);
  console.log(`Organisaatio: ${BOOTSTRAP_ORGANIZATION.name} (${BOOTSTRAP_ORGANIZATION.businessId})`);
  console.log(`Pääkäyttäjä: ${email}`);
  console.log(aja ? "Tila: KIRJOITETAAN" : "Tila: kuivaharjoitus, muutokset perutaan");
  console.log("");

  const db = createPostgresDatabase(url);
  let tulos: BootstrapResult;
  try {
    const [skeema] = await db.asService((tx) => tx.query<{ ok: string | null }>("select to_regclass('public.er_invitations')::text as ok"));
    if (!skeema?.ok) throw new Error("Kannasta puuttuvat eRapun taulut. Aja migraatiot ensin (tuotantojulkaisu tai npm run db:migrate:remote).");

    try {
      tulos = await db.asService(async (tx) => {
        const r = await bootstrapOwner(tx, { email, baseUrl });
        if (!aja) throw new Peruttu(r);
        return r;
      });
    } catch (virhe) {
      if (!(virhe instanceof Peruttu)) throw virhe;
      tulos = virhe.tulos;
    }
  } finally {
    await db.close();
  }

  const verbi = aja ? "" : " (tehtäisiin)";
  console.log(tulos.organizationCreated ? `Organisaatio luotu${verbi}.` : "Organisaatio oli jo olemassa.");

  switch (tulos.owner.status) {
    case "already_owner":
      console.log("Käyttäjä on jo organisaation pääkäyttäjä. Ei muutoksia.");
      break;
    case "other_role":
      console.log(`Käyttäjä on jo jäsen roolilla ${tulos.owner.role}. Roolia ei muuteta skriptillä; vaihda se sovelluksen asetuksista.`);
      break;
    case "not_staff_login":
      console.log("Osoitteella on jo tunnus, joka on syntynyt sähköpostikoodikirjautumisella (portaali). Pääkäyttäjän roolia ei anneta sille, koska MFA vaaditaan vain henkilökunnan kirjautumiselta. Ei muutoksia.");
      break;
    case "member_added":
      console.log(`Käyttäjä oli jo kirjautunut kerran. Pääkäyttäjän jäsenyys lisätty${verbi}.`);
      break;
    case "invited":
      console.log(`Pääkäyttäjän kutsu luotu${verbi}, voimassa 14 päivää.`);
      if (aja) {
        console.log("");
        console.log("Kutsulinkki (henkilökohtainen, älä jaa):");
        console.log(`  ${tulos.owner.url}`);
        console.log("");
        console.log("Avaa linkki, kirjaudu henkilökuntana samalla sähköpostilla ja hyväksy kutsu.");
      } else {
        console.log("Linkki tulostetaan vasta --aja-ajossa.");
      }
      break;
  }
  console.log("");
  console.log(`Poista ${tiedosto}, kun olet valmis: siinä on tuotannon salaisuudet.`);
}

try {
  await ajo();
} catch (virhe) {
  console.error("");
  console.error(virhe instanceof Error ? virhe.message : String(virhe));
  console.error("");
  process.exitCode = 1;
}
