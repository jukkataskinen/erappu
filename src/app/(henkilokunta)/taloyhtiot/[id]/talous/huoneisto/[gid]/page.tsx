import { notFound } from "next/navigation";
import { CompanyHeader, loadCompany } from "@/components/CompanyHeader";
import { Badge, DefinitionList, LinkButton, Notice, Panel, SectionTitle, Table, Td, Th } from "@/components/ui";
import { requireStaff } from "@/lib/auth/current-user";
import { formatDate, formatEur, formatFraction, formatNumber, isoDateHelsinki } from "@/lib/format";
import { formatReference, rfReference } from "@/lib/validation/finnish";
import { getBillingSettings, loadBillableGroups, loadChargeBases, loadOwnershipsForBilling } from "@/lib/finance/billing";
import { chargesForGroup } from "@/lib/finance/charges";
import { monthPeriod } from "@/lib/finance/dates";
import { CHARGE_TYPE, RUN_STATUS, UNIT_KIND } from "@/lib/finance/labels";
import { centsToDecimal } from "@/lib/finance/money";
import { activeOn, primaryPayer } from "@/lib/finance/payers";
import { companyReference } from "@/lib/finance/references";

export const metadata = { title: "Huoneiston talous" };

/**
 * Osakeryhmän talouserittely: vastikkeet, lainaosuudet ja maksutilanne.
 * Isännöitsijäntodistuksen talousosan lähde.
 */
