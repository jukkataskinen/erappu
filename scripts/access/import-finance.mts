import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { openLocalDb } from "../lib/local-db.mts";
import type { Sql } from "../../src/lib/db/types.ts";
import {
  checkCompanyTotals,
  mapCharges,
  mapLoans,
  planChargeSync,
  planLoanSync,
  trimPrice,
  type AccessChargeRow,
  type AccessFinanceCompany,
  type AccessFinanceUnit,
  type AccessLoanRow,
  type BasisOp,
  type DesiredBasis,
  type ExistingBasis,
  type ExistingLoan,
  type LoanOp,
} from "./finance-mapping.ts";

/**
 * Access → eRappu: vastikeperusteet ja lainat.
 *
 * Lähde: data/private/access-finance-export.json
 *   (powershell -File scripts/access/export-access.ps1 -VainTalous).
 * Kohde: Adepta Oy:n yhtiöt, jotka import-access.mts on luonut.
 *
 * Kuivaharjoitus oletuksena: muutokset ajetaan transaktiossa ja perutaan,
 * jolloin kannan rajoitteet tarkistuvat, mutta mitään ei jää. `--aja`
 * kirjoittaa. Vain Access-tuonnin rivejä (source 'migration') muutetaan.
 *
 *   npx tsx scripts/access/import-finance.mts [--aja] [--kanta <hakemisto>] [--vienti <json>]
 *
 * Kehityspalvelin pitää .data/pglite-kannan lukossa: pysäytä palvelin tai
 * anna --kanta kopioon.
 */

interface FinanceExport {
  exportedAt: string;
  missingClients: string[];
  inventory: { kind: "table" | "query"; name: string; rows: number | null; columns: string[]; sql: string | null }[];
  companies: AccessFinanceCompany[];
  units: AccessFinanceUnit[];
  charges: AccessChargeRow[];
  loans: AccessLoanRow[];
}

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const write = args.includes("--aja");
const dataDir = flag("--kanta");
const ROOT = process.cwd();
const exportPath = flag("--vienti") ?? path.join(ROOT, "data", "private", "access-finance-export.json");
const reportPath = path.join(ROOT, "data", "private", "access-finance-report.md");
const today = new Date().toISOString().slice(0, 10);

const data = JSON.parse((await readFile(exportPath, "utf8")).replace(/^﻿/, "")) as FinanceExport;

const UNIT: Record<string, string> = { area_m2: "€/m²/kk", share: "€/osake/kk", unit: "€/kpl/kk", person: "€/hlö/kk", meter: "€/yks.", fixed: "€/kk" };
const eur = (v: string | number | null) => (v === null ? "-" : `${Number(v).toLocaleString("fi-FI", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`);
const span = (b: Pick<DesiredBasis, "startsOn" | "endsOn">) => `${b.startsOn} – ${b.endsOn ?? "voimassa"}`;

class DryRun extends Error {}

const out: string[] = [];
const say = (line = "") => {
  out.push(line);
  console.log(line);
};

const totals = { companies: 0, basesInsert: 0, basesUpdate: 0, basesKeep: 0, basesDelete: 0, loansInsert: 0, loansUpdate: 0, loansKeep: 0, loansDelete: 0, skipped: 0 };

say(`# Access-talousosuuden tuonti${write ? "" : " (kuivaharjoitus)"}`);
say();
say(`Vienti ${data.exportedAt}, ajo ${new Date().toISOString()}. ${write ? "Muutokset kirjoitettiin kantaan." : "Kuivaharjoitus: muutokset ajettiin transaktiossa ja peruttiin."} Kanta: ${dataDir ? "kopio (--kanta)" : ".data/pglite"}.`);
if (data.missingClients.length) say(`\n**Accessista puuttuvat asiakasyhtiöt:** ${data.missingClients.join(", ")}`);
const summaryAt = out.length;

