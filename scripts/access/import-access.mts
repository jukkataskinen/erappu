import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { openLocalDb } from "../lib/local-db.mts";
import type { Sql } from "../../src/lib/db/types.ts";
import { parseShareRanges, checkCoverage, type ShareRange } from "../../src/lib/registry/share-ranges.ts";
import { toFraction, mapUnitKind, parsePropertyCode, splitPostal, repairWorkType, isCompanyName } from "./mapping.ts";

/**
 * Access → eRappu -tuonti (paikallinen kehityskanta).
 *
 * Lähde: data/private/access-export.json (scripts/access/export-access.ps1).
 * Kohde: organisaatio "Adepta Oy" ja sen 11 asiakasyhtiötä.
 *
 * Periaatteet:
 * - Henkilötunnuksia ei ole viennissä eikä niitä tuoda.
 * - Omistajat merkitään lähteeksi 'migration'. HTJ-synkronointi korvaa ne.
 * - Virheellisiä osakevälejä ei korjata arvaamalla: ne jätetään pois ja
 *   kirjataan laaturaporttiin korjattavaksi yhtiöjärjestyksestä.
 * - Raportti data/private/access-import-report.md ei sisällä henkilöiden nimiä.
 */

type Row = Record<string, unknown>;
interface Export {
  exportedAt: string;
  missingClients: string[];
  lookups: { katteet: Row[]; vakuutusyhtiot: Row[]; kiinteistonhoito: Row[] };
  companies: Row[];
  units: Row[];
  owners: Row[];
  residents: Row[];
  charges: Row[];
  loans: Row[];
  repairs: Row[];
  attachments: { companyId: number; field: string; unitId: number | null; file: string }[];
}

const ROOT = process.cwd();
const PRIVATE = path.join(ROOT, "data", "private");
const FILES = path.join(ROOT, ".data", "files");

const s = (v: unknown): string | null => (v === null || v === undefined || String(v).trim() === "" ? null : String(v).trim());
const n = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const x = typeof v === "number" ? v : Number(String(v).replace(",", "."));
  return Number.isFinite(x) ? x : null;
};
const b = (v: unknown) => v === true || v === -1 || v === "True" || v === "true";

const data = JSON.parse((await readFile(path.join(PRIVATE, "access-export.json"), "utf8")).replace(/^﻿/, "")) as Export;
const lookup = (rows: Row[], key: string, id: unknown) => s(rows.find((r) => r.ID === id)?.[key]);

const report: string[] = [];
const say = (line: string) => report.push(line);

const db = await openLocalDb();

