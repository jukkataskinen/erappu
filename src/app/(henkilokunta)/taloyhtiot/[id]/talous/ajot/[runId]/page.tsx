import { notFound } from "next/navigation";
import { CompanyHeader, loadCompany } from "@/components/CompanyHeader";
import { FormError } from "@/components/FormError";
import { Badge, Button, DefinitionList, LinkButton, Notice, Panel, SectionTitle, Table, Td, Th } from "@/components/ui";
import { requireStaff } from "@/lib/auth/current-user";
import { formatDate, formatDateTime, formatEur } from "@/lib/format";
import { formatReference } from "@/lib/validation/finnish";
import { CHARGE_TYPE, RUN_STATUS, trimDecimal } from "@/lib/finance/labels";
import { getRun, listRunLines, sumEur } from "@/lib/finance/queries";
import { approveRun, cancelRun, exportRun } from "../../actions";

export const metadata = { title: "Laskutusajo" };

export default async function BillingRunPage({ params, searchParams }: { params: Promise<{ id: string; runId: string }>; searchParams: Promise<{ virhe?: string }> }) {
  const ctx = await requireStaff();
  const { id, runId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(runId)) notFound();
  const company = await loadCompany(ctx, id);
  const { virhe } = await searchParams;
  const data = await ctx.run(async (tx) => {
    const run = await getRun(tx, id, runId);
    if (!run) return null;
    return { run, lines: await listRunLines(tx, runId) };
  });
  if (!data) notFound();
  const { run, lines } = data;
  const canWrite = ctx.can("owner", "manager", "assistant", "accountant");
  const canApprove = ctx.can("owner", "manager", "accountant");
  const status = RUN_STATUS[run.status];

  const groups = new Map<string, typeof lines>();
  for (const l of lines) groups.set(l.share_group_id, [...(groups.get(l.share_group_id) ?? []), l]);
  const hidden = (
    <>
      <input type="hidden" name="company_id" value={id} />
      <input type="hidden" name="run_id" value={run.id} />
    </>
  );

  return (
    <>
      <CompanyHeader company={company} active="talous" />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-xl">
            Laskutusajo {Number(run.period_start.slice(5, 7))}/{run.period_start.slice(0, 4)}
          </h2>
          <Badge tone={status.tone}>{status.label}</Badge>
        </div>
        <div className="flex flex-wrap gap-2">
          <LinkButton variant="ghost" href={`/taloyhtiot/${id}/talous`}>
            Takaisin talouteen
          </LinkButton>
          {run.export_document_id ? (
            <LinkButton variant="secondary" href={`/api/dokumentit/${run.export_document_id}?lataa=1`} prefetch={false}>
              Lataa CSV
            </LinkButton>
          ) : null}
          {canWrite && (run.status === "approved" || run.status === "exported") ? (
            <form action={exportRun}>
              {hidden}
              <Button variant={run.status === "approved" ? "primary" : "secondary"}>{run.status === "exported" ? "Vie uudelleen" : "Vie kirjanpitoon (CSV)"}</Button>
            </form>
          ) : null}
          {canApprove && run.status === "draft" ? (
            <form action={approveRun}>
              {hidden}
              <Button>Hyväksy</Button>
            </form>
          ) : null}
          {canWrite && (run.status === "draft" || run.status === "approved") ? (
            <form action={cancelRun}>
              {hidden}
              <Button variant="ghost">Peru ajo</Button>
            </form>
          ) : null}
        </div>
      </div>
      <FormError message={virhe} />

      <div className="grid gap-6 xl:grid-cols-[1fr_2fr]">
        <div className="grid content-start gap-6">
          <Panel>
            <SectionTitle>Yhteenveto</SectionTitle>
            <DefinitionList
              items={[
                { label: "Kausi", value: `${formatDate(run.period_start)} – ${formatDate(run.period_end)}` },
                { label: "Eräpäivä", value: formatDate(run.due_on) },
                { label: "Yhteensä", value: <strong>{formatEur(run.totals.total_eur)}</strong> },
                { label: "Osakeryhmiä / rivejä", value: `${run.totals.group_count ?? 0} / ${run.totals.line_count ?? 0}` },
                { label: "Luonut", value: `${run.created_by_name ?? "–"}, ${formatDateTime(run.created_at)}` },
                { label: "Hyväksynyt", value: run.approved_at ? `${run.approved_by_name ?? "–"}, ${formatDateTime(run.approved_at)}` : "–" },
                { label: "Viety", value: run.exported_at ? formatDateTime(run.exported_at) : "–" },
              ]}
            />
            {run.totals.by_charge_type ? (
              <ul className="mt-4 divide-y divide-line border-t border-line text-sm">
                {Object.entries(run.totals.by_charge_type).map(([k, v]) => (
                  <li key={k} className="flex justify-between py-2">
                    <span>{CHARGE_TYPE[k] ?? k}</span>
                    <span className="tabular">{formatEur(v)}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </Panel>
          {run.totals.warnings?.length ? (
            <Notice tone="warn" title={`Tarkistettavaa (${run.totals.warnings.length})`}>
              <ul className="mt-1 list-disc pl-5">
                {run.totals.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </Notice>
          ) : null}
          {run.status === "draft" ? (
            <Notice tone="info" title="Luonnos">
              Tarkista rivit ja hyväksy ajo. Hyväksynnän jälkeen rivit näkyvät osakkaille portaalissa ja ajon voi viedä kirjanpitoon.
            </Notice>
          ) : null}
        </div>

        <Table>
          <thead>
            <tr>
              <Th>Huoneisto / maksaja</Th>
              <Th>Rivi</Th>
              <Th numeric>Summa</Th>
            </tr>
          </thead>
          <tbody>
            {[...groups.values()].map((rows) => (
              <tr key={rows[0].share_group_id} className="align-top">
                <Td>
                  <p className="font-semibold">{rows[0].unit_label}</p>
                  <p className="text-sm">{rows[0].payer_name ?? <span className="text-coral">Maksaja puuttuu</span>}</p>
                  <p className="tabular text-xs text-ink/55">Viite {formatReference(rows[0].reference_number)}</p>
                </Td>
                <Td>
                  <ul className="grid gap-1">
                    {rows.map((l) => (
                      <li key={l.id} className="flex justify-between gap-4">
                        <span>{l.description}</span>
                        <span className="tabular whitespace-nowrap text-ink/70">
                          {formatEur(l.amount_eur)}
                          {Number(l.vat_percent) > 0 ? ` (alv ${trimDecimal(l.vat_percent)} %)` : ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                </Td>
                <Td numeric className="font-semibold">
                  {formatEur(sumEur(rows.map((l) => l.amount_eur)))}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </div>
    </>
  );
}
