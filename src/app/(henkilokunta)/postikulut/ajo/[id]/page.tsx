import Link from "next/link";
import { notFound } from "next/navigation";
import { FormError } from "@/components/FormError";
import { Badge, Button, Notice, PageHeader, Panel, Table, Td, Th } from "@/components/ui";
import { requireStaff } from "@/lib/auth/current-user";
import { fennoaEnvironment } from "@/lib/fennoa";
import { formatDate, formatDateTime, formatEur } from "@/lib/format";
import { getBillingRun, type RunInvoice } from "@/lib/letters/billing";
import { INVOICE_CHANNEL_LABEL, type InvoiceChannel } from "@/lib/letters/pricing";
import { deleteBillingRunAction, exportBillingRunAction, releaseStuckInvoiceAction } from "../../actions";

export const metadata = { title: "Postikulujen laskutusajo" };

const STATUS: Record<RunInvoice["status"], { label: string; tone: "neutral" | "info" | "ok" | "warn" | "alert" }> = {
  pending: { label: "Viemättä", tone: "neutral" },
  exporting: { label: "Vienti kesken", tone: "warn" },
  exported: { label: "Luonnos Fennoassa", tone: "ok" },
  failed: { label: "Ei viety", tone: "alert" },
};

export default async function BillingRunPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ virhe?: string; viety?: string; epaonnistui?: string }> }) {
  const ctx = await requireStaff();
  if (!ctx.can("owner", "manager", "accountant")) notFound();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const sp = await searchParams;
  const data = await ctx.run((tx) => getBillingRun(tx, id));
  if (!data) notFound();
  const { run, invoices } = data;
  const environment = fennoaEnvironment();
  const exportable = invoices.filter((i) => i.status === "pending" || i.status === "failed");
  const anyExported = invoices.some((i) => i.status === "exported" || i.status === "exporting");
  const total = invoices.reduce((a, i) => a + Number(i.total_net_eur), 0);
  const vat = Number(run.vat_percent);

  return (
    <>
      <PageHeader
        back={{ href: "/postikulut", label: "Postikulut" }}
        title={`Postikulut ${formatDate(run.period_start)}–${formatDate(run.period_end)}`}
        subtitle={`Laskun päivä ${formatDate(run.invoice_date)}, eräpäivä ${formatDate(run.due_date)}, alv ${String(vat).replace(".", ",")} %. Tehty ${formatDateTime(run.created_at)}${run.created_by_name ? `, ${run.created_by_name}` : ""}.`}
        actions={
          <a href={`/postikulut/ajo/${run.id}/erittely`} className="inline-flex min-h-10 items-center rounded-full border border-line bg-paper px-4 text-sm font-semibold hover:border-ink/30">
            Erittely (CSV)
          </a>
        }
      />
      <FormError message={sp.virhe} />
      {sp.viety !== undefined ? (
        <div className="mb-5">
          <Notice tone={Number(sp.epaonnistui) > 0 ? "warn" : "ok"} title="Vienti tehty">
            Fennoaan vietiin {sp.viety} laskua luonnoksina.{Number(sp.epaonnistui) > 0 ? ` ${sp.epaonnistui} laskua jäi viemättä; syy näkyy laskun kohdalla.` : ""} Hyväksy ja lähetä laskut
            Fennoassa.
          </Notice>
        </div>
      ) : null}

      <div className="grid gap-4">
        {invoices.map((inv) => (
          <Panel key={inv.id}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-base font-semibold">{inv.company_name}</h3>
                <p className="text-xs text-ink/60">
                  Fennoan asiakasnumero {inv.profile.fennoa_customer_no ?? "–"} ·{" "}
                  {inv.profile.invoice_channel ? INVOICE_CHANNEL_LABEL[inv.profile.invoice_channel as InvoiceChannel] : "laskukanava puuttuu"} ·{" "}
                  <Link href={`/postikulut/yhtio/${inv.company_id}`} className="text-sky">
                    Laskutustiedot
                  </Link>
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Badge tone={STATUS[inv.status].tone}>{STATUS[inv.status].label}</Badge>
                {inv.environment === "mock" ? <Badge>Testitila</Badge> : inv.environment === "test" ? <Badge tone="info">Fennoan testiyritys</Badge> : null}
              </div>
            </div>
            {inv.problems.length && inv.status !== "exported" ? (
              <p className="mt-2 text-sm text-coral">{inv.problems.join(" ")}</p>
            ) : inv.message ? (
              <p className="mt-2 text-sm text-ink/65">{inv.message}</p>
            ) : null}
            <div className="mt-3">
              <Table>
                <thead>
                  <tr>
                    <Th>Rivi</Th>
                    <Th numeric>Määrä</Th>
                    <Th numeric>Hinta alv 0</Th>
                    <Th numeric>Yhteensä alv 0</Th>
                  </tr>
                </thead>
                <tbody>
                  {inv.rows.map((r, i) => (
                    <tr key={i}>
                      <Td>{r.name}</Td>
                      <Td numeric>
                        {r.quantity} {r.unit}
                      </Td>
                      <Td numeric>{formatEur(r.price)}</Td>
                      <Td numeric>{formatEur(r.total)}</Td>
                    </tr>
                  ))}
                  <tr>
                    <Td className="font-semibold">Yhteensä alv 0 (verollinen {formatEur(Math.round(Number(inv.total_net_eur) * (1 + vat / 100) * 100) / 100)})</Td>
                    <Td />
                    <Td />
                    <Td numeric className="font-semibold">
                      {formatEur(inv.total_net_eur)}
                    </Td>
                  </tr>
                </tbody>
              </Table>
            </div>
            {inv.status === "exporting" ? (
              <form action={releaseStuckInvoiceAction} className="mt-3 text-sm">
                <input type="hidden" name="run_id" value={run.id} />
                <input type="hidden" name="invoice_id" value={inv.id} />
                <p className="text-ink/65">Vienti keskeytyi. Tarkista Fennoasta, syntyikö luonnos. Jos ei syntynyt, palauta lasku vietäväksi.</p>
                <Button variant="secondary" className="mt-2">
                  Laskua ei ole Fennoassa, palauta vietäväksi
                </Button>
              </form>
            ) : null}
          </Panel>
        ))}
      </div>

      <Panel className="mt-6">
        <p className="text-sm">
          Yhteensä {invoices.length} laskua, {formatEur(Math.round(total * 100) / 100)} alv 0.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {exportable.length > 0 ? (
            environment ? (
              <form action={exportBillingRunAction}>
                <input type="hidden" name="run_id" value={run.id} />
                <Button>
                  Vie {exportable.length} laskua Fennoaan{environment === "mock" ? " (testitila)" : environment === "test" ? " (testiyritys)" : ""}
                </Button>
              </form>
            ) : (
              <p className="text-sm text-ink/65">Vientiä Fennoan tuotantoon ei ole otettu käyttöön. Tee laskut Fennoaan erittelyn mukaan.</p>
            )
          ) : null}
          {!anyExported ? (
            <form action={deleteBillingRunAction}>
              <input type="hidden" name="run_id" value={run.id} />
              <Button variant="secondary">Poista ajo</Button>
            </form>
          ) : null}
        </div>
        <p className="mt-3 text-xs text-ink/55">
          Laskut viedään Fennoaan luonnoksina, ja ne hyväksytään ja lähetetään Fennoassa. Puutteellisella laskutustiedolla laskua ei viedä. Poistettu ajo palauttaa postitukset
          laskuttamattomiksi.
        </p>
      </Panel>
    </>
  );
}
