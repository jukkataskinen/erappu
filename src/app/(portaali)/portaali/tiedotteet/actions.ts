"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requirePortal } from "@/lib/auth/current-user";
import { audit } from "@/lib/audit";
import { emptyToNull, fail, parseForm } from "@/lib/forms";
import { AUDIENCE_ROLES } from "@/lib/announcements/labels";
import { containsHetu } from "@/lib/announcements/content";

const schema = z.object({
  company_id: z.string().uuid("Valitse taloyhtiö."),
  title: z.string().min(2, "Anna otsikko.").max(200, "Otsikko on liian pitkä."),
  body: z.string().min(2, "Kirjoita tiedotteen teksti.").max(20000, "Teksti on liian pitkä."),
  valid_until: z.preprocess(emptyToNull, z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable()),
});

/**
 * Hallituksen luonnos. RLS sallii vain tilan `draft` ja alkuperän `board`
 * omaan yhtiöön; kanavat ehdotetaan, mutta isännöitsijä päättää ne
 * julkaistessaan.
 */
export async function createBoardDraft(formData: FormData) {
  const back = "/portaali/tiedotteet/uusi";
  const ctx = await requirePortal();
  const data = parseForm(schema, formData, back);
  if (!ctx.companies.some((c) => c.id === data.company_id && c.roles.includes("board"))) fail(back, "Luonnoksen voi tehdä vain hallituksen jäsen.");
  const audience = [...new Set(formData.getAll("audience_roles").filter((v): v is (typeof AUDIENCE_ROLES)[number] => (AUDIENCE_ROLES as readonly unknown[]).includes(v)))];
  const channels = formData.get("email") === "on" ? ["portal", "email"] : ["portal"];
  if (audience.length === 0) fail(back, "Valitse vähintään yksi kohderyhmä.");
  if (containsHetu(`${data.title}\n${data.body}`)) fail(back, "Tekstissä näyttää olevan henkilötunnus. Poista se ennen tallennusta.");

  await ctx.run(async (tx) => {
    const [company] = await tx.query<{ organization_id: string }>("select organization_id from er_housing_companies where id = $1", [data.company_id]);
    if (!company) fail(back, "Taloyhtiötä ei löytynyt.");
    const [row] = await tx.query<{ id: string }>(
      `insert into er_announcements (organization_id, company_id, title, body, audience_roles, channels, valid_until, status, origin, author_user_id)
       values ($1,$2,$3,$4,$5,$6,$7,'draft','board',$8) returning id`,
      [company.organization_id, data.company_id, data.title, data.body, audience, channels, data.valid_until, ctx.user.id],
    );
    await audit(tx, { organizationId: company.organization_id, userId: ctx.user.id, action: "create_board_draft", entity: "announcement", entityId: row.id });
  });
  revalidatePath("/portaali/tiedotteet");
  redirect("/portaali/tiedotteet?luonnos=1");
}

export async function deleteBoardDraft(formData: FormData) {
  const id = z.string().uuid().parse(formData.get("id"));
  const ctx = await requirePortal();
  await ctx.run(async (tx) => {
    const rows = await tx.query<{ organization_id: string }>(
      "delete from er_announcements where id = $1 and status = 'draft' and origin = 'board' and author_user_id = $2 returning organization_id",
      [id, ctx.user.id],
    );
    if (rows.length) await audit(tx, { organizationId: rows[0].organization_id, userId: ctx.user.id, action: "delete_board_draft", entity: "announcement", entityId: id });
  });
  revalidatePath("/portaali/tiedotteet");
  redirect("/portaali/tiedotteet");
}
