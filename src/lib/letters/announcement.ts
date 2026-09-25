import type { Sql } from "@/lib/db";
import { formatDate, isoDateHelsinki } from "@/lib/format";
import { normalizeEmail, queryAudience } from "@/lib/announcements/recipients";
import { postalAddressLines } from "./address";
import { LetterError, listActiveLetters, listLetterJobs, type LetterJobRow, type LetterRecipientRow, type LetterRow, type LetterSource, type Runner } from "./jobs";
import { SAMPLE_RECIPIENT } from "./sample";
import { loadLetterSender, MISSING_SENDER_ADDRESS, type LetterSender } from "./sender";

/**
 * Tiedote paperikirjeenä: sähköposti ensin, kirje niille kohderyhmän
 * henkilöille, joilla ei ole kelvollista sähköpostiosoitetta. Kirje tehdään
 * vain, kun tiedote on julkaistu sähköpostikanavalla, jotta "ilman
 * sähköpostia" tarkoittaa samaa kuin julkaisun raportissa.
 * Yksi kirje henkilöä kohden: nimi on osoitteessa, eikä yhdistetty nimirivi
 * mahdu kenttään luettavana.
 */

export interface AnnouncementPaperRecipient {
  partyId: string;
  name: string;
  addressLines: string[] | null;
  letter: LetterRow | null;
}

export interface AnnouncementLetterPlan {
  announcement: { id: string; organization_id: string; company_id: string; title: string; body: string; status: string; channels: string[]; valid_until: string | null };
  sender: LetterSender;
  paper: AnnouncementPaperRecipient[];
  ready: LetterRecipientRow[];
  jobs: LetterJobRow[];
  blocker: string | null;
}

export async function planAnnouncementLetters(tx: Sql, announcementId: string): Promise<AnnouncementLetterPlan | null> {
  const [a] = await tx.query<AnnouncementLetterPlan["announcement"] & { audience_roles: string[]; building_ids: string[] | null }>(
    `select id, organization_id, company_id, title, body, status, channels, valid_until::text as valid_until, audience_roles, building_ids
       from er_announcements where id = $1`,
    [announcementId],
  );
  if (!a) return null;
  const [sender, audience, active, jobs] = await Promise.all([
    loadLetterSender(tx, a.company_id),
    queryAudience(tx, { companyId: a.company_id, audienceRoles: a.audience_roles, buildingIds: a.building_ids }),
    listActiveLetters(tx, "er_announcements", announcementId),
    listLetterJobs(tx, "er_announcements", announcementId),
  ]);
  if (!sender) return null;
  const withoutEmail = [...new Set(audience.filter((r) => !normalizeEmail(r.email)).map((r) => r.party_id))];
  const parties = withoutEmail.length
    ? await tx.query<{ id: string; display_name: string; street_address: string | null; postal_code: string | null; city: string | null; country: string | null }>(
        "select id, display_name, street_address, postal_code, city, country from er_parties where id = any($1::uuid[]) order by display_name",
        [withoutEmail],
      )
    : [];
  const byParty = new Map(active.map((l) => [l.party_id, l]));
  const paper = parties.map((p) => ({ partyId: p.id, name: p.display_name, addressLines: postalAddressLines(p), letter: byParty.get(p.id) ?? null }));
  const ready = paper.filter((p) => p.addressLines && !p.letter).map((p) => ({ partyId: p.partyId, name: p.name, addressLines: p.addressLines!, reference: null }));

  let blocker: string | null = null;
  if (a.status !== "published") blocker = "Kirjeet lähetetään julkaistusta tiedotteesta.";
  else if (!a.channels.includes("email")) blocker = "Kirjeet ovat sähköpostin täydennys: julkaise tiedote myös sähköpostilla.";
  else if (!sender.lines) blocker = MISSING_SENDER_ADDRESS;
  else if (jobs.some((j) => j.status === "NE" || j.status === "uploading")) blocker = "Edellinen kirjetyö odottaa vahvistusta.";
  else if (ready.length === 0) blocker = "Ei lähetettäviä kirjeitä.";
  const announcement = { id: a.id, organization_id: a.organization_id, company_id: a.company_id, title: a.title, body: a.body, status: a.status, channels: a.channels, valid_until: a.valid_until };
  return { announcement, sender, paper, ready, jobs, blocker };
}

function announcementContent(plan: AnnouncementLetterPlan) {
  const { announcement: a, sender } = plan;
  const paragraphs = a.body
    .replace(/\r/g, "")
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (a.valid_until) paragraphs.push(`Tiedote on voimassa ${formatDate(a.valid_until)} asti.`);
  const m = sender.manager;
  return {
    title: a.title,
    paragraphs,
    signature: [sender.companyName, m.name ? `Isännöitsijä ${m.name}` : "", [m.phone, m.email].filter(Boolean).join(", ")].filter(Boolean),
    footer: `${sender.organizationName} · ${sender.companyName}`,
  };
}

export async function loadAnnouncementLetterSource(run: Runner, announcementId: string): Promise<LetterSource> {
  const plan = await run((tx) => planAnnouncementLetters(tx, announcementId));
  if (!plan) throw new LetterError("Tiedotetta ei löytynyt.");
  if (plan.blocker) throw new LetterError(plan.blocker);
  return {
    organizationId: plan.announcement.organization_id,
    companyId: plan.announcement.company_id,
    subjectTable: "er_announcements",
    subjectId: announcementId,
    jobName: `${plan.sender.companyName}: ${plan.announcement.title}`.slice(0, 200),
    sender: plan.sender.lines!,
    date: isoDateHelsinki(),
    content: announcementContent(plan),
    appendix: null,
    recipients: plan.ready,
  };
}

export async function loadAnnouncementLetterPreview(run: Runner, announcementId: string, calibration: boolean) {
  const plan = await run((tx) => planAnnouncementLetters(tx, announcementId));
  if (!plan) throw new LetterError("Tiedotetta ei löytynyt.");
  if (!plan.sender.lines) throw new LetterError(MISSING_SENDER_ADDRESS);
  return {
    sender: plan.sender.lines,
    date: isoDateHelsinki(),
    content: announcementContent(plan),
    appendix: null,
    recipients: calibration || plan.ready.length === 0 ? [SAMPLE_RECIPIENT] : plan.ready,
  };
}
