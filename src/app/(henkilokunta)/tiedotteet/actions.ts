"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireStaff } from "@/lib/auth/current-user";
import { audit } from "@/lib/audit";
import { emptyToNull, fail, parseForm } from "@/lib/forms";
import { dispatchQueued } from "@/lib/messaging";
import { AUDIENCE_ROLES, CHANNELS } from "@/lib/announcements/labels";
import { containsHetu } from "@/lib/announcements/content";
import { publishAnnouncement } from "@/lib/announcements/publish";
import { loadAnnouncementLetterSource } from "@/lib/letters/announcement";
import { LetterError, uploadLetters } from "@/lib/letters/jobs";
import { assertRealPostita, getPostitaClient, isPostitaError } from "@/lib/postita";

const uuid = z.string().uuid();

async function writer(back = "/tiedotteet") {
  const ctx = await requireStaff();
  if (!ctx.can("owner", "manager", "assistant")) fail(back, "Roolillasi ei voi muokata tiedotteita.");
  return ctx;
}

async function publisher(back: string) {
  const ctx = await requireStaff();
  if (!ctx.can("owner", "manager")) fail(back, "Tiedotteen julkaisee pääkäyttäjä tai isännöitsijä.");
  return ctx;
}

const announcementSchema = z.object({
  company_id: z.string().uuid("Valitse taloyhtiö."),
  title: z.string().min(2, "Anna otsikko.").max(200, "Otsikko on liian pitkä."),
  body: z.string().min(2, "Kirjoita tiedotteen teksti.").max(20000, "Teksti on liian pitkä."),
  valid_until: z.preprocess(emptyToNull, z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable()),
});

function listField<T extends string>(formData: FormData, name: string, allowed: readonly T[]): T[] {
  const values = formData.getAll(name).filter((v): v is string => typeof v === "string");
  return [...new Set(values.filter((v): v is T => (allowed as readonly string[]).includes(v)))];
}

export async function saveAnnouncement(formData: FormData) {
  const id = z.preprocess(emptyToNull, uuid.nullable()).parse(formData.get("id"));
  const back = id ? `/tiedotteet/${id}/muokkaa` : "/tiedotteet/uusi";
  const ctx = await writer(back);
  const data = parseForm(announcementSchema, formData, back);
  const audience = listField(formData, "audience_roles", AUDIENCE_ROLES);
  const channels = listField(formData, "channels", CHANNELS);
  const buildingIds = formData.getAll("building_ids").filter((v): v is string => typeof v === "string" && uuid.safeParse(v).success);
  if (audience.length === 0) fail(back, "Valitse vähintään yksi kohderyhmä.");
  if (channels.length === 0) fail(back, "Valitse vähintään yksi kanava.");
  if (containsHetu(`${data.title}\n${data.body}`)) fail(back, "Tiedotteessa näyttää olevan henkilötunnus. Poista se ennen tallennusta.");

  const savedId = await ctx.run(async (tx) => {
    const [company] = await tx.query<{ organization_id: string }>("select organization_id from er_housing_companies where id = $1", [data.company_id]);
    if (!company) fail(back, "Taloyhtiötä ei löytynyt.");
    let buildings: string[] | null = null;
    if (buildingIds.length > 0) {
      const rows = await tx.query<{ id: string }>("select id from er_buildings where company_id = $1 and id = any($2::uuid[])", [data.company_id, buildingIds]);
      // Toisen yhtiön rakennus hylätään kokonaan, ettei rajaus hiljaa laajene koko yhtiöön.
      if (rows.length !== new Set(buildingIds).size) fail(back, "Valitut rakennukset eivät kuulu valittuun yhtiöön.");
      buildings = rows.map((r) => r.id);
    }
    if (id) {
      const rows = await tx.query<{ id: string }>(
        `update er_announcements set company_id = $2, organization_id = $3, title = $4, body = $5, audience_roles = $6, building_ids = $7,
                channels = $8, valid_until = $9
          where id = $1 and status = 'draft' returning id`,
        [id, data.company_id, company.organization_id, data.title, data.body, audience, buildings, channels, data.valid_until],
      );
      if (rows.length === 0) fail("/tiedotteet", "Vain luonnosta voi muokata.");
      await audit(tx, { organizationId: company.organization_id, userId: ctx.user.id, action: "update", entity: "announcement", entityId: id });
      return id;
    }
    const [row] = await tx.query<{ id: string }>(
      `insert into er_announcements (organization_id, company_id, title, body, audience_roles, building_ids, channels, valid_until, author_user_id, origin)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'staff') returning id`,
      [company.organization_id, data.company_id, data.title, data.body, audience, buildings, channels, data.valid_until, ctx.user.id],
    );
    await audit(tx, { organizationId: company.organization_id, userId: ctx.user.id, action: "create", entity: "announcement", entityId: row.id });
    return row.id;
  });
  revalidatePath("/tiedotteet");
  redirect(`/tiedotteet/${savedId}`);
}

