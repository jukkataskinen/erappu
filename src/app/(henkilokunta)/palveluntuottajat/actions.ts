"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth/current-user";
import { audit } from "@/lib/audit";
import { fail, parseForm } from "@/lib/forms";
import { guarded } from "@/lib/service-requests/errors";
import { companyServiceSchema, providerSchema, splitTrades, uuid } from "@/lib/service-requests/schemas";

async function writer(back: string) {
  const ctx = await requireStaff();
  if (!ctx.can("owner", "manager", "assistant")) fail(back, "Roolillasi ei voi muokata palveluntuottajia.");
  return ctx;
}

export async function createProvider(formData: FormData) {
  const back = "/palveluntuottajat";
  const ctx = await writer(back);
  const d = parseForm(providerSchema, formData, back);
  const id = await guarded(back, () =>
    ctx.run(async (tx) => {
      const [row] = await tx.query<{ id: string }>(
        `insert into er_service_providers (organization_id, name, business_id, email, phone, emergency_phone, trades, notes)
         values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
        [ctx.org.organizationId, d.name, d.business_id, d.email, d.phone, d.emergency_phone, splitTrades(d.trades), d.notes],
      );
      await audit(tx, { organizationId: ctx.org.organizationId, userId: ctx.user.id, action: "create", entity: "service_provider", entityId: row.id });
      return row.id;
    }),
  );
  revalidatePath(back);
  redirect(`/palveluntuottajat/${id}`);
}

export async function updateProvider(formData: FormData) {
  const id = uuid.parse(formData.get("id"));
  const back = `/palveluntuottajat/${id}`;
  const ctx = await writer(back);
  const d = parseForm(providerSchema, formData, back);
  const rows = await guarded(back, () =>
    ctx.run(async (tx) => {
      const r = await tx.query(
        `update er_service_providers set name=$2, business_id=$3, email=$4, phone=$5, emergency_phone=$6, trades=$7, notes=$8
          where id = $1 returning id`,
        [id, d.name, d.business_id, d.email, d.phone, d.emergency_phone, splitTrades(d.trades), d.notes],
      );
      if (r.length) await audit(tx, { organizationId: ctx.org.organizationId, userId: ctx.user.id, action: "update", entity: "service_provider", entityId: id });
      return r;
    }),
  );
  if (rows.length === 0) fail("/palveluntuottajat", "Palveluntuottajaa ei löytynyt.");
  revalidatePath("/palveluntuottajat");
  revalidatePath(back);
  redirect(back);
}

export async function addCompanyService(formData: FormData) {
  const providerId = uuid.parse(formData.get("provider_id"));
  const back = `/palveluntuottajat/${providerId}`;
  const ctx = await writer(back);
  const d = parseForm(companyServiceSchema, formData, back);
  await guarded(back, () =>
    ctx.run(async (tx) => {
      const [pair] = await tx.query<{ organization_id: string }>(
        `select c.organization_id from er_housing_companies c join er_service_providers p on p.organization_id = c.organization_id
          where c.id = $1 and p.id = $2`,
        [d.company_id, providerId],
      );
      if (!pair) fail(back, "Yhtiötä tai palveluntuottajaa ei löytynyt.");
      if (d.default_for_requests) {
        // Yhtiöllä on yksi oletus huoltopyynnöille; uusi korvaa aiemman.
        await tx.query("update er_company_services set default_for_requests = false where company_id = $1", [d.company_id]);
      }
      await tx.query(
        "insert into er_company_services (organization_id, company_id, provider_id, service, default_for_requests) values ($1,$2,$3,$4,$5)",
        [pair.organization_id, d.company_id, providerId, d.service, d.default_for_requests],
      );
      await audit(tx, { organizationId: pair.organization_id, userId: ctx.user.id, action: "create", entity: "company_service", entityId: providerId, details: { company_id: d.company_id } });
    }),
  );
  revalidatePath(back);
  redirect(back);
}

export async function setDefaultService(formData: FormData) {
  const providerId = uuid.parse(formData.get("provider_id"));
  const id = uuid.parse(formData.get("id"));
  const back = `/palveluntuottajat/${providerId}`;
  const ctx = await writer(back);
  const makeDefault = formData.get("default") === "1";
  await guarded(back, () =>
    ctx.run(async (tx) => {
      const [row] = await tx.query<{ company_id: string; organization_id: string }>(
        "select company_id, organization_id from er_company_services where id = $1 and provider_id = $2",
        [id, providerId],
      );
      if (!row) fail(back, "Palvelua ei löytynyt.");
      if (makeDefault) await tx.query("update er_company_services set default_for_requests = false where company_id = $1", [row.company_id]);
      await tx.query("update er_company_services set default_for_requests = $2 where id = $1", [id, makeDefault]);
      await audit(tx, { organizationId: row.organization_id, userId: ctx.user.id, action: "update", entity: "company_service", entityId: id, details: { default: makeDefault } });
    }),
  );
  revalidatePath(back);
  redirect(back);
}

export async function removeCompanyService(formData: FormData) {
  const providerId = uuid.parse(formData.get("provider_id"));
  const id = uuid.parse(formData.get("id"));
  const back = `/palveluntuottajat/${providerId}`;
  const ctx = await writer(back);
  await guarded(back, () =>
    ctx.run(async (tx) => {
      const rows = await tx.query<{ organization_id: string }>("delete from er_company_services where id = $1 and provider_id = $2 returning organization_id", [id, providerId]);
      if (rows.length) await audit(tx, { organizationId: rows[0].organization_id, userId: ctx.user.id, action: "delete", entity: "company_service", entityId: id });
    }),
  );
  revalidatePath(back);
  redirect(back);
}
