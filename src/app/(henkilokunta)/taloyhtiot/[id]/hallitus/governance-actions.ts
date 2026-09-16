"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireStaff } from "@/lib/auth/current-user";
import { audit } from "@/lib/audit";
import { fail } from "@/lib/forms";

const count = (max: number) =>
  z.preprocess((v) => (typeof v === "string" && v.trim() !== "" ? Number(v.trim()) : null), z.number().int("Anna kokonaisluku.").min(0).max(max).nullable());

const schema = z
  .object({
    company_id: z.string().uuid(),
    board_members_min: count(20),
    board_members_max: count(20),
    board_deputies_min: count(20),
    board_deputies_max: count(20),
    auditor_kind: z.preprocess((v) => (v === "" ? null : v), z.enum(["operations_auditor", "auditor", "optional"]).nullable()),
    auditors_count: count(5),
    deputy_auditors_count: count(5),
    governance_source: z.preprocess((v) => (typeof v === "string" && v.trim() !== "" ? v.trim() : null), z.string().max(300).nullable()),
  })
  .refine((d) => d.board_members_min === null || d.board_members_min >= 1, "Hallituksessa on oltava vähintään yksi varsinainen jäsen.")
  .refine((d) => d.board_members_min === null || d.board_members_max === null || d.board_members_min <= d.board_members_max, "Jäsenten vähimmäismäärä on suurempi kuin enimmäismäärä.")
  .refine((d) => d.board_deputies_min === null || d.board_deputies_max === null || d.board_deputies_min <= d.board_deputies_max, "Varajäsenten vähimmäismäärä on suurempi kuin enimmäismäärä.");

/** Yhtiöjärjestyksen hallitus- ja tarkastajamäärät (0097). */
export async function saveGovernance(formData: FormData) {
  const companyId = String(formData.get("company_id") ?? "");
  const back = /^[0-9a-f-]{36}$/i.test(companyId) ? `/taloyhtiot/${companyId}/hallitus` : "/taloyhtiot";
  const ctx = await requireStaff();
  if (!ctx.can("owner", "manager")) fail(back, "Yhtiöjärjestyksen tietoja muokkaa pääkäyttäjä tai isännöitsijä.");
  const parsed = schema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) fail(back, parsed.error.issues[0]?.message ?? "Tarkista lomakkeen tiedot.");
  const d = parsed.data;
  // Kiinteä määrä: tyhjä enimmäismäärä tarkoittaa samaa kuin vähimmäismäärä.
  const membersMax = d.board_members_max ?? d.board_members_min;
  const deputiesMax = d.board_deputies_max ?? d.board_deputies_min;
  const rows = await ctx.run(async (tx) => {
    const r = await tx.query(
      `update er_housing_companies set board_members_min = $2, board_members_max = $3, board_deputies_min = $4, board_deputies_max = $5, auditor_kind = $6,
              auditors_count = $7, deputy_auditors_count = $8, governance_source = $9
        where id = $1 returning id`,
      [d.company_id, d.board_members_min, membersMax, d.board_deputies_min, deputiesMax, d.auditor_kind, d.auditors_count, d.deputy_auditors_count, d.governance_source],
    );
    if (r.length) {
      await audit(tx, { organizationId: ctx.org.organizationId, userId: ctx.user.id, action: "update", entity: "housing_company", entityId: d.company_id, details: { governance: true } });
    }
    return r;
  });
  if (rows.length === 0) fail(back, "Roolillasi ei voi muuttaa yhtiön tietoja.");
  revalidatePath(back);
  redirect(`${back}#yhtiojarjestys`);
}