say();
say("## Accessin laina- ja vastiketiedot");
say();
say("Taulut, joissa on laina- tai vastiketietoa (rivimäärä koko kannassa, kaikki yhtiöt):");
say();
const relevant = new Set(["Vastikkeet", "Lainat", "Yhtiöt", "asunnot", "Kulutustiedot"]);
for (const t of data.inventory.filter((i) => i.kind === "table" && relevant.has(i.name))) {
  const cols = t.name === "Yhtiöt" ? ["Yhtiön lainat", "Sama vastikeperuste", "Osakkeiden lukumäärä", "Huoneistoala"] : t.name === "asunnot" ? ["koko", "osakkeiden_määrä", "Hakeuduttu alv-velvolliseksi"] : t.columns;
  say(`- **${t.name}** (${t.rows} riviä): ${cols.join(", ")}`);
}
const queries = data.inventory.filter((i) => i.kind === "query");
if (queries.length) say(`- Kyselyt, jotka käyttävät näitä tauluja: ${queries.map((q) => q.name).join(", ")}. Ne eivät laske lainaosuuksia eivätkä rahoitusvastikkeita (hv_apu ja HV_nykyinen hakevat viimeisimmän hoitovastikkeen, master-kyselyt liittävät Lainat-rivin yhtiöön).`);
say("- Isännöitsijäntodistuksen raportissa \"Asuntoon kohdistuva lainaosuus\" ja \"Osakkeenomistajan vastikevelka\" ovat sidonnattomia kenttiä, jotka täytettiin käsin tulostettaessa. Niitä ei ole tallennettu.");
say("- Rahoitusvastikkeet näytettiin aliraportissa Vastikkeet-taulusta lajilla Rahoitusvastike.");

say();
say("## Kartoitus");
say();
say("| Access | eRappu | Huomio |");
say("|---|---|---|");
say("| Vastikkeet.Vastikelaji = Hoitovastike | er_charge_bases.charge_type 'maintenance', htj_charge_type 'hoitovastike', label 'Hoitovastike' | basis 'area_m2' (€/m²/kk, CLAUDE.md) |");
say("| Vastikkeet.Vastikelaji = Rahoitusvastike | er_charge_bases.charge_type 'financing' | Accessissa vain 0 € ilman päivää, ei tuotu |");
say("| Vastikkeet.Hoitovastike | er_charge_bases.unit_price | 4 desimaalia |");
say("| Vastikkeet.HV_Muutos_pvn | er_charge_bases.starts_on | ends_on = saman lajin seuraava muutospäivä − 1 pv |");
say("| Lainat.Yhtiön laina | er_loans.balance_eur (ja principal_eur, koska alkuperäinen pääoma puuttuu) | name 'Yhtiölaina', allocated false |");
say("| Lainat.Lainan pvm (teksti p.k.vvvv) | er_loans.balance_date | |");
say("| Lainat.Nostamattomat lainat, eur / pvm | er_loans.undrawn_eur / undrawn_estimated_on | kaikki 0 € |");
say("| Yhtiöt.Yhtiön lainat | ei tuoda | vanha kenttä, verrataan Lainat-tauluun |");
say("| Yhtiöt.Sama vastikeperuste | er_housing_companies.same_charge_basis | tuotu jo import-access.mts:ssä |");
say("| asunnot.koko, osakkeiden_määrä | er_share_groups.area_m2, osakevälit | tuotu jo; tässä vain summatarkistus |");
say("| asunnot.Hakeuduttu alv-velvolliseksi | ei saraketta | ei yhtään tosi-arvoa asiakasyhtiöissä |");
say();
say("**Ei Accessissa, ei tuotu:** lainanantaja, alkuperäinen pääoma, nostopäivä, eräpäivä, korko, viitekorko, marginaali, lyhennystapa, lainan laji, lainaosuudet osakeryhmittäin, lainaosuuksien poismaksut (kertasuoritukset), pääomavastike, erityisvastikkeet, käyttökorvaukset (vesi, sauna, autopaikka, laajakaista; Kulutustiedot-taulu on tyhjä), vastikepäätösten päivämäärät. Nämä täydennetään tilinpäätöksestä, lainasopimuksista ja yhtiökokousten pöytäkirjoista eRapun talousnäkymässä.");

