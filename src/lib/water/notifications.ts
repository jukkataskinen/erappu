import type { Sql } from "@/lib/db/types";
import { normalizeEmail } from "@/lib/announcements/recipients";
import { addDays, fiDate } from "@/lib/finance/dates";
import { queueMessage } from "@/lib/messaging";

/**
 * Vesimittarin lukupyyntö ja muistutus sähköpostilla (0101).
 *
 * Viesti menee huoneiston asukkaille (er_residencies), koska he lukevat
 * mittarin. Jos asukkaita ei ole kirjattu, osakkaille. Samaan osoitteeseen
 * lähtee yksi viesti, jossa ovat kaikki sen huoneistot.
 */

/** Muistutus lähtee näin monta päivää ennen ilmoituksen määräpäivää. */
export const REMINDER_DAYS_BEFORE = 2;

export type ReadingMessageKind = "request" | "reminder";

export interface ReadingRecipientRow {
  share_group_id: string;
  unit_label: string;
  party_id: string;
  email: string | null;
}

export interface ReadingMail {
  email: string;
  partyId: string;
  units: string[];
}

export function groupByEmail(rows: ReadingRecipientRow[]): { mails: ReadingMail[]; withoutEmail: number } {
  const byEmail = new Map<string, ReadingMail>();
  const missing = new Set<string>();
  for (const r of rows) {
    const email = normalizeEmail(r.email);
    if (!email) {
      missing.add(r.party_id);
      continue;
    }
    const m = byEmail.get(email) ?? { email, partyId: r.party_id, units: [] };
    if (!m.units.includes(r.unit_label)) m.units.push(r.unit_label);
    byEmail.set(email, m);
  }
  for (const m of byEmail.values()) m.units.sort((a, b) => a.localeCompare(b, "fi", { numeric: true }));
  return { mails: [...byEmail.values()], withoutEmail: missing.size };
}

export function composeReadingMail(opts: {
  kind: ReadingMessageKind;
  companyName: string;
  units: string[];
  readOn: string;
  reportBy: string;
  portalUrl: string | null;
  manager: { name: string | null; email: string | null } | null;
}): { subject: string; body: string } {
  const unitText = opts.units.length === 1 ? `huoneiston ${opts.units[0]}` : `huoneistojen ${opts.units.join(", ")}`;
  const subject =
    opts.kind === "request"
      ? `Lue vesimittari: ${opts.companyName}`
      : `Muistutus: vesimittarin lukema puuttuu, ${opts.companyName}`;
  const body = [
    "Hei,",
    "",
    opts.kind === "request"
      ? `on aika lukea ${unitText} vesimittari${opts.units.length === 1 ? "" : "t"}. Lue lukema ${fiDate(opts.readOn)} tai mahdollisimman lähellä sitä päivää ja ilmoita se viimeistään ${fiDate(opts.reportBy)}.`
      : `${unitText.charAt(0).toUpperCase()}${unitText.slice(1)} vesimittarin lukema puuttuu vielä. Ilmoitathan sen viimeistään ${fiDate(opts.reportBy)}.`,
    "",
    "Kirjoita mittarin kaikki numerot, myös desimaalit (punaiset numerot). Jos huoneistossa on sekä kylmän että lämpimän veden mittari, ilmoita molemmat.",
    "",
    opts.portalUrl ? `Ilmoita lukema portaalissa: ${opts.portalUrl}` : "Ilmoita lukema asukasportaalissa kohdassa Oma huoneisto.",
    opts.manager?.email ? `Jos et pääse portaaliin, lähetä lukema isännöitsijälle: ${opts.manager.email}` : null,
    "",
    "Lukemien perusteella tehdään vesimaksun tasaus. Jos lukema puuttuu, kulutus voidaan joutua arvioimaan.",
    "",
    `Ystävällisin terveisin`,
    opts.manager?.name ? `${opts.manager.name}, isännöitsijä` : "Isännöitsijä",
    opts.companyName,
  ]
    .filter((x) => x !== null)
    .join("\n");
  return { subject, body };
}

/**
 * Vastaanottajat: huoneistot, joilla on käytössä mittari lukemapäivänä.
 * Muistutuksessa vain huoneistot, joilta puuttuu vähintään yksi lukema.
 */
