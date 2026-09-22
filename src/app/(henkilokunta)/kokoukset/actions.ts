"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireStaff } from "@/lib/auth/current-user";
import { audit } from "@/lib/audit";
import { emptyToNull, fail, parseForm } from "@/lib/forms";
import { assertRealEsinetti, canSimulateSigning, getEsinettiClient, isEsinettiError } from "@/lib/esinetti";
import { AttachmentError, attachDocument, removeAttachment } from "@/lib/meetings/attachments";
import { MeetingAttachmentPdfError } from "@/lib/meetings/attachment-pdf";
import { generateMeetingDocument, type MeetingDocumentKind } from "@/lib/meetings/documents";
import { addItem, createItemTask, createMeeting, deleteItem, moveItem, prefillAttendees, updateItem } from "@/lib/meetings/mutations";
import { NoticeError, sendMeetingNotice } from "@/lib/meetings/send-notice";
import { SigningError, startMinutesSigning } from "@/lib/meetings/signing";
import { simulateSigning } from "@/lib/meetings/simulate";
import { helsinkiLocalToIso } from "@/lib/meetings/time";
import type { IsoDate } from "@/lib/tasks/dates";

/**
 * Kokousten palvelintoiminnot. Jokainen toiminto ajetaan käyttäjän
 * RLS-transaktiossa; toisen organisaation kokous ei löydy, jolloin
 * toiminto palaa virheellä eikä muuta mitään.
 */

const uuid = z.string().uuid();
const optText = (max = 500) => z.preprocess(emptyToNull, z.string().max(max).nullable());
const optEmail = z.preprocess(emptyToNull, z.string().email("Sähköpostiosoite ei ole kelvollinen.").max(200).nullable());

async function writer(back: string) {
  const ctx = await requireStaff();
  if (!ctx.can("owner", "manager", "assistant")) fail(back, "Roolillasi ei voi muokata kokouksia.");
  return ctx;
}

function meetingPath(companyId: string, meetingId: string) {
  return `/taloyhtiot/${companyId}/kokoukset/${meetingId}`;
}

function ids(formData: FormData) {
  const companyId = uuid.safeParse(formData.get("company_id"));
  const meetingId = uuid.safeParse(formData.get("meeting_id"));
  if (!companyId.success || !meetingId.success) redirect("/kokoukset");
  return { companyId: companyId.data, meetingId: meetingId.data, back: meetingPath(companyId.data, meetingId.data) };
}

function done(companyId: string, meetingId: string, suffix = ""): never {
  const path = meetingPath(companyId, meetingId);
  revalidatePath(path);
  revalidatePath(`/taloyhtiot/${companyId}/kokoukset`);
  revalidatePath("/kokoukset");
  redirect(path + suffix);
}

const meetingSchema = z.object({
  company_id: uuid,
  kind: z.enum(["annual_general", "extraordinary_general", "board"]),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Anna kokouksen päivä."),
  time: z.string().regex(/^\d{2}:\d{2}$/, "Anna kokouksen kellonaika."),
  location: optText(300),
  remote_participation: z.preprocess((v) => v === "on", z.boolean()),
  remote_url: z.preprocess(emptyToNull, z.string().url("Etäyhteyden osoite ei ole kelvollinen.").max(500).nullable()),
  fiscal_year: optText(20),
});

export async function createMeetingAction(formData: FormData) {
  const companyId = uuid.safeParse(formData.get("company_id"));
  const back = companyId.success ? `/taloyhtiot/${companyId.data}/kokoukset` : "/kokoukset";
  const ctx = await writer(back);
  const data = parseForm(meetingSchema, formData, back);
  const startsAt = helsinkiLocalToIso(data.date, data.time);
  if (!startsAt) fail(back, "Kokouksen aika ei ole kelvollinen.");
  const created = await ctx.run(async (tx) => {
    const m = await createMeeting(tx, {
      companyId: data.company_id, kind: data.kind, startsAt, location: data.location, remoteParticipation: data.remote_participation,
      remoteUrl: data.remote_url, fiscalYear: data.fiscal_year, createdBy: ctx.user.id,
    });
    if (m) {
      // Osallistujat esitäytetään heti (osakasluettelo tai hallitus), jotta osakas- ja
      // ääniluettelo eivät jää tyhjiksi. Esitäytön voi päivittää ennen kokousta.
      const count = await prefillAttendees(tx, m.id);
      await audit(tx, { organizationId: m.organizationId, userId: ctx.user.id, action: "create", entity: "meeting", entityId: m.id, details: { attendees: count } });
    }
    return m;
  });
  if (!created) fail(back, "Yhtiötä ei löytynyt.");
  done(data.company_id, created.id);
}