await db.asService(async (tx: Sql) => {
  const [existing] = await tx.query<{ id: string }>("select id from er_organizations where business_id = '2237131-2'");
  if (existing) {
    console.error("Adepta Oy on jo kannassa. Aja ensin npm run db:reset (poistaa myös demodatan), sitten tuonti uudelleen.");
    process.exitCode = 1;
    return;
  }

  const [org] = await tx.query<{ id: string }>("insert into er_organizations (name, business_id, settings) values ('Adepta Oy', '2237131-2', $1) returning id", [
    JSON.stringify({ note: "Isännöinti. Tuotu Accessista." }),
  ]);
  const user = async (sub: string, email: string, name: string, role: string) => {
    const [u] = await tx.query<{ id: string }>("insert into er_users (auth_sub, email, full_name) values ($1,$2,$3) returning id", [sub, email, name]);
    await tx.query("insert into er_org_members (organization_id, user_id, role) values ($1,$2,$3)", [org.id, u.id, role]);
    return u.id;
  };
  const jukka = await user("dev|jukka", "jukka.taskinen@adepta.fi", "Jukka Taskinen", "owner");
  await user("dev|adepta-kirjanpitaja-1", "kirjanpitaja1@adepta.invalid", "Kirjanpitäjä 1", "accountant");
  await user("dev|adepta-kirjanpitaja-2", "kirjanpitaja2@adepta.invalid", "Kirjanpitäjä 2", "accountant");

  say(`# Access-tuonnin laaturaportti`);
  say(``);
  say(`Vienti ${data.exportedAt}, tuonti ${new Date().toISOString()}. Organisaatio Adepta Oy, ${data.companies.length} yhtiötä.`);
  if (data.missingClients.length) say(`\n**Accessista puuttuvat asiakasyhtiöt:** ${data.missingClients.join(", ")}`);
  say(``);
  say(`Henkilötunnuksia ei tuotu. Omistajatiedot on merkitty lähteeksi Access, ja HTJ-synkronointi korvaa ne. Kirjanpitäjien tunnukset ovat paikkamerkkejä (Kirjanpitäjä 1 ja 2), vaihda nimet ja sähköpostit asetuksista.`);

  const companyIds = new Map<number, string>();
  const unitIds = new Map<string, string>(); // `${accessCompanyId}:${Kenttä1}` → share_group_id
  const unitByLabel = new Map<string, string>(); // `${accessCompanyId}:${label}`
  const unitByAccessId = new Map<number, string>();
  const totals = { units: 0, ranges: 0, rangeIssues: 0, owners: 0, parties: 0, residents: 0, charges: 0, loans: 0, works: 0, needs: 0, docs: 0 };

  for (const c of data.companies) {
    const accessId = Number(c.ID);
    const name = s(c["Yhtiö"])!;
    const issues: string[] = [];
    const [pc, pcRaw] = [parsePropertyCode(s(c["Kiinteistötunnus"])), s(c["Kiinteistötunnus"])];

    const redemption = {
      company: b(c.Lun_yhtiö), shareholder: b(c.Lun_Osakas), other: b(c.Lun_muu), municipality_hitas: b(c.Lun_hitas),
      municipality_law: b(c.Lun_laki) || b(c.Lun_kun), widow_right: b(c.Lesken_hallinta), other_restriction: b(c.Muu_rajoitus),
    };
    const extra = {
      access: {
        id: accessId,
        asuntojen_lkm: n(c["Asuntojen lkm"]),
        pinta_ala: n(c["Pinta-ala"]),
        rakennusten_lukumaara: n(c["Rakennusten lukumäärä"]),
        osakekirjat_turvapainossa: b(c["Osakekirjat painettava turvapainossa"]),
        huoneistoselitelmaa_ei_muutettu: b(c["Huoneistoselitelmää ei ole muutettu"]),
        kiinteistotunnus_alkuperainen: pcRaw,
      },
      significant_defects: [] as string[],
    };

    const [row] = await tx.query<{ id: string }>(
      `insert into er_housing_companies (organization_id, name, business_id, company_form, street_address, postal_code, city, articles_date,
         total_shares, manager_user_id, same_charge_basis, insurance_company, insurance_type, property_maintenance, commercial_register_note,
         redemption_clause, extra)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) returning id`,
      [org.id, name, s(c["Y-Tunnus"]) ?? `ACCESS-${accessId}`, /^koy\b/i.test(name) ? "koy" : "asunto_oy", s(c.Osoite),
        c.Postinumero == null ? null : String(c.Postinumero).padStart(5, "0"), s(c.Postitoimipaikka), s(c["Yhtiöjärjestyksen pvm"]),
        n(c["Osakkeiden lukumäärä"]), jukka, b(c["Sama vastikeperuste"]),
        lookup(data.lookups.vakuutusyhtiot, "Vakuutusyhtiö", c["Vakuutusyhtiö"]), s(c.Vakuutustyyppi),
        lookup(data.lookups.kiinteistonhoito, "Hoitomuoto", c["Kiinteistönhoito"]), s(c["Kaupparekisterimerkinnän pvm ja rek nro"]),
        JSON.stringify(redemption), JSON.stringify(extra)],
    );
    const companyId = row.id;
    companyIds.set(accessId, companyId);
    if (!s(c["Y-Tunnus"])) issues.push("Y-tunnus puuttuu (tilapäinen tunnus ACCESS-…).");

    await tx.query(
      `insert into er_properties (organization_id, company_id, property_code, tenure, area_m2, parking_spaces_planned, parking_spaces_built, unused_building_rights_m2, lease_ends_on, annual_rent_eur, rent_review_basis)
       values ($1,$2,$3,$4,$5,$6,$7,$8,null,$9,$10)`,
      [org.id, companyId, pc ?? pcRaw ?? "puuttuu", /vuokra/i.test(s(c["Oma/vuokratontti"]) ?? "") ? "lease" : "own", n(c["Tontin pinta-ala"]) || null,
        n(c["Autopaikat kaavassa"]), n(c["Autopaikat toteutuneet"]), n(c["Käyttämätön rakennusoikeus"]),
        n(c["Vuokran määrä/vuosi"]) || null, s(c["Vuokran tarkistusperuste"]) === "-" ? null : s(c["Vuokran tarkistusperuste"])],
    );
    if (!pc) issues.push(`Kiinteistötunnus ei ole tunnistettavassa muodossa ("${pcRaw ?? "puuttuu"}"). Tarkista kiinteistörekisteristä.`);

    const spaces = [["Sauna", "sauna"], ["Pesutupa", "pesutupa"], ["Mankeli", "mankeli"], ["Kerhohuone", "kerhohuone"], ["Askasteluhuone", "askarteluhuone"], ["Ulkoiluvälinevarasto", "ulkoiluvälinevarasto"]]
      .filter(([k]) => b(c[k])).map(([, v]) => v);
    const [building] = await tx.query<{ id: string }>(
      `insert into er_buildings (organization_id, company_id, label, building_type, completed_year, floors, staircases, elevators, floor_area_m2, apartment_area_m2,
         volume_m3, construction_material, roof_type, roof_material, heating, ventilation, antenna, energy_certificate_year, common_spaces)
       values ($1,$2,$3,$4,$5,$6,$7,coalesce($8,0),$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) returning id`,
      [org.id, companyId, (n(c["Rakennusten lukumäärä"]) ?? 1) > 1 ? `${n(c["Rakennusten lukumäärä"])} rakennusta` : null, s(c.Talotyyppi),
        n(c.Valmistumisvuosi), n(c.Kerrosluku), n(c.Porraskäytävät), n(c.Hissit), n(c.Kerrosala) || null, n(c.Huoneistoala) || null, n(c.tilavuus) || null,
        s(c.Rakennusaine), s(c.Kattotyyppi), lookup(data.lookups.katteet, "Katemateriaali", c["Katon katemateriaali"]), s(c["Lämmitysjärjestelmä"]),
        s(c.Ilmanvaihto), s(c["Antennijärjestelmä"]) === "-" ? null : s(c["Antennijärjestelmä"]), n(c["Energiatodistus vuodelta"]), spaces],
    );
    if ((n(c["Rakennusten lukumäärä"]) ?? 1) > 1) issues.push(`Yhtiössä on ${n(c["Rakennusten lukumäärä"])} rakennusta, Accessissa tiedot yhteisinä. Jaa rakennuksittain.`);

    // Osakeryhmät ja osakevälit
    const units = data.units.filter((u) => Number(u["Yhtiö"]) === accessId);
    const coverage: { unitLabel: string; ranges: ShareRange[] }[] = [];
    for (const u of units) {
      const label = s(u.Asunnon_nro) ?? `?${u.ID}`;
      const [g] = await tx.query<{ id: string }>(
        `insert into er_share_groups (organization_id, company_id, building_id, unit_label, kind, layout, floor, area_m2, intended_use, is_rented, source)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'migration') returning id`,
        [org.id, companyId, building.id, label, mapUnitKind(s(u["Käyttötarkoitus"])), s(u["Asunnon tyyppi"]), s(u.Asunnon_kerros), n(u.koko), s(u["Käyttötarkoitus"]), b(u.Vuokrattu)],
      );
      totals.units++;
      unitIds.set(`${accessId}:${n(u.Kenttä1)}`, g.id);
      unitByLabel.set(`${accessId}:${label}`, g.id);
      unitByAccessId.set(Number(u.ID), g.id);

      const text = s(u.Osakkeet_numerot);
      const accepted: ShareRange[] = [];
      if (!text) {
        issues.push(`Huoneisto ${label}: osakenumerot puuttuvat.`);
      } else {
        const parsed = parseShareRanges(text);
        for (const e of parsed.errors) issues.push(`Huoneisto ${label}: ${e}`);
        for (const r of parsed.ranges) {
          await tx.query("savepoint rng");
          try {
            await tx.query("insert into er_share_ranges (organization_id, company_id, share_group_id, first_share, last_share) values ($1,$2,$3,$4,$5)", [org.id, companyId, g.id, r.first, r.last]);
            await tx.query("release savepoint rng");
            accepted.push(r);
            totals.ranges++;
          } catch {
            await tx.query("rollback to savepoint rng");
            issues.push(`Huoneisto ${label}: väli ${r.first}–${r.last} menee päällekkäin toisen huoneiston kanssa, jätettiin pois.`);
            totals.rangeIssues++;
          }
        }
        const count = parsed.ranges.reduce((sum, r) => sum + r.last - r.first + 1, 0);
        const declared = n(u["osakkeiden_määrä"]);
        if (declared !== null && parsed.errors.length === 0 && count !== declared) {
          issues.push(`Huoneisto ${label}: välissä ${text} on ${count} osaketta, Accessin osakemäärä ${declared}.`);
        }
      }
      coverage.push({ unitLabel: label, ranges: accepted });
    }
    for (const i of checkCoverage(coverage, n(c["Osakkeiden lukumäärä"]))) {
      if (i.kind !== "missing") issues.push(i.message);
    }

    // Omistajat
    const partyCache = new Map<string, string>();
    const partyFor = async (fullName: string, addr: { street: string | null; postal: string | null; city: string | null }, extraFields: { accountingNo?: string | null; phone?: string | null }) => {
      const key = `${fullName.toLowerCase()}|${(addr.street ?? "").toLowerCase()}`;
      const hit = partyCache.get(key) ?? partyCache.get(`${fullName.toLowerCase()}|`);
      if (hit) return hit;
      const kind = /kuolinpesä/i.test(fullName) ? "estate" : isCompanyName(fullName) ? "company" : "person";
      const [p] = await tx.query<{ id: string }>(
        `insert into er_parties (organization_id, kind, last_name, company_name, street_address, postal_code, city, phone, accounting_customer_no)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
        [org.id, kind, kind === "person" ? fullName : null, kind === "person" ? null : fullName, addr.street, addr.postal, addr.city, extraFields.phone ?? null, extraFields.accountingNo ?? null],
      );
      partyCache.set(key, p.id);
      totals.parties++;
      return p.id;
    };

    const ownersOfUnit = new Map<string, { name: string; partyId: string }[]>();
    const guessed = new Map<string, string[]>(); // share_group_id → ownership ids, joilta osuus puuttui
    let coOwnerNotes = 0;
    for (const o of data.owners.filter((x) => Number(x.Yhtiö_id) === accessId)) {
      const name = s(o.Omistaja);
      const gid = unitIds.get(`${accessId}:${n(o.Asunto_Id)}`);
      if (!name || !gid) {
        issues.push(`Omistusrivi ei kohdistu huoneistoon (Accessin huoneistoviite ${n(o.Asunto_Id) ?? "puuttuu"}).`);
        continue;
      }
      const partyId = await partyFor(name, { street: s(o.Osoite), postal: s(o.Postinumero)?.padStart(5, "0") ?? null, city: s(o.Postitoimipaikka) }, {
        accountingNo: o.asukasnumero_Tikon == null ? null : String(o.asukasnumero_Tikon),
      });
      const frac = toFraction(n(o.Om_osuus));
      const [own] = await tx.query<{ id: string }>(
        "insert into er_ownerships (organization_id, share_group_id, party_id, share_numerator, share_denominator, starts_on, source) values ($1,$2,$3,$4,$5,$6,'migration') returning id",
        [org.id, gid, partyId, frac.numerator, frac.denominator, s(o["Merkitty omistajarekisteriin"])],
      );
      totals.owners++;
      if (frac.guessed) guessed.set(gid, [...(guessed.get(gid) ?? []), own.id]);
      if (s(o["Omistaja 1"]) || s(o.Omistaja2)) coOwnerNotes++;
      const list = ownersOfUnit.get(gid) ?? [];
      list.push({ name: name.toLowerCase(), partyId });
      ownersOfUnit.set(gid, list);
    }
    // Jos kaikilta huoneiston omistajilta puuttui osuus, jaetaan tasan (2 omistajaa → 1/2 kumpikin).
    for (const [gid, ids] of guessed) {
      const [{ total }] = await tx.query<{ total: number }>("select count(*)::int as total from er_ownerships where share_group_id = $1", [gid]);
      const label = [...unitByLabel.entries()].find(([k, v]) => v === gid && k.startsWith(`${accessId}:`))?.[0].split(":")[1];
      if (total === ids.length && total > 1) {
        await tx.query("update er_ownerships set share_numerator = 1, share_denominator = $2 where share_group_id = $1", [gid, total]);
        issues.push(`Huoneisto ${label}: omistusosuudet puuttuivat, jaettiin tasan ${total} omistajalle (1/${total}).`);
      } else {
        issues.push(`Huoneisto ${label}: ${ids.length} omistajalta osuus puuttui, merkittiin kokonaiseksi.`);
      }
    }
    if (coOwnerNotes) issues.push(`${coOwnerNotes} omistusrivillä oli lisäksi kentät "Omistaja 1" tai "Omistaja2". Niitä ei tuotu erillisiksi omistajiksi; tarkista HTJ:stä.`);

    const sums = await tx.query<{ unit_label: string; s: string }>(
      `select g.unit_label, sum(o.share_numerator::numeric / o.share_denominator) as s from er_ownerships o join er_share_groups g on g.id = o.share_group_id
        where g.company_id = $1 group by g.unit_label having abs(sum(o.share_numerator::numeric / o.share_denominator) - 1) > 0.02`,
      [companyId],
    );
    for (const r of sums) issues.push(`Huoneisto ${r.unit_label}: omistusosuudet yhteensä ${Math.round(Number(r.s) * 100)} %.`);
    const noOwner = await tx.query<{ unit_label: string }>(
      "select unit_label from er_share_groups g where company_id = $1 and not exists (select 1 from er_ownerships o where o.share_group_id = g.id) order by unit_label",
      [companyId],
    );
    if (noOwner.length) issues.push(`Ei omistajaa: ${noOwner.map((r) => r.unit_label).join(", ")}.`);

    // Asukkaat
    for (const r of data.residents.filter((x) => Number(x["Yhtiö"]) === accessId)) {
      const name = s(r.Asukas);
      const gid = unitIds.get(`${accessId}:${n(r.Asunto)}`);
      if (!name) continue;
      if (!gid) {
        issues.push(`Asukasrivi ei kohdistu huoneistoon.`);
        continue;
      }
      const owners = ownersOfUnit.get(gid) ?? [];
      const ownerMatch = owners.find((o) => o.name === name.toLowerCase());
      const { postal, city } = splitPostal(s(r.Field81));
      const partyId = ownerMatch?.partyId ?? (await partyFor(name, { street: s(r.Field80), postal, city }, { phone: s(r.Field84) }));
      if (ownerMatch && s(r.Field84)) await tx.query("update er_parties set phone = coalesce(phone, $2) where id = $1", [ownerMatch.partyId, s(r.Field84)]);
      await tx.query("insert into er_residencies (organization_id, share_group_id, party_id, role) values ($1,$2,$3,$4)", [org.id, gid, partyId, ownerMatch ? "owner" : "tenant"]);
      totals.residents++;
    }

    // Vastikkeet
    const hv = data.charges
      .filter((x) => Number(x.Yhtiö_id) === accessId && /hoitovastike/i.test(s(x.Vastikelaji) ?? "") && s(x.HV_Muutos_pvn) && n(x.Hoitovastike) !== null)
      .sort((a, z) => String(a.HV_Muutos_pvn).localeCompare(String(z.HV_Muutos_pvn)));
    for (let i = 0; i < hv.length; i++) {
      const start = s(hv[i].HV_Muutos_pvn)!;
      const next = hv[i + 1] ? s(hv[i + 1].HV_Muutos_pvn) : null;
      const end = next ? new Date(Date.parse(next) - 86400000).toISOString().slice(0, 10) : null;
      await tx.query(
        `insert into er_charge_bases (organization_id, company_id, charge_type, basis, unit_price, starts_on, ends_on, htj_charge_type, source, label)
         values ($1,$2,'maintenance','area_m2',$3,$4,$5,'hoitovastike','migration','Hoitovastike')`,
        [org.id, companyId, n(hv[i].Hoitovastike), start, end && end >= start ? end : start],
      );
      totals.charges++;
    }
    if (hv.length === 0) issues.push("Hoitovastiketta ei ole Accessissa (tai muutospäivä puuttuu). Lisää voimassa oleva vastike ennen HTJ2-ilmoitusta.");
    const current = hv[hv.length - 1];
    if (current && Number(String(current.HV_Muutos_pvn).slice(0, 4)) < 2022) issues.push(`Viimeisin hoitovastikkeen muutos on ${s(current.HV_Muutos_pvn)}. Tarkista, onko vastike ajan tasalla.`);
    const noDate = data.charges.filter((x) => Number(x.Yhtiö_id) === accessId && /hoitovastike/i.test(s(x.Vastikelaji) ?? "") && !s(x.HV_Muutos_pvn));
    if (noDate.length) issues.push(`${noDate.length} hoitovastikeriviltä puuttui muutospäivä, ei tuotu.`);

    // Lainat
    for (const l of data.loans.filter((x) => Number(x.YhtiöId) === accessId && (n(x["Yhtiön laina"]) ?? 0) > 0)) {
      await tx.query(
        `insert into er_loans (organization_id, company_id, name, principal_eur, balance_eur, undrawn_eur, purpose, source)
         values ($1,$2,'Yhtiölaina (Access)',$3,$3,coalesce($4,0),$5,'migration')`,
        [org.id, companyId, n(l["Yhtiön laina"]), n(l["Nostamattomat lainat, eur"]), s(l["Lainan pvm"]) ? `Accessin päivämäärä ${s(l["Lainan pvm"])} (merkitys tarkistettava)` : null],
      );
      totals.loans++;
      issues.push(`Laina ${n(l["Yhtiön laina"])} €: pääoma, saldo, eräpäivä ja lainaosuudet tarkistettava tilinpäätöksestä.`);
    }

    // Korjaukset
    for (const r of data.repairs.filter((x) => Number(x["Yhtiö"]) === accessId)) {
      const type = s(r["Ilmoituksen tyyppi"]) ?? "";
      const summary = s(r.Summary) ?? "(ei kuvausta)";
      const year = s(r.Päiväys) ? Number(String(r.Päiväys).slice(0, 4)) : null;
      const unitLabel = s(r["Asunnon numero"]);
      const gid = unitLabel && unitLabel !== "0" ? unitByLabel.get(`${accessId}:${unitLabel}`) ?? null : null;
      const project = summary.split(/\r?\n/)[0].slice(0, 120);
      if (type.startsWith("4") || type.startsWith("3")) {
        await tx.query(
          `insert into er_maintenance_works (organization_id, company_id, share_group_id, project, work_type, completed_year, description, performed_by, source)
           values ($1,$2,$3,$4,$5,$6,$7,$8,'migration')`,
          [org.id, companyId, gid, project, repairWorkType(s(r["Korjauksen kohde"])), year, summary, type.startsWith("3") ? "shareholder" : "company"],
        );
        totals.works++;
      } else if (type.startsWith("5")) {
        await tx.query(
          `insert into er_maintenance_needs (organization_id, company_id, planned_year, target, action, work_type, source)
           values ($1,$2,$3,$4,$5,$6,'migration')`,
          [org.id, companyId, year ?? new Date().getFullYear(), repairWorkType(s(r["Korjauksen kohde"])), summary.slice(0, 500), repairWorkType(s(r["Korjauksen kohde"]))],
        );
        totals.needs++;
        if (year !== null && year < 2026) issues.push(`Tuleva korjaus "${project.slice(0, 60)}" on päivätty ${year}. Päivitä kunnossapitotarveselvitys.`);
      } else if (type.startsWith("2")) {
        extra.significant_defects.push(summary);
      }
    }
    if (extra.significant_defects.length) {
      await tx.query("update er_housing_companies set extra = $2 where id = $1", [companyId, JSON.stringify(extra)]);
      issues.push(`${extra.significant_defects.length} huomattavaa vikaa tai puutetta tallennettiin yhtiön lisätietoihin isännöitsijäntodistusta varten. Tarkista ajantasaisuus.`);
    }

    say(`\n## ${name}`);
    say(`${units.length} osakeryhmää. ${issues.length === 0 ? "Ei havaintoja." : `${issues.length} havaintoa:`}`);
    for (const i of issues) say(`- ${i}`);
  }

  // Liitteet
  const MIME: Record<string, string> = { ".pdf": "application/pdf", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document", ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ".doc": "application/msword", ".xls": "application/vnd.ms-excel" };
  const CATEGORY: Record<string, string> = { Yhtiöjärjestys: "articles", Tasekirja: "financial_statement", Talousarvio: "budget", Energiatodistus: "energy_certificate", Pohjakuva: "floor_plan" };
  for (const a of data.attachments) {
    const companyId = companyIds.get(Number(a.companyId));
    if (!companyId) continue;
    const src = path.join(PRIVATE, "attachments", a.file);
    const info = await stat(src).catch(() => null);
    if (!info) continue;
    const fileName = path.basename(src).replace(/[^\w.\-äöåÄÖÅ ]+/g, "").replace(/\s+/g, "_") || "liite";
    const storagePath = `${org.id}/${companyId}/${randomUUID()}/${fileName}`;
    await mkdir(path.dirname(path.join(FILES, storagePath)), { recursive: true });
    await copyFile(src, path.join(FILES, storagePath));
    const sha = createHash("sha256").update(await readFile(src)).digest("hex");
    await tx.query(
      `insert into er_documents (organization_id, company_id, share_group_id, category, title, file_name, storage_path, mime_type, size_bytes, sha256, visibility, uploaded_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'internal',$11)`,
      [org.id, companyId, a.unitId ? unitByAccessId.get(Number(a.unitId)) ?? null : null, CATEGORY[a.field] ?? "other", `${a.field} (Access)`, fileName, storagePath,
        MIME[path.extname(fileName).toLowerCase()] ?? "application/octet-stream", info.size, sha, jukka],
    );
    totals.docs++;
  }

  report.splice(3, 0, "", `Tuotu: ${totals.units} osakeryhmää, ${totals.ranges} osakeväliä (${totals.rangeIssues} päällekkäistä jätetty pois), ${totals.parties} osapuolta, ${totals.owners} omistusta, ${totals.residents} asumista, ${totals.charges} vastikeperustetta, ${totals.loans} lainaa, ${totals.works} korjaushistorian riviä, ${totals.needs} tulevaa korjausta, ${totals.docs} dokumenttia (näkyvyys: vain henkilökunta).`);
  report.push("", "## Yleistä", "- Omistajien nimet tuotiin sellaisenaan yhteen kenttään, koska Accessissa etu- ja sukunimeä ei ole erotettu. Järjestys (suku- vai etunimi ensin) tarkistetaan HTJ-synkronoinnissa.", "- Dokumentit ovat oletuksena vain henkilökunnan nähtävissä. Vaihda yhtiöjärjestys, tilinpäätös ja energiatodistus osakkaille näkyviksi dokumenttipankissa.");
  await writeFile(path.join(PRIVATE, "access-import-report.md"), report.join("\n"), "utf8");
  console.log(report[4]);
  console.log("Raportti: data/private/access-import-report.md. Kirjaudu kehityskäyttäjänä Jukka Taskinen.");
});

await db.close();
