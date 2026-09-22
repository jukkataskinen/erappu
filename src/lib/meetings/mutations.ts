import type { Sql } from "@/lib/db";
import { addDays, type IsoDate } from "@/lib/tasks/dates";
import { insertTask } from "@/lib/tasks/queries";
import { groupOwnersForVoting, type OwnershipInput } from "./attendees";
import { isGeneralMeeting, MEETING_KIND, type MeetingKind } from "./labels";
import { annualGeneralAgenda, type AuditorKind } from "./agenda";
import { resolveGoverningAct } from "./governing-act";
import { resolveAgenda, type AgendaItemTemplate } from "./templates";

/**
 * Kokousten muutokset. Kutsujan transaktio (käyttäjän RLS), joten toisen
 * organisaation kokoukseen kohdistuva muutos ei löydä riviä.
 */

export interface NewMeeting {
  companyId: string;
  kind: MeetingKind;
  startsAt: string;
  location: string | null;
  remoteParticipation: boolean;
  remoteUrl: string | null;
  fiscalYear: string | null;
  createdBy: string;
}

export async function createMeeting(tx: Sql, m: NewMeeting): Promise<{ id: string; organizationId: string } | null> {
  const [company] = await tx.query<{ organization_id: string; company_form: string; governing_act: string | null }>(
    "select organization_id, company_form, governing_act from er_housing_companies where id = $1",
    [m.companyId],
  );
  if (!company) return null;
  const [row] = await tx.query<{ id: string }>(
    `insert into er_meetings (organization_id, company_id, kind, starts_at, location, remote_participation, remote_url, fiscal_year, created_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
    [company.organization_id, m.companyId, m.kind, m.startsAt, m.location, m.remoteParticipation, m.remoteUrl, m.fiscalYear, m.createdBy],
  );

  const [custom] = await tx.query<{ items: AgendaItemTemplate[] }>(
    "select items from er_agenda_templates where organization_id = $1 and kind = $2 and is_default limit 1",
    [company.organization_id, m.kind],
  );
  // Varsinainen yhtiökokous: ilman organisaation omaa pohjaa esityslista rakennetaan
  // yhtiön yhtiöjärjestyksen hallitus- ja tarkastajamääristä (0097).
  const items = m.kind === "annual_general" && !(custom?.items?.length)
    ? await companyAnnualAgenda(tx, m.companyId)
    : resolveAgenda(m.kind, custom?.items, resolveGoverningAct(company.company_form, company.governing_act));
  for (const [index, item] of items.entries()) {
    await tx.query("insert into er_meeting_items (organization_id, meeting_id, position, title, proposal) values ($1,$2,$3,$4,$5)", [
      company.organization_id, row.id, index + 1, item.title, item.proposal || null,
    ]);
  }
  return { id: row.id, organizationId: company.organization_id };
}

async function companyAnnualAgenda(tx: Sql, companyId: string): Promise<AgendaItemTemplate[]> {
  const [c] = await tx.query<{
    company_form: string; governing_act: string | null; board_members_min: number | null; board_members_max: number | null; board_deputies_min: number | null; board_deputies_max: number | null;
    auditor_kind: AuditorKind | null; auditors_count: number | null; deputy_auditors_count: number | null; chair_name: string | null;
  }>(
    `select c.company_form, c.governing_act, c.board_members_min, c.board_members_max, c.board_deputies_min, c.board_deputies_max, c.auditor_kind, c.auditors_count,
            c.deputy_auditors_count,
            (select p.display_name from er_board_memberships b join er_parties p on p.id = b.party_id
              where b.company_id = c.id and b.role = 'chair' and b.starts_on <= current_date and (b.ends_on is null or b.ends_on >= current_date)
              order by b.starts_on desc limit 1) as chair_name
       from er_housing_companies c where c.id = $1`,
    [companyId],
  );
  return annualGeneralAgenda(
    {
      boardMembersMin: c.board_members_min, boardMembersMax: c.board_members_max, boardDeputiesMin: c.board_deputies_min, boardDeputiesMax: c.board_deputies_max,
      auditorKind: c.auditor_kind, auditorsCount: c.auditors_count, deputyAuditorsCount: c.deputy_auditors_count, act: resolveGoverningAct(c.company_form, c.governing_act),
    },
    { chairName: c.chair_name },
  );
}

/**
 * Uusi asia lisätään ennen "Muut asiat" -kohtaa, koska muut asiat käsitellään
 * aina juuri ennen kokouksen päättämistä (Jukka 22.9.2026). Jos kohtaa ei ole,
 * asia lisätään ennen kokouksen päättämistä, muuten loppuun.
 */
export async function addItem(tx: Sql, meetingId: string, title: string, proposal: string | null): Promise<string | null> {
  const items = await tx.query<{ id: string; position: number; title: string }>(
    "select id, position, title from er_meeting_items where meeting_id = $1 order by position",
    [meetingId],
  );
  const anchor =
    items.find((i) => /^muut (esille tulevat )?asiat/i.test(i.title.trim())) ??
    (items.length && /^kokouksen päättäminen/i.test(items[items.length - 1].title.trim()) ? items[items.length - 1] : undefined);
  if (anchor) {
    // Uniikkiehto on viivästetty, joten siirto ja lisäys onnistuvat samassa transaktiossa.
    await tx.query("update er_meeting_items set position = position + 1 where meeting_id = $1 and position >= $2", [meetingId, anchor.position]);
  }
  const rows = await tx.query<{ id: string }>(
    `insert into er_meeting_items (organization_id, meeting_id, position, title, proposal)
     select m.organization_id, m.id, $4::int, $2, $3
       from er_meetings m where m.id = $1 returning id`,
    [meetingId, title, proposal, anchor ? anchor.position : (items[items.length - 1]?.position ?? 0) + 1],
  );
  return rows[0]?.id ?? null;
}

/** Oletusmääräpäivä kokouksesta viedylle tehtävälle: kaksi viikkoa kokouksen jälkeen. */
export const ITEM_TASK_DEFAULT_DAYS = 14;

/** Tehtävän kuvaus: kokous, pykälä, esitys ja päätös. */
export function itemTaskDescription(opts: { kind: MeetingKind; meetingDate: string; position: number; proposal: string | null; decision: string | null }): string {
  const [y, m, d] = opts.meetingDate.split("-").map(Number);
  return [
    `${MEETING_KIND[opts.kind]} ${d}.${m}.${y}, ${opts.position} §.`,
    opts.proposal ? `Esitys: ${opts.proposal}` : null,
    opts.decision ? `Päätös: ${opts.decision}` : null,
  ]
    .filter(Boolean)
    .join("\n\n")
    .slice(0, 4000);
}

/**
 * Vie kokouksen asian isännöitsijän tehtävälistalle. Vastuuhenkilö on yhtiön
 * isännöitsijä, jos hän on organisaation jäsen, muuten viejä. Jos asialla on
 * jo tehtävä, palautetaan se eikä uutta luoda.
 */
export async function createItemTask(tx: Sql, opts: { meetingId: string; itemId: string; userId: string; dueOn?: IsoDate | null }): Promise<string | null> {
  const [x] = await tx.query<{
    organization_id: string; company_id: string; kind: MeetingKind; meeting_date: string; position: number; title: string; proposal: string | null;
    decision: string | null; task_id: string | null; manager_user_id: string | null;
  }>(
    `select m.organization_id, m.company_id, m.kind, to_char(m.starts_at at time zone 'Europe/Helsinki', 'YYYY-MM-DD') as meeting_date, i.position, i.title,
            i.proposal, i.decision, (select t.id from er_tasks t where t.id = i.task_id) as task_id,
            (select om.user_id from er_org_members om where om.organization_id = c.organization_id and om.user_id = c.manager_user_id) as manager_user_id
       from er_meeting_items i
       join er_meetings m on m.id = i.meeting_id
       join er_housing_companies c on c.id = m.company_id
      where i.id = $1 and i.meeting_id = $2`,
    [opts.itemId, opts.meetingId],
  );
  if (!x) return null;
  if (x.task_id) return x.task_id;
  const taskId = await insertTask(tx, {
    organizationId: x.organization_id,
    companyId: x.company_id,
    title: x.title.slice(0, 200),
    description: itemTaskDescription({ kind: x.kind, meetingDate: x.meeting_date, position: x.position, proposal: x.proposal, decision: x.decision }),
    dueOn: opts.dueOn ?? addDays(x.meeting_date as IsoDate, ITEM_TASK_DEFAULT_DAYS),
    recurrence: null,
    category: isGeneralMeeting(x.kind) ? "general_meeting" : "board_meeting",
    assigneeUserId: x.manager_user_id ?? opts.userId,
    createdBy: opts.userId,
  });
  await tx.query("update er_meeting_items set task_id = $2 where id = $1", [opts.itemId, taskId]);
  return taskId;
}

export async function updateItem(tx: Sql, meetingId: string, itemId: string, fields: { title: string; proposal: string | null; decision: string | null }): Promise<boolean> {
  const rows = await tx.query(
    "update er_meeting_items set title = $3, proposal = $4, decision = $5 where id = $2 and meeting_id = $1 returning id",
    [meetingId, itemId, fields.title, fields.proposal, fields.decision],
  );
  return rows.length > 0;
}

/** Siirtää asiaa ylös tai alas. Uniikkiehto on viivästetty, joten vaihto onnistuu samassa transaktiossa. */
export async function moveItem(tx: Sql, meetingId: string, itemId: string, direction: "up" | "down"): Promise<boolean> {
  const items = await tx.query<{ id: string; position: number }>("select id, position from er_meeting_items where meeting_id = $1 order by position", [meetingId]);
  const index = items.findIndex((i) => i.id === itemId);
  const target = direction === "up" ? index - 1 : index + 1;
  if (index < 0 || target < 0 || target >= items.length) return false;
  const a = items[index];
  const b = items[target];
  await tx.query("update er_meeting_items set position = $2 where id = $1", [a.id, b.position]);
  await tx.query("update er_meeting_items set position = $2 where id = $1", [b.id, a.position]);
  return true;
}

export async function deleteItem(tx: Sql, meetingId: string, itemId: string): Promise<boolean> {
  const rows = await tx.query("delete from er_meeting_items where id = $1 and meeting_id = $2 returning id", [itemId, meetingId]);
  if (rows.length === 0) return false;
  const rest = await tx.query<{ id: string }>("select id from er_meeting_items where meeting_id = $1 order by position", [meetingId]);
  for (const [i, r] of rest.entries()) await tx.query("update er_meeting_items set position = $2 where id = $1", [r.id, i + 1]);
  return true;
}

/**
 * Esitäyttää osallistujat: yhtiökokoukseen osakkaat osakasluettelosta,
 * hallituksen kokoukseen voimassa olevat hallituksen jäsenet. Olemassa
 * olevat rivit korvataan, joten esitäyttö tehdään ennen kokousta.
 */
export async function prefillAttendees(tx: Sql, meetingId: string): Promise<number> {
  const [meeting] = await tx.query<{ organization_id: string; company_id: string; kind: MeetingKind }>(
    "select organization_id, company_id, kind from er_meetings where id = $1",
    [meetingId],
  );
  if (!meeting) return 0;
  await tx.query("delete from er_meeting_attendees where meeting_id = $1", [meetingId]);

  if (isGeneralMeeting(meeting.kind)) {
    const owners = await tx.query<OwnershipInput>(
      `select p.id as party_id, p.display_name, g.id as share_group_id, g.unit_label, g.share_count
         from er_ownerships o
         join er_share_groups g on g.id = o.share_group_id
         join er_parties p on p.id = o.party_id
        where g.company_id = $1 and g.removed_on is null and (o.ends_on is null or o.ends_on >= current_date)`,
      [meeting.company_id],
    );
    const drafts = groupOwnersForVoting(owners);
    for (const d of drafts) {
      await tx.query(
        `insert into er_meeting_attendees (organization_id, meeting_id, party_id, display_name, share_group_ids, shares, votes)
         values ($1,$2,$3,$4,$5,$6,$6)`,
        [meeting.organization_id, meetingId, d.partyId, d.displayName, d.shareGroupIds, d.shares],
      );
    }
    return drafts.length;
  }

  const board = await tx.query<{ party_id: string; display_name: string }>(
    `select distinct p.id as party_id, p.display_name
       from er_board_memberships b join er_parties p on p.id = b.party_id
      where b.company_id = $1 and b.role in ('chair', 'member', 'deputy') and (b.ends_on is null or b.ends_on >= current_date)
      order by p.display_name`,
    [meeting.company_id],
  );
  for (const b of board) {
    await tx.query(
      "insert into er_meeting_attendees (organization_id, meeting_id, party_id, display_name) values ($1,$2,$3,$4)",
      [meeting.organization_id, meetingId, b.party_id, b.display_name],
    );
  }
  return board.length;
}