const updateSchema = meetingSchema.omit({ company_id: true, kind: true }).extend({
  chair_name: optText(200),
  chair_email: optEmail,
  secretary_name: optText(200),
  checker1_name: optText(200),
  checker1_email: optEmail,
  checker2_name: optText(200),
  checker2_email: optEmail,
  notes: optText(4000),
});

export async function updateMeetingAction(formData: FormData) {
  const { companyId, meetingId, back } = ids(formData);
  const ctx = await writer(back);
  const d = parseForm(updateSchema, formData, back);
  const startsAt = helsinkiLocalToIso(d.date, d.time);
  if (!startsAt) fail(back, "Kokouksen aika ei ole kelvollinen.");
  let checkers = [
    { name: d.checker1_name, email: d.checker1_email },
    { name: d.checker2_name, email: d.checker2_email },
  ].filter((c) => c.name);
  // Hallituksen kokouksessa valittu jäsen valitaan osallistujista; nimi ja sähköposti rekisteristä.
  const pickedAttendee = formData.has("checker_attendee_id") ? uuid.safeParse(formData.get("checker_attendee_id")) : null;
  const ok = await ctx.run(async (tx) => {
    if (pickedAttendee) {
      const [picked] = pickedAttendee.success
        ? await tx.query<{ name: string; email: string | null }>(
            "select a.display_name as name, p.email from er_meeting_attendees a left join er_parties p on p.id = a.party_id where a.id = $1 and a.meeting_id = $2",
            [pickedAttendee.data, meetingId],
          )
        : [];
      checkers = picked?.email ? [{ name: picked.name, email: picked.email }] : [];
    }
    const rows = await tx.query<{ organization_id: string }>(
      `update er_meetings set starts_at = $2, location = $3, remote_participation = $4, remote_url = $5, fiscal_year = $6,
              chair_name = $7, chair_email = $8, secretary_name = $9, minutes_checkers = $10, notes = $11
        where id = $1 and company_id = $12 returning organization_id`,
      [meetingId, startsAt, d.location, d.remote_participation, d.remote_url, d.fiscal_year, d.chair_name, d.chair_email, d.secretary_name,
        JSON.stringify(checkers), d.notes, companyId],
    );
    if (rows[0]) await audit(tx, { organizationId: rows[0].organization_id, userId: ctx.user.id, action: "update", entity: "meeting", entityId: meetingId });
    return rows.length > 0;
  });
  if (!ok) fail("/kokoukset", "Kokousta ei löytynyt.");
  done(companyId, meetingId);
}

const itemSchema = z.object({
  title: z.string().min(1, "Anna asian otsikko.").max(300),
  proposal: optText(4000),
  decision: optText(4000),
});