export default async function UnitFinancePage({ params }: { params: Promise<{ id: string; gid: string }> }) {
  const ctx = await requireStaff();
  const { id, gid } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(gid)) notFound();
  const company = await loadCompany(ctx, id);
  const today = isoDateHelsinki();

  const data = await ctx.run(async (tx) => {
    const group = (await loadBillableGroups(tx, id, today)).find((g) => g.id === gid);
    if (!group) return null;
    const [settings, bases, ownerships, numbers, loanShares, statuses, lines] = await Promise.all([
      getBillingSettings(tx, id),
      loadChargeBases(tx, id),
      loadOwnershipsForBilling(tx, id),
      tx.query<{ seq_no: number }>("select seq_no from er_billing_unit_numbers where share_group_id = $1", [gid]),
      tx.query<{ id: string; loan_name: string; lender: string | null; due_on: string | null; original_eur: string; remaining_eur: string; balance_date: string; paid_off_on: string | null }>(
        `select s.id, l.name as loan_name, l.lender, l.due_on::text, s.original_eur::text, s.remaining_eur::text, s.balance_date::text, s.paid_off_on::text
           from er_loan_shares s join er_loans l on l.id = s.loan_id where s.share_group_id = $1 order by l.name`,
        [gid],
      ),
      tx.query<{ as_of: string; open_eur: string; overdue_eur: string; oldest_due_on: string | null; source: string }>(
        "select as_of::text, open_eur::text, overdue_eur::text, oldest_due_on::text, source from er_payment_status where share_group_id = $1 order by as_of desc limit 12",
        [gid],
      ),
      tx.query<{ run_id: string; period_start: string; status: string; description: string; amount_eur: string; reference_number: string }>(
        `select r.id as run_id, r.period_start::text, r.status, l.description, l.amount_eur::text, l.reference_number
           from er_billing_lines l join er_billing_runs r on r.id = l.run_id
          where l.share_group_id = $1 and r.status <> 'cancelled'
          order by r.period_start desc, l.charge_type limit 60`,
        [gid],
      ),
    ]);
    return { group, settings, bases, ownerships: ownerships.filter((o) => o.share_group_id === gid), seq: numbers[0]?.seq_no ?? null, loanShares, statuses, lines };
  });
  if (!data) notFound();
  const { group, settings, bases, ownerships, seq, loanShares, statuses, lines } = data;

  const period = monthPeriod(today.slice(0, 7));
  const charges = chargesForGroup(bases, group, period);
  const monthly = centsToDecimal(charges.lines.reduce((s, l) => s + l.amountCents, 0n));
  const reference = settings && seq ? companyReference(settings.company_number, seq) : null;
  const owners = ownerships.filter((o) => activeOn(o, today));
  const payer = primaryPayer(ownerships, today);
  const latest = statuses[0];
  const runs = new Map<string, typeof lines>();
  for (const l of lines) runs.set(l.run_id, [...(runs.get(l.run_id) ?? []), l]);

  return (
    <>
      <CompanyHeader company={company} active="talous" />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-xl">Huoneisto {group.unit_label}</h2>
          <Badge>{UNIT_KIND[group.kind] ?? group.kind}</Badge>
        </div>
        <div className="flex gap-2">
          <LinkButton variant="ghost" href={`/taloyhtiot/${id}/huoneistot/${gid}`}>
            Rekisteritiedot
          </LinkButton>
          <LinkButton variant="ghost" href={`/taloyhtiot/${id}/talous`}>
            Takaisin talouteen
          </LinkButton>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <div className="grid content-start gap-6">
          <Panel>
            <SectionTitle>Perustiedot</SectionTitle>
            <DefinitionList
              items={[
                { label: "Pinta-ala", value: formatNumber(group.area_m2, "m²") },
                { label: "Osakkeet", value: formatNumber(group.share_count) },
                { label: "Vastikeviite", value: reference ? <span className="tabular">{formatReference(reference)}</span> : "Muodostuu ensimmäisessä laskutusajossa" },
                { label: "RF-viite", value: reference ? <span className="tabular">{rfReference(reference)}</span> : "–" },
                { label: "Maksaja", value: payer?.display_name ?? "Omistaja puuttuu" },
                {
                  label: "Omistajat",
                  value: owners.length ? owners.map((o) => `${o.display_name} (${formatFraction(o.share_numerator, o.share_denominator)})`).join(", ") : "–",
                },
              ]}
            />
          </Panel>

          <Panel>
            <SectionTitle>Vastikkeet {Number(period.start.slice(5, 7))}/{period.start.slice(0, 4)}</SectionTitle>
            {charges.lines.length === 0 ? (
              <p className="text-sm text-ink/65">Voimassa olevia vastikkeita ei ole.</p>
            ) : (
              <ul className="divide-y divide-line text-sm">
                {charges.lines.map((l, i) => (
                  <li key={i} className="flex justify-between gap-4 py-2">
                    <span>{l.description}</span>
                    <span className="tabular whitespace-nowrap">{formatEur(centsToDecimal(l.amountCents))}</span>
                  </li>
                ))}
                <li className="flex justify-between gap-4 py-2 font-semibold">
                  <span>Yhteensä kuukaudessa</span>
                  <span className="tabular">{formatEur(monthly)}</span>
                </li>
              </ul>
            )}
            {charges.warnings.length ? (
              <div className="mt-3">
                <Notice tone="warn" title="Tarkistettavaa">
                  {charges.warnings.join("; ")}
                </Notice>
              </div>
            ) : null}
          </Panel>

          <Panel>
            <SectionTitle>Lainaosuudet</SectionTitle>
            {loanShares.length === 0 ? (
              <p className="text-sm text-ink/65">Huoneistolla ei ole lainaosuuksia.</p>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Laina</Th>
                    <Th numeric>Alkuperäinen</Th>
                    <Th numeric>Jäljellä</Th>
                    <Th>Tilanne</Th>
                  </tr>
                </thead>
                <tbody>
                  {loanShares.map((s) => (
                    <tr key={s.id}>
                      <Td>
                        <span className="font-semibold">{s.loan_name}</span>
                        <p className="text-xs text-ink/55">{[s.lender, s.due_on ? `erääntyy ${formatDate(s.due_on)}` : null].filter(Boolean).join(" · ")}</p>
                      </Td>
                      <Td numeric>{formatEur(s.original_eur)}</Td>
                      <Td numeric>{formatEur(s.remaining_eur)}</Td>
                      <Td>{s.paid_off_on ? <Badge tone="ok">Kertasuoritus {formatDate(s.paid_off_on)}</Badge> : `saldo ${formatDate(s.balance_date)}`}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Panel>
        </div>

        <div className="grid content-start gap-6">
          <Panel>
            <SectionTitle>Maksutilanne</SectionTitle>
            {!latest ? (
              <p className="text-sm text-ink/65">Maksutilannetta ei ole tuotu kirjanpidosta.</p>
            ) : (
              <>
                <DefinitionList
                  items={[
                    { label: "Tilanne päivältä", value: formatDate(latest.as_of) },
                    { label: "Avoinna", value: formatEur(latest.open_eur) },
                    { label: "Erääntynyt", value: <span className={Number(latest.overdue_eur) > 0 ? "font-semibold text-coral" : undefined}>{formatEur(latest.overdue_eur)}</span> },
                    { label: "Vanhin eräpäivä", value: formatDate(latest.oldest_due_on) },
                  ]}
                />
                {statuses.length > 1 ? (
                  <Table className="mt-4">
                    <thead>
                      <tr>
                        <Th>Päivä</Th>
                        <Th numeric>Avoin</Th>
                        <Th numeric>Erääntynyt</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {statuses.map((s) => (
                        <tr key={s.as_of}>
                          <Td>{formatDate(s.as_of)}</Td>
                          <Td numeric>{formatEur(s.open_eur)}</Td>
                          <Td numeric>{formatEur(s.overdue_eur)}</Td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                ) : null}
              </>
            )}
          </Panel>

          <Panel>
            <SectionTitle>Laskutus</SectionTitle>
            {runs.size === 0 ? (
              <p className="text-sm text-ink/65">Huoneistolle ei ole laskutusrivejä.</p>
            ) : (
              <ul className="divide-y divide-line text-sm">
                {[...runs.values()].map((rows) => (
                  <li key={rows[0].run_id} className="py-2.5">
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-semibold">
                        {Number(rows[0].period_start.slice(5, 7))}/{rows[0].period_start.slice(0, 4)}
                      </span>
                      <Badge tone={RUN_STATUS[rows[0].status].tone}>{RUN_STATUS[rows[0].status].label}</Badge>
                    </div>
                    <ul className="mt-1 grid gap-0.5 text-ink/75">
                      {rows.map((l, i) => (
                        <li key={i} className="flex justify-between gap-4">
                          <span>{l.description}</span>
                          <span className="tabular whitespace-nowrap">{formatEur(l.amount_eur)}</span>
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-xs text-ink/55">Vastikelajit: {[...new Set(bases.map((b) => CHARGE_TYPE[b.charge_type]))].join(", ") || "–"}</p>
          </Panel>
        </div>
      </div>
    </>
  );
}