export async function readingRecipients(tx: Sql, roundId: string, onlyMissing: boolean): Promise<ReadingRecipientRow[]> {
  return tx.query<ReadingRecipientRow>(
    `with rnd as (select id, company_id, read_on from er_water_reading_rounds where id = $1),
     grp as (
       select distinct m.share_group_id
         from er_water_meters m join rnd on rnd.company_id = m.company_id
        where m.removed_on is null and m.installed_on <= rnd.read_on
          and (not $2::boolean or exists (
                select 1 from er_water_meters mm
                 where mm.share_group_id = m.share_group_id and mm.removed_on is null and mm.installed_on <= rnd.read_on
                   and not exists (select 1 from er_water_readings x where x.meter_id = mm.id and x.round_id = rnd.id)))
     ),
     res as (
       select r.share_group_id, r.party_id from er_residencies r
        where r.share_group_id in (select share_group_id from grp)
          and (r.starts_on is null or r.starts_on <= current_date) and (r.ends_on is null or r.ends_on >= current_date)
     ),
     own as (
       select o.share_group_id, o.party_id from er_ownerships o
        where o.share_group_id in (select share_group_id from grp)
          and o.share_group_id not in (select share_group_id from res)
          and (o.starts_on is null or o.starts_on <= current_date) and (o.ends_on is null or o.ends_on >= current_date)
     )
     select distinct x.share_group_id, g.unit_label, p.id as party_id, p.email
       from (select * from res union all select * from own) x
       join er_share_groups g on g.id = x.share_group_id
       join er_parties p on p.id = x.party_id`,
    [roundId, onlyMissing],
  );
}

export interface QueueResult {
  queued: number;
  withoutEmail: number;
}

/** Kirjaa lukupyynnön tai muistutuksen viestit jonoon ja merkitsee kierrokselle lähetysajan. */
export async function queueReadingMessages(tx: Sql, opts: { roundId: string; kind: ReadingMessageKind; appBaseUrl?: string | null }): Promise<QueueResult | null> {
  const [round] = await tx.query<{
    organization_id: string; company_name: string; read_on: string; report_by: string; manager_name: string | null; manager_email: string | null;
  }>(
    `select r.organization_id, c.name as company_name, r.read_on::text, r.report_by::text, u.full_name as manager_name, coalesce(u.contact_email, u.email) as manager_email
       from er_water_reading_rounds r
       join er_housing_companies c on c.id = r.company_id
       left join er_users u on u.id = c.manager_user_id
      where r.id = $1 and r.status = 'open'
      for update of r`,
    [opts.roundId],
  );
  if (!round) return null;
  const { mails, withoutEmail } = groupByEmail(await readingRecipients(tx, opts.roundId, opts.kind === "reminder"));
  const base = opts.appBaseUrl ?? process.env.APP_BASE_URL ?? null;
  const portalUrl = base ? `${base.replace(/\/$/, "")}/portaali/oma#vesi` : null;
  for (const m of mails) {
    const mail = composeReadingMail({
      kind: opts.kind, companyName: round.company_name, units: m.units, readOn: round.read_on, reportBy: round.report_by, portalUrl,
      manager: { name: round.manager_name, email: round.manager_email },
    });
    await queueMessage(tx, {
      organizationId: round.organization_id, channel: "email", recipient: m.email, partyId: m.partyId, subject: mail.subject, body: mail.body,
      subjectTable: "er_water_reading_rounds", subjectId: opts.roundId,
    });
  }
  await tx.query(
    opts.kind === "request"
      ? "update er_water_reading_rounds set notified_at = now(), notified_count = $2 where id = $1"
      : "update er_water_reading_rounds set reminded_at = now(), reminded_count = $2 where id = $1",
    [opts.roundId, mails.length],
  );
  return { queued: mails.length, withoutEmail };
}

/**
 * Päivittäinen ajo: lukupyyntö lukemapäivästä alkaen ja muistutus kaksi
 * päivää ennen määräpäivää. Kumpikin kerran kierrosta kohden.
 */
export async function queueDueReadingMessages(tx: Sql, today: string, appBaseUrl?: string | null): Promise<{ requests: number; reminders: number; messages: number }> {
  const due = await tx.query<{ id: string; kind: ReadingMessageKind }>(
    `select id, 'request' as kind from er_water_reading_rounds
      where status = 'open' and portal_open and notified_at is null and read_on <= $1::date and report_by >= $1::date
     union all
     select id, 'reminder' from er_water_reading_rounds
      where status = 'open' and portal_open and notified_at is not null and reminded_at is null
        and $2::date >= report_by and report_by >= $1::date and notified_at::date < $1::date`,
    [today, addDays(today, REMINDER_DAYS_BEFORE)],
  );
  let requests = 0;
  let reminders = 0;
  let messages = 0;
  for (const d of due) {
    const r = await queueReadingMessages(tx, { roundId: d.id, kind: d.kind, appBaseUrl });
    if (!r) continue;
    if (d.kind === "request") requests++;
    else reminders++;
    messages += r.queued;
  }
  return { requests, reminders, messages };
}
