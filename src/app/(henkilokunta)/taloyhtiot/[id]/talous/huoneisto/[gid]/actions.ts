"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireStaff } from "@/lib/auth/current-user";
import { audit } from "@/lib/audit";
import { emptyToNull, fail, parseForm } from "@/lib/forms";
import { FinanceError } from "@/lib/finance/billing";
import { isIsoDate } from "@/lib/finance/dates";
import { generateLoanShareCalculation } from "@/lib/finance/loan-share-calculation";

const date = z.string().refine(isIsoDate, "Anna päivämäärä.");
const schema = z
  .object({
    issued_on: date,
    pay_on: date,
    fee_eur: z.preprocess(
      (v) => (typeof v === "string" ? emptyToNull(v.replace(/[\s ]/g, "").replace(",", ".")) : v),
      z.string().regex(/^\d{1,6}(\.\d{1,2})?$/, "Käsittelymaksu on euroina, esim. 50,00.").nullable(),
    ),
    fee_label: z.preprocess(emptyToNull, z.string().max(60, "Lisäkulun nimi on enintään 60 merkkiä.").nullable()),
    visible: z.preprocess((v) => v === "on", z.boolean()),
  })
  .refine((d) => d.pay_on >= d.issued_on, "Maksupäivä ei voi olla ennen laskelman päivää.");

/** Osakkaan lainaosuuslaskelma PDF:nä huoneiston dokumentteihin. */
export async function generateLoanShareCalculationAction(formData: FormData) {
  const companyId = String(formData.get("company_id") ?? "");
  const gid = String(formData.get("share_group_id") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(companyId) || !/^[0-9a-f-]{36}$/i.test(gid)) redirect("/taloyhtiot");
  const back = `/taloyhtiot/${companyId}/talous/huoneisto/${gid}`;
  const ctx = await requireStaff();
  if (!ctx.can("owner", "manager", "assistant", "accountant")) fail(back, "Roolillasi ei voi laatia laskelmia.");
  const d = parseForm(schema, formData, back);
  let documentId: string;
  try {
    documentId = await generateLoanShareCalculation((fn) => ctx.run(fn), {
      companyId, shareGroupId: gid, userId: ctx.user.id, issuedOn: d.issued_on, payOn: d.pay_on, feeEur: d.fee_eur, feeLabel: d.fee_label, visibleToOwners: d.visible,
    });
  } catch (err) {
    if (err instanceof FinanceError) fail(`${back}#lainaosuuslaskelma`, err.message);
    throw err;
  }
  await ctx.run((tx) =>
    audit(tx, {
      organizationId: ctx.org.organizationId, userId: ctx.user.id, action: "generate_document", entity: "share_group", entityId: gid,
      details: { kind: "loan_share_calculation", documentId, visible: d.visible },
    }),
  );
  revalidatePath(back);
  redirect(`${back}?laskelma=${documentId}#lainaosuuslaskelma`);
}
