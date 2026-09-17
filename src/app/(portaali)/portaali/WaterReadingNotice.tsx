import Link from "next/link";
import type { PortalContext } from "@/lib/auth/current-user";
import { formatDate, isoDateHelsinki } from "@/lib/format";
import { portalWaterUnit, type PortalWaterUnit } from "@/lib/water/queries";

/** Etusivun nosto: avoin lukukierros, jolta huoneiston lukema puuttuu. */
export async function WaterReadingNotice({ ctx }: { ctx: PortalContext }) {
  const today = isoDateHelsinki();
  const grants = [
    ...new Map(ctx.user.portal.filter((g) => g.shareGroupId && (g.role === "owner" || g.role === "resident")).map((g) => [g.shareGroupId!, g])).values(),
  ];
  if (grants.length === 0) return null;
  const pending = await ctx.run(async (tx) => {
    const out: { unit: PortalWaterUnit; label: string; companyName: string; reportBy: string | null }[] = [];
    for (const g of grants) {
      const unit = await portalWaterUnit(tx, g.shareGroupId!, g.companyId, today);
      if (!unit?.openRound || !unit.meters.some((m) => !m.openReading)) continue;
      const [round] = await tx.query<{ report_by: string }>("select report_by::text from er_water_reading_rounds where id = $1", [unit.openRound.id]);
      out.push({ unit, label: g.unitLabel ?? "", companyName: g.companyName, reportBy: round?.report_by ?? null });
    }
    return out;
  });
  if (pending.length === 0) return null;
  return (
    <div className="grid gap-2">
      {pending.map((p) => (
        <Link
          key={p.unit.shareGroupId}
          href="/portaali/oma#vesi"
          className="block rounded-xl border border-sky/30 bg-sky-soft px-4 py-3 text-sm hover:border-sky"
        >
          <span className="block font-semibold text-sky">Lue vesimittari ja ilmoita lukema</span>
          <span className="block text-ink/75">
            {p.companyName}
            {p.label ? `, huoneisto ${p.label}` : ""}: lukemapäivä {formatDate(p.unit.openRound!.readOn)}
            {p.reportBy ? `, ilmoita viimeistään ${formatDate(p.reportBy)}` : ""}.
          </span>
        </Link>
      ))}
    </div>
  );
}