export async function publishAnnouncementAction(formData: FormData) {
  const id = uuid.parse(formData.get("id"));
  const back = `/tiedotteet/${id}`;
  const ctx = await publisher(back);
  const result = await ctx.run((tx) => publishAnnouncement(tx, { id, userId: ctx.user.id, appBaseUrl: process.env.APP_BASE_URL ?? null }));
  if (!result.ok)
    fail(
      back,
      result.reason === "not_draft"
        ? "Tiedote on jo julkaistu."
        : result.reason === "placeholders"
          ? "Tiedotteessa on vielä täydentämättömiä [hakasulkeissa olevia] kohtia. Täydennä tai poista ne ennen julkaisua."
          : "Tiedotetta ei löytynyt.",
    );

  // Lähetys heti julkaisun jälkeen; jos se epäonnistuu, viestit jäävät jonoon ajastettua lähetystä varten.
  if (result.report.queued > 0) {
    try {
      await ctx.db.asService((tx) => dispatchQueued(tx, Math.min(result.report.queued, 200), ctx.org.organizationId));
    } catch {
      // Jonoon jääneet viestit näkyvät lähetysraportissa.
    }
  }
  revalidatePath("/tiedotteet");
  redirect(`${back}?julkaistu=1`);
}

export async function archiveAnnouncement(formData: FormData) {
  const id = uuid.parse(formData.get("id"));
  const ctx = await writer(`/tiedotteet/${id}`);
  await ctx.run(async (tx) => {
    const rows = await tx.query<{ organization_id: string }>(
      "update er_announcements set status = 'archived' where id = $1 and status = 'published' returning organization_id",
      [id],
    );
    if (rows.length) await audit(tx, { organizationId: rows[0].organization_id, userId: ctx.user.id, action: "archive", entity: "announcement", entityId: id });
  });
  revalidatePath("/tiedotteet");
  redirect(`/tiedotteet/${id}`);
}

export async function deleteDraft(formData: FormData) {
  const id = uuid.parse(formData.get("id"));
  const ctx = await writer(`/tiedotteet/${id}`);
  await ctx.run(async (tx) => {
    const rows = await tx.query<{ organization_id: string }>("delete from er_announcements where id = $1 and status = 'draft' returning organization_id", [id]);
    if (rows.length) await audit(tx, { organizationId: rows[0].organization_id, userId: ctx.user.id, action: "delete", entity: "announcement", entityId: id });
  });
  revalidatePath("/tiedotteet");
  redirect("/tiedotteet");
}

export async function dispatchQueueNow() {
  const back = "/tiedotteet/lahetykset";
  const ctx = await publisher(back);
  let sent = 0;
  let failed = 0;
  // Enintään 500 viestiä kerralla, jottei pyyntö aikakatkaistu; loput lähtevät ajastetusti.
  for (let round = 0; round < 10; round++) {
    const r = await ctx.db.asService((tx) => dispatchQueued(tx, 50, ctx.org.organizationId));
    sent += r.sent;
    failed += r.failed;
    if (r.sent + r.failed < 50) break;
  }
  await ctx.run((tx) =>
    audit(tx, { organizationId: ctx.org.organizationId, userId: ctx.user.id, action: "dispatch", entity: "outbound_messages", details: { sent, failed } }),
  );
  revalidatePath(back);
  redirect(`${back}?lahetetty=${sent}&epaonnistui=${failed}`);
}

export async function requeueFailed() {
  const back = "/tiedotteet/lahetykset";
  const ctx = await publisher(back);
  const count = await ctx.db.asService(async (tx) => {
    const rows = await tx.query(
      "update er_outbound_messages set status = 'queued', error = null where organization_id = $1 and status = 'failed' returning id",
      [ctx.org.organizationId],
    );
    return rows.length;
  });
  await ctx.run((tx) =>
    audit(tx, { organizationId: ctx.org.organizationId, userId: ctx.user.id, action: "requeue", entity: "outbound_messages", details: { count } }),
  );
  revalidatePath(back);
  redirect(back);
}

/**
 * Tiedote kirjeenä niille, joilla ei ole sähköpostia (Jukka 25.9.2026).
 * Kirjeet ladataan Postitaan vahvistamattomina; vahvistus ja peruutus:
 * `src/app/(henkilokunta)/kirjeet/actions.ts`.
 */
export async function uploadAnnouncementLettersAction(formData: FormData) {
  const id = uuid.safeParse(formData.get("id"));
  if (!id.success) redirect("/tiedotteet");
  const back = `/tiedotteet/${id.data}`;
  const ctx = await publisher(back);
  const postClass = z.enum(["1", "2"]).safeParse(formData.get("post_class"));
  if (!postClass.success) fail(back, "Valitse postiluokka.");
  try {
    assertRealPostita();
    const source = await loadAnnouncementLetterSource(ctx.run, id.data);
    await uploadLetters(ctx.run, getPostitaClient(), { userId: ctx.user.id, source, postClass: postClass.data === "1" ? 1 : 2 });
  } catch (err) {
    if (err instanceof LetterError) fail(back, err.message);
    if (isPostitaError(err)) fail(back, err.message);
    throw err;
  }
  revalidatePath(back);
  redirect(`${back}?kirjeet=ladattu#kirjeet`);
}