const db = await openLocalDb(dataDir);
try {
  await db.asService(async (tx: Sql) => {
    const [org] = await tx.query<{ id: string }>("select id from er_organizations where business_id = '2237131-2'");
    if (!org) throw new Error("Adepta Oy puuttuu kannasta. Aja ensin npm run access:import.");
    const companies = await tx.query<{ id: string; name: string; access_id: string | null }>(
      "select id, name, extra->'access'->>'id' as access_id from er_housing_companies where organization_id = $1",
      [org.id],
    );

    for (const c of [...data.companies].sort((a, b) => a.Yhtiö.localeCompare(b.Yhtiö, "fi"))) {
      const target = companies.find((x) => x.access_id === String(c.ID)) ?? companies.find((x) => x.name === c.Yhtiö);
      say();
      say(`## ${c.Yhtiö}`);
      if (!target) {
        say("- Yhtiötä ei löydy eRapusta (Access-tunnisteella tai nimellä). Ei tuotu.");
        totals.skipped++;
        continue;
      }
      totals.companies++;
      const issues: string[] = [];

      // Vastikeperusteet
      const charges = mapCharges(data.charges.filter((r) => r.Yhtiö_id === c.ID), today);
      issues.push(...charges.issues);
      const existingBases = await tx.query<ExistingBasis>(
        `select b.id, b.charge_type, b.basis, b.unit_price::text, b.starts_on::text, b.ends_on::text, b.label, b.htj_charge_type, b.applies_to_kinds, b.source,
                exists (select 1 from er_billing_lines l where l.charge_basis_id = b.id) as referenced
           from er_charge_bases b where b.company_id = $1 order by b.charge_type, b.starts_on`,
        [target.id],
      );
      const chargePlan = planChargeSync(existingBases, charges.bases);
      issues.push(...chargePlan.notes);

      say();
      say("**Vastikeperusteet**");
      say();
      const opText: Record<BasisOp["op"], string> = { insert: "uusi", update: "päivitetään", keep: "ennallaan", delete: "poistetaan", retain: "jätetään" };
      for (const op of chargePlan.ops) {
        if (op.op === "delete" || op.op === "retain") {
          const e = op.existing;
          say(`- ${e.label ?? e.charge_type} ${trimPrice(Number(e.unit_price).toFixed(4))} ${UNIT[e.basis] ?? e.basis}, ${e.starts_on} – ${e.ends_on ?? "voimassa"}: ${opText[op.op]}${op.op === "retain" ? ` (${op.reason})` : " (ei enää Accessissa)"}`);
        } else {
          const d = op.desired;
          say(`- ${d.label} ${trimPrice(d.unitPrice)} ${UNIT[d.basis] ?? d.basis}, ${span(d)}: ${opText[op.op]}${op.op === "update" ? ` (${op.changes.join(", ")})` : ""}`);
        }
      }
      if (chargePlan.ops.length === 0) say("- Ei vastikeperusteita Accessissa.");
      const manualBases = existingBases.filter((b) => b.source !== "migration");
      if (manualBases.length) say(`- Käsin syötettyjä perusteita ${manualBases.length}, niitä ei muutettu.`);

      const [area] = await tx.query<{ area: string | null; missing: number; groups: number }>(
        "select sum(area_m2)::text as area, count(*) filter (where area_m2 is null)::int as missing, count(*)::int as groups from er_share_groups where company_id = $1",
        [target.id],
      );
      const current = charges.bases.filter((b) => b.chargeType === "maintenance" && b.startsOn <= today && (b.endsOn === null || b.endsOn >= today))[0];
      if (current && area?.area) {
        say(`- Hoitovastike nyt ${trimPrice(current.unitPrice)} €/m²/kk × ${trimPrice(Number(area.area).toFixed(4))} m² (${area.groups} osakeryhmää eRapussa) ≈ ${eur(Number(current.unitPrice) * Number(area.area))}/kk.`);
      }
      if (area && area.missing > 0) issues.push(`eRapussa ${area.missing} osakeryhmältä puuttuu pinta-ala, joten niille ei muodostu hoitovastiketta.`);

      for (const op of chargePlan.ops) {
        if (op.op === "delete") {
          await tx.query("delete from er_charge_bases where id = $1 and source = 'migration'", [op.id]);
          totals.basesDelete++;
        }
      }
      for (const op of chargePlan.ops) {
        if (op.op === "update") {
          const d = op.desired;
          await tx.query(
            `update er_charge_bases set unit_price = $2, ends_on = $3, basis = $4, label = $5, htj_charge_type = $6, applies_to_kinds = null
              where id = $1 and source = 'migration'`,
            [op.id, d.unitPrice, d.endsOn, d.basis, d.label, d.htjChargeType],
          );
          totals.basesUpdate++;
        } else if (op.op === "insert") {
          const d = op.desired;
          await tx.query(
            `insert into er_charge_bases (organization_id, company_id, charge_type, label, basis, unit_price, starts_on, ends_on, htj_charge_type, source)
             values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'migration')`,
            [org.id, target.id, d.chargeType, d.label, d.basis, d.unitPrice, d.startsOn, d.endsOn, d.htjChargeType],
          );
          totals.basesInsert++;
        } else if (op.op === "keep") {
          totals.basesKeep++;
        }
      }

      // Lainat
      const loans = mapLoans(data.loans.filter((r) => r.YhtiöId === c.ID), c);
      issues.push(...loans.issues);
      const existingLoans = await tx.query<ExistingLoan>(
        `select l.id, l.name, l.principal_eur::text, l.balance_eur::text, l.balance_date::text, l.undrawn_eur::text, l.undrawn_estimated_on::text, l.purpose, l.allocated, l.source,
                (select count(*)::int from er_loan_shares s where s.loan_id = l.id) as share_count,
                exists (select 1 from er_billing_lines b where b.loan_id = l.id) as billed
           from er_loans l where l.company_id = $1 order by l.created_at`,
        [target.id],
      );
      const loanPlan = planLoanSync(existingLoans, loans.loans);
      issues.push(...loanPlan.notes);

      say();
      say("**Lainat**");
      say();
      const loanOpText: Record<LoanOp["op"], string> = { insert: "uusi", update: "päivitetään", keep: "ennallaan", delete: "poistetaan", retain: "jätetään", skip: "ei tuoda" };
      for (const op of loanPlan.ops) {
        if (op.op === "delete" || op.op === "retain") {
          const e = op.existing;
          say(`- ${e.name}, saldo ${eur(e.balance_eur)}${e.balance_date ? ` (${e.balance_date})` : ""}: ${loanOpText[op.op]}${op.op === "retain" ? ` (${op.reason})` : " (ei enää Accessissa)"}`);
          continue;
        }
        const d = op.desired;
        const allocated = op.op === "insert" || op.op === "update" ? op.fields.allocated : op.op === "keep" ? existingLoans.find((l) => l.id === op.id)?.allocated : false;
        say(`- ${d.name}: saldo ${eur(d.balanceEur)} päivällä ${d.balanceDate ?? "(puuttuu)"}, nostamatta ${eur(d.undrawnEur)}, ${allocated ? "jaettava" : "ei jaettava"}: ${loanOpText[op.op]}${op.op === "update" ? ` (${op.changes.join(", ")})` : op.op === "skip" ? ` (${op.reason})` : ""}`);
        say("  - lainanantaja, pääoma, korko, viitekorko, marginaali, eräpäivä ja lyhennystapa: ei Accessissa");
      }
      if (loanPlan.ops.length === 0) say("- Ei lainaa Accessissa.");
      const manualLoans = existingLoans.filter((l) => l.source !== "migration");
      if (manualLoans.length) say(`- Käsin syötettyjä lainoja ${manualLoans.length}, niitä ei muutettu.`);
      const shareRows = existingLoans.reduce((s, l) => s + l.share_count, 0);
      say(`- Lainaosuudet ja poismaksut: ei Accessissa. eRapussa lainaosuuksia nyt ${shareRows}.`);

      for (const op of loanPlan.ops) {
        if (op.op === "delete") {
          await tx.query("delete from er_loans where id = $1 and source = 'migration'", [op.id]);
          totals.loansDelete++;
        } else if (op.op === "update") {
          const f = op.fields;
          await tx.query(
            `update er_loans set name = $2, principal_eur = $3, balance_eur = $4, balance_date = $5, undrawn_eur = $6, undrawn_estimated_on = $7, purpose = $8, allocated = $9
              where id = $1 and source = 'migration'`,
            [op.id, f.name, f.principal_eur, f.balance_eur, f.balance_date, f.undrawn_eur, f.undrawn_estimated_on, f.purpose, f.allocated],
          );
          totals.loansUpdate++;
        } else if (op.op === "insert") {
          const f = op.fields;
          await tx.query(
            `insert into er_loans (organization_id, company_id, name, principal_eur, balance_eur, balance_date, undrawn_eur, undrawn_estimated_on, purpose, allocated, source)
             values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'migration')`,
            [org.id, target.id, f.name, f.principal_eur, f.balance_eur, f.balance_date, f.undrawn_eur, f.undrawn_estimated_on, f.purpose, f.allocated],
          );
          totals.loansInsert++;
        } else if (op.op === "keep") {
          totals.loansKeep++;
        }
      }

      // Summat
      issues.push(...checkCompanyTotals(c, data.units.filter((u) => u.Yhtiö === c.ID)).issues);

      say();
      say(issues.length ? "**Poikkeamat ja tarkistettavat**" : "**Poikkeamat:** ei havaintoja.");
      if (issues.length) say();
      for (const i of issues) say(`- ${i}`);
    }

    if (!write) throw new DryRun();
  });
} catch (e) {
  if (!(e instanceof DryRun)) {
    await db.close();
    throw e;
  }
}
await db.close();