/** "Vie isännöitsijän tehtävälistalle" -valinta ja vapaaehtoinen määräpäivä. */
const taskSchema = z.object({
  to_task: z.preprocess((v) => v === "on" || v === "1", z.boolean()),
  task_due_on: z.preprocess(emptyToNull, z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Anna määräpäivä muodossa pp.kk.vvvv.").nullable()),
});

export async function addItemAction(formData: FormData) {
  const { companyId, meetingId, back } = ids(formData);
  const ctx = await writer(back);
  const d = parseForm(itemSchema, formData, back);
  const t = parseForm(taskSchema, formData, back);
  const ok = await ctx.run(async (tx) => {
    const itemId = await addItem(tx, meetingId, d.title, d.proposal);
    if (itemId && t.to_task) await createItemTask(tx, { meetingId, itemId, userId: ctx.user.id, dueOn: t.task_due_on as IsoDate | null });
    return !!itemId;
  });
  if (!ok) fail(back, "Asiaa ei voitu lisätä.");
  if (t.to_task) revalidatePath(`/taloyhtiot/${companyId}/vuosikello`);
  done(companyId, meetingId, "#asiat");
}

export async function updateItemAction(formData: FormData) {
  const { companyId, meetingId, back } = ids(formData);
  const ctx = await writer(back);
  const itemId = uuid.parse(formData.get("item_id"));
  const d = parseForm(itemSchema, formData, back);
  const t = parseForm(taskSchema, formData, back);
  const ok = await ctx.run(async (tx) => {
    const updated = await updateItem(tx, meetingId, itemId, d);
    // Tehtävä luodaan tallennuksen jälkeen, jotta siihen tulee juuri kirjattu päätös.
    if (updated && t.to_task) await createItemTask(tx, { meetingId, itemId, userId: ctx.user.id, dueOn: t.task_due_on as IsoDate | null });
    return updated;
  });
  if (!ok) fail(back, "Asiaa ei löytynyt.");
  if (t.to_task) revalidatePath(`/taloyhtiot/${companyId}/vuosikello`);
  done(companyId, meetingId, "#asiat");
}

export async function moveItemAction(formData: FormData) {
  const { companyId, meetingId, back } = ids(formData);
  const ctx = await writer(back);
  const itemId = uuid.parse(formData.get("item_id"));
  const direction = z.enum(["up", "down"]).parse(formData.get("direction"));
  await ctx.run((tx) => moveItem(tx, meetingId, itemId, direction));
  done(companyId, meetingId, "#asiat");
}

export async function deleteItemAction(formData: FormData) {
  const { companyId, meetingId, back } = ids(formData);
  const ctx = await writer(back);
  const itemId = uuid.parse(formData.get("item_id"));
  await ctx.run((tx) => deleteItem(tx, meetingId, itemId));
  done(companyId, meetingId, "#asiat");
}

export async function prefillAttendeesAction(formData: FormData) {
  const { companyId, meetingId, back } = ids(formData);
  const ctx = await writer(back);
  await ctx.run(async (tx) => {
    const count = await prefillAttendees(tx, meetingId);
    const [m] = await tx.query<{ organization_id: string }>("select organization_id from er_meetings where id = $1", [meetingId]);
    if (m) await audit(tx, { organizationId: m.organization_id, userId: ctx.user.id, action: "prefill_attendees", entity: "meeting", entityId: meetingId, details: { count } });
  });
  done(companyId, meetingId, "#osallistujat");
}

const attendeeSchema = z.object({
  attendee_id: uuid,
  present: z.preprocess((v) => v === "on", z.boolean()),
  remote: z.preprocess((v) => v === "on", z.boolean()),
  proxy_name: optText(200),
  shares: z.coerce.number().int().min(0).max(100_000_000),
});

/** Kaikki osallistujarivit tallennetaan yhdellä lomakkeella (ääniluettelon vahvistus kokouksessa). */
export async function saveAttendeesAction(formData: FormData) {
  const { companyId, meetingId, back } = ids(formData);
  const ctx = await writer(back);
  const rowIds = formData.getAll("attendee_id").filter((v): v is string => typeof v === "string");
  const rows = rowIds.map((id) =>
    attendeeSchema.safeParse({
      attendee_id: id,
      present: formData.get(`present_${id}`),
      remote: formData.get(`remote_${id}`),
      proxy_name: formData.get(`proxy_${id}`) ?? "",
      shares: formData.get(`shares_${id}`) ?? "0",
    }),
  );
  if (rows.some((r) => !r.success)) fail(back, "Tarkista osallistujien tiedot.");
  await ctx.run(async (tx) => {
    for (const r of rows) {
      if (!r.success) continue;
      const a = r.data;
      await tx.query(
        "update er_meeting_attendees set present = $3, remote = $4, proxy_name = $5, shares = $6, votes = $6 where id = $1 and meeting_id = $2",
        [a.attendee_id, meetingId, a.present || a.remote, a.remote, a.proxy_name, a.shares],
      );
    }
  });
  done(companyId, meetingId, "#osallistujat");
}

export async function addAttendeeAction(formData: FormData) {
  const { companyId, meetingId, back } = ids(formData);
  const ctx = await writer(back);
  const d = parseForm(z.object({ display_name: z.string().min(1, "Anna nimi.").max(200), shares: z.coerce.number().int().min(0).default(0) }), formData, back);
  await ctx.run((tx) =>
    tx.query(
      `insert into er_meeting_attendees (organization_id, meeting_id, display_name, shares, votes, present)
       select organization_id, id, $2, $3, $3, true from er_meetings where id = $1`,
      [meetingId, d.display_name, d.shares],
    ),
  );
  done(companyId, meetingId, "#osallistujat");
}

export async function deleteAttendeeAction(formData: FormData) {
  const { companyId, meetingId, back } = ids(formData);
  const ctx = await writer(back);
  const attendeeId = uuid.parse(formData.get("delete_attendee_id"));
  await ctx.run((tx) => tx.query("delete from er_meeting_attendees where id = $1 and meeting_id = $2", [attendeeId, meetingId]));
  done(companyId, meetingId, "#osallistujat");
}

export async function generateDocumentAction(formData: FormData) {
  const { companyId, meetingId, back } = ids(formData);
  const ctx = await writer(back);
  const kind = z.enum(["notice", "agenda", "shareholders", "votes", "minutes"]).parse(formData.get("kind")) as MeetingDocumentKind;
  if (kind === "shareholders" || kind === "votes" || kind === "minutes") {
    // Tyhjä osallistujalista (esim. ennen tätä muutosta luotu kokous) esitäytetään ennen luetteloa.
    await ctx.run(async (tx) => {
      const [row] = await tx.query<{ n: number }>("select count(*)::int as n from er_meeting_attendees where meeting_id = $1", [meetingId]);
      if (row && row.n === 0) await prefillAttendees(tx, meetingId);
    });
  }
  let result;
  try {
    result = await generateMeetingDocument(ctx.run, ctx.user.id, meetingId, kind);
  } catch (err) {
    if (err instanceof MeetingAttachmentPdfError) fail(back, err.message);
    throw err;
  }
  if (!result) fail(back, "Asiakirjaa ei voitu muodostaa tälle kokoukselle.");
  // Luotu asiakirja avataan esikatseluun kokoussivulle.
  done(companyId, meetingId, `?asiakirja=${result.documentId}#asiakirjat`);
}

export async function sendNoticeAction(formData: FormData) {
  const { companyId, meetingId, back } = ids(formData);
  const ctx = await writer(back);
  try {
    await sendMeetingNotice(ctx.run, ctx.user.id, meetingId);
  } catch (err) {
    if (err instanceof NoticeError) fail(back, err.message);
    throw err;
  }
  done(companyId, meetingId, "#kutsu");
}

export async function setMeetingStatusAction(formData: FormData) {
  const { companyId, meetingId, back } = ids(formData);
  const ctx = await writer(back);
  const status = z.enum(["held", "cancelled", "draft"]).parse(formData.get("status"));
  // Sallitut siirtymät: kutsun jälkeen pidetyksi, ennen allekirjoitusta peruttavaksi.
  const from = status === "held" ? ["draft", "notice_sent"] : status === "cancelled" ? ["draft", "notice_sent", "held"] : ["cancelled"];
  const ok = await ctx.run(async (tx) => {
    const rows = await tx.query<{ organization_id: string }>(
      "update er_meetings set status = $2 where id = $1 and company_id = $3 and status = any($4::text[]) returning organization_id",
      [meetingId, status, companyId, from],
    );
    if (rows[0]) await audit(tx, { organizationId: rows[0].organization_id, userId: ctx.user.id, action: `status_${status}`, entity: "meeting", entityId: meetingId });
    return rows.length > 0;
  });
  if (!ok) fail(back, "Tilaa ei voi muuttaa tässä vaiheessa.");
  done(companyId, meetingId);
}

export async function sendForSigningAction(formData: FormData) {
  const { companyId, meetingId, back } = ids(formData);
  const ctx = await writer(back);
  try {
    assertRealEsinetti();
    await startMinutesSigning(ctx.run, ctx.user.id, meetingId, getEsinettiClient());
  } catch (err) {
    if (err instanceof SigningError) fail(back, err.message);
    if (isEsinettiError(err)) fail(back, err.message);
    throw err;
  }
  done(companyId, meetingId, "#allekirjoitus");
}

export async function simulateSigningAction(formData: FormData) {
  const { companyId, meetingId, back } = ids(formData);
  const ctx = await writer(back);
  if (!canSimulateSigning()) fail(back, "Simulointi ei ole käytössä.");
  const roundId = uuid.parse(formData.get("round_id"));
  await simulateSigning(ctx.db, roundId, ctx.user.sub);
  done(companyId, meetingId, "#allekirjoitus");
}

/** Olemassa olevan yhtiön dokumentin liittäminen asiaan (esim. tilinpäätös tai tarjous dokumenttipankista). */
export async function attachExistingDocumentAction(formData: FormData) {
  const { companyId, meetingId, back } = ids(formData);
  const ctx = await writer(back);
  const itemId = uuid.safeParse(formData.get("item_id"));
  const documentId = uuid.safeParse(formData.get("document_id"));
  if (!itemId.success) fail(back, "Asiaa ei löytynyt.");
  if (!documentId.success) fail(back, "Valitse liitettävä dokumentti.");
  try {
    await ctx.run((tx) => attachDocument(tx, { meetingId, itemId: itemId.data, documentId: documentId.data, userId: ctx.user.id }));
  } catch (err) {
    if (err instanceof AttachmentError) fail(back, err.message);
    throw err;
  }
  done(companyId, meetingId, "#asiat");
}

export async function removeAttachmentAction(formData: FormData) {
  const { companyId, meetingId, back } = ids(formData);
  const ctx = await writer(back);
  const attachmentId = uuid.safeParse(formData.get("attachment_id"));
  if (!attachmentId.success) fail(back, "Liitettä ei löytynyt.");
  try {
    await ctx.run((tx) => removeAttachment(tx, { meetingId, attachmentId: attachmentId.data, userId: ctx.user.id }));
  } catch (err) {
    if (err instanceof AttachmentError) fail(back, err.message);
    throw err;
  }
  done(companyId, meetingId, "#asiat");
}
