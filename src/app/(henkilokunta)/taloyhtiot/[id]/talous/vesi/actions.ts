"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireStaff } from "@/lib/auth/current-user";
import { audit } from "@/lib/audit";
import { emptyToNull, fail, parseForm } from "@/lib/forms";
import { FinanceError } from "@/lib/finance/billing";
import { isIsoDate } from "@/lib/finance/dates";
import {
  addMeter,
  createRound,
  createWaterSettlement,
  deleteAdvance,
  deleteMeter,
  parseReading,
  replaceMeter,
  saveStaffReadings,
  setAdvance,
  setRoundStatus,
} from "@/lib/water/mutations";

const uuid = z.string().uuid();
const date = z.string().refine(isIsoDate, "Anna päivämäärä.");
const optText = (max: number) => z.preprocess(emptyToNull, z.string().max(max).nullable());
const reading = z.string().transform((v, c) => {
  const r = parseReading(v);
  if (r === null)
    c.addIssue({
      code: "custom",
      message: "Lukema on luku, enintään kolme desimaalia.",
    });
  return r ?? "0";
});
const optReading = z.preprocess(emptyToNull, reading.nullable());
const euro = z
  .string()
  .transform((v) => v.replace(/[\s ]/g, "").replace(",", "."))
  .refine((v) => /^\d{1,6}(\.\d{1,2})?$/.test(v), "Anna ennakko euroina, esim. 15,00.");

function base(companyId: string) {
  return `/taloyhtiot/${companyId}/talous/vesi`;
}

async function writer(companyId: string) {
  const ctx = await requireStaff();
  if (!ctx.can("owner", "manager", "assistant", "accountant")) fail(base(companyId), "Roolillasi ei voi muokata vesilaskutusta.");
  return ctx;
}

function companyFrom(formData: FormData): string {
  const id = String(formData.get("company_id") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) redirect("/taloyhtiot");
  return id;
}

async function attempt<T>(back: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof FinanceError) fail(back, err.message);
    throw err;
  }
}

function done(companyId: string, to: string): never {
  revalidatePath(base(companyId));
  redirect(to);
}

// ---------------------------------------------------------------------------
// Mittarit
// ---------------------------------------------------------------------------
const meterSchema = z.object({
  company_id: uuid,
  share_group_id: z.string().uuid("Valitse huoneisto."),
  kind: z.enum(["cold", "hot"]),
  meter_number: optText(60),
  location: optText(120),
  installed_on: date,
  start_reading: reading,
  notes: optText(500),
});

export async function addMeterAction(formData: FormData) {
  const companyId = companyFrom(formData);
  const back = base(companyId);
  const ctx = await writer(companyId);
  const d = parseForm(meterSchema, formData, back);
  await attempt(back, () =>
    ctx.run(async (tx) => {
      const id = await addMeter(tx, {
        companyId,
        shareGroupId: d.share_group_id,
        kind: d.kind,
        meterNumber: d.meter_number,
        location: d.location,
        installedOn: d.installed_on,
        startReading: d.start_reading,
        notes: d.notes,
      });
      await audit(tx, {
        organizationId: ctx.org.organizationId,
        userId: ctx.user.id,
        action: "create",
        entity: "water_meter",
        entityId: id,
      });
    }),
  );
  done(companyId, `${back}#mittarit`);
}

const replaceSchema = z.object({
  company_id: uuid,
  meter_id: uuid,
  removed_on: date,
  final_reading: reading,
  new_meter_number: optText(60),
  new_start_reading: optReading,
});

export async function replaceMeterAction(formData: FormData) {
  const companyId = companyFrom(formData);
  const back = base(companyId);
  const ctx = await writer(companyId);
  const d = parseForm(replaceSchema, formData, back);
  await attempt(back, () =>
    ctx.run(async (tx) => {
      await replaceMeter(tx, {
        companyId,
        meterId: d.meter_id,
        removedOn: d.removed_on,
        finalReading: d.final_reading,
        newMeterNumber: d.new_meter_number,
        newStartReading: d.new_start_reading,
      });
      await audit(tx, {
        organizationId: ctx.org.organizationId,
        userId: ctx.user.id,
        action: "update",
        entity: "water_meter",
        entityId: d.meter_id,
        details: { replaced: true },
      });
    }),
  );
  done(companyId, `${back}#mittarit`);
}

export async function deleteMeterAction(formData: FormData) {
  const companyId = companyFrom(formData);
  const back = base(companyId);
  const ctx = await writer(companyId);
  const meterId = uuid.parse(formData.get("meter_id"));
  await attempt(back, () =>
    ctx.run(async (tx) => {
      await deleteMeter(tx, companyId, meterId);
      await audit(tx, {
        organizationId: ctx.org.organizationId,
        userId: ctx.user.id,
        action: "delete",
        entity: "water_meter",
        entityId: meterId,
      });
    }),
  );
  done(companyId, `${back}#mittarit`);
}

// ---------------------------------------------------------------------------
// Ennakot
// ---------------------------------------------------------------------------
const advanceSchema = z.object({
  company_id: uuid,
  share_group_id: z.string().uuid("Valitse huoneisto."),
  monthly_eur: euro,
  starts_on: date,
  note: optText(300),
});

export async function setAdvanceAction(formData: FormData) {
  const companyId = companyFrom(formData);
  const back = base(companyId);
  const ctx = await writer(companyId);
  const d = parseForm(advanceSchema, formData, back);
  await attempt(back, () =>
    ctx.run(async (tx) => {
      await setAdvance(tx, {
        companyId,
        shareGroupId: d.share_group_id,
        monthlyEur: d.monthly_eur,
        startsOn: d.starts_on,
        note: d.note,
      });
      await audit(tx, {
        organizationId: ctx.org.organizationId,
        userId: ctx.user.id,
        action: "update",
        entity: "water_advance",
        entityId: d.share_group_id,
        details: { monthly_eur: d.monthly_eur, starts_on: d.starts_on },
      });
    }),
  );
  done(companyId, `${back}#ennakot`);
}