const summary = `Yhtiöitä ${totals.companies}${totals.skipped ? ` (${totals.skipped} ei löytynyt)` : ""}. Vastikeperusteet: ${totals.basesInsert} uutta, ${totals.basesUpdate} päivitettyä, ${totals.basesKeep} ennallaan, ${totals.basesDelete} poistettua. Lainat: ${totals.loansInsert} uutta, ${totals.loansUpdate} päivitettyä, ${totals.loansKeep} ennallaan, ${totals.loansDelete} poistettua.`;
out.splice(summaryAt, 0, "", `**Yhteenveto${write ? "" : " (kuivaharjoitus, ei kirjoitettu)"}:** ${summary}`);
out.push(
  "",
  "## Yleistä",
  "- Lainat tuotiin ei-jaettavina: yhdelläkään lainalliselle yhtiölle ei ole Accessissa rahoitusvastiketta, joten lainat maksetaan ilmeisesti hoitovastikkeesta. Jos laina on jaettava, merkitse se jaettavaksi ja laske lainaosuudet lainan sivulla.",
  "- Pääomaksi merkittiin Accessin saldo, koska alkuperäistä pääomaa ei ole. Korjaa pääoma lainasopimuksesta; tuonti ei muuta pääomaa enää sen jälkeen, kun se poikkeaa saldosta.",
  "- Vastikepäätösten päivät (decided_on) puuttuvat. HTJ2-yhteenveto vaatii ne ennen ilmoitusta.",
);
await writeFile(reportPath, out.join("\n") + "\n", "utf8");
console.log();
console.log(summary);
console.log(`Raportti: ${path.relative(ROOT, reportPath)}${write ? "" : ". Kirjoita kantaan lipulla --aja."}`);