export async function deleteAdvanceAction(formData: FormData) {
  const companyId = companyFrom(formData);
  const back = base(companyId);
  const ctx = await writer(companyId);
  const id = uuid.parse(formData.get("advance_id"));
  await ctx.run(async (tx) => {
    await deleteAdvance(tx, companyId, id);
    await audit(tx, {
      organizationId: ctx.org.organizationId,
      userId: ctx.user.id,
      action: "delete",
      entity: "water_advance",
      entityId: id,
    });
  });
  done(companyId, `${back}#ennakot`);
}

// ---------------------------------------------------------------------------
// Lukukierrokset
// ---------------------------------------------------------------------------
const roundSchema = z.object({
  company_id: uuid,
  read_on: date,
  portal_open: z.preprocess((v) => v === "on", z.boolean()),
  note: optText(300),
});

export async function createRoundAction(formData: FormData) {
  const companyId = companyFrom(formData);
  const back = base(companyId);
  const ctx = await writer(companyId);
  const d = parseForm(roundSchema, formData, back);
  const id = await attempt(back, () =>
    ctx.run(async (tx) => {
      const roundId = await createRound(tx, {
        companyId,
        readOn: d.read_on,
        portalOpen: d.portal_open,
        note: d.note,
        userId: ctx.user.id,
      });
      await audit(tx, {
        organizationId: ctx.org.organizationId,
        userId: ctx.user.id,
        action: "create",
        entity: "water_reading_round",
        entityId: roundId,
      });
      return roundId;
    }),
  );
  done(companyId, `${back}/lukemat/${id}`);
}

export async function saveReadingsAction(formData: FormData) {
  const companyId = companyFrom(formData);
  const roundId = uuid.parse(formData.get("round_id"));
  const back = `${base(companyId)}/lukemat/${roundId}`;
  const ctx = await writer(companyId);
  const readings: { meterId: string; value: string | null }[] = [];
  for (const [key, raw] of formData.entries()) {
    const m = /^reading_([0-9a-f-]{36})$/i.exec(key);
    if (!m || typeof raw !== "string") continue;
    const original = String(formData.get(`original_${m[1]}`) ?? "");
    if (raw.trim() === original.trim()) continue;
    if (raw.trim() === "") {
      readings.push({ meterId: m[1], value: null });
      continue;
    }
    const value = parseReading(raw);
    if (value === null) fail(back, `Lukema "${raw}" ei kelpaa. Käytä numeroita, enintään kolme desimaalia.`);
    readings.push({ meterId: m[1], value });
  }
  const res = await attempt(back, () =>
    ctx.run(async (tx) => {
      const r = await saveStaffReadings(tx, {
        companyId,
        roundId,
        userId: ctx.user.id,
        readings,
        confirmed: formData.get("confirm_readings") === "on",
      });
      if (r.saved + r.removed > 0) {
        await audit(tx, {
          organizationId: ctx.org.organizationId,
          userId: ctx.user.id,
          action: "update",
          entity: "water_reading_round",
          entityId: roundId,
          details: r,
        });
      }
      return r;
    }),
  );
  revalidatePath(back);
  redirect(`${back}?tallennettu=${res.saved + res.removed}`);
}

export async function setRoundStatusAction(formData: FormData) {
  const companyId = companyFrom(formData);
  const roundId = uuid.parse(formData.get("round_id"));
  const ctx = await writer(companyId);
  const status = formData.get("status");
  const portal = formData.get("portal_open");
  await ctx.run((tx) =>
    setRoundStatus(tx, companyId, roundId, {
      status: status === "open" || status === "closed" ? status : undefined,
      portalOpen: portal === "true" ? true : portal === "false" ? false : undefined,
    }),
  );
  revalidatePath(`${base(companyId)}/lukemat/${roundId}`);
  done(companyId, `${base(companyId)}/lukemat/${roundId}`);
}

const settlementSchema = z
  .object({
    company_id: uuid,
    round_id: uuid,
    period_start: date,
    period_end: date,
    due_on: z.preprocess(emptyToNull, date.nullable()),
  })
  .refine((d) => d.period_start <= d.period_end, "Kauden loppu on ennen alkua.");

export async function createSettlementAction(formData: FormData) {
  const companyId = companyFrom(formData);
  const roundId = String(formData.get("round_id") ?? "");
  const back = /^[0-9a-f-]{36}$/i.test(roundId) ? `${base(companyId)}/lukemat/${roundId}` : base(companyId);
  const ctx = await writer(companyId);
  const d = parseForm(settlementSchema, formData, back);
  const res = await attempt(back, () =>
    ctx.run(async (tx) => {
      const r = await createWaterSettlement(tx, {
        companyId,
        roundId: d.round_id,
        periodStart: d.period_start,
        periodEnd: d.period_end,
        dueOn: d.due_on,
        userId: ctx.user.id,
      });
      await audit(tx, {
        organizationId: ctx.org.organizationId,
        userId: ctx.user.id,
        action: "create",
        entity: "billing_run",
        entityId: r.runId,
        details: { kind: "water_settlement", round_id: d.round_id },
      });
      return r;
    }),
  );
  revalidatePath(`/taloyhtiot/${companyId}/talous`);
  done(companyId, `/taloyhtiot/${companyId}/talous/ajot/${res.runId}`);
}
