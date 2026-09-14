import { Badge, EmptyState, Notice, Panel } from "@/components/ui";
import { requirePortal } from "@/lib/auth/current-user";
import { formatDate, formatEur, isoDateHelsinki } from "@/lib/format";
import { formatReference } from "@/lib/validation/finnish";
import { BASIS, CHARGE_TYPE, RUN_STATUS, formatPrice } from "@/lib/finance/labels";
import { boardCompanyFinance, ownerUnitFinance } from "@/lib/finance/portal";

export const metadata = { title: "Talous" };

function formatIban(iban: string): string {
  return iban.replace(/(.{4})/g, "$1 ").trim();
}

export default async function PortalFinancePage() {
  const ctx = await requirePortal();
  const today = isoDateHelsinki();
  const boardCompanies = ctx.companies.filter((c) => c.roles.includes("board"));
  const [units, boards] = await ctx.run(async (tx) => [
    await ownerUnitFinance(tx, ctx.user.portal, today),
    await Promise.all(boardCompanies.map((c) => boardCompanyFinance(tx, c, today))),
  ] as const);

  return (
    <>
      <h1 className="text-2xl">Talous</h1>
      {units.length === 0 && boards.length === 0 ? (
        <div className="mt-4">
          <EmptyState title="Ei talouden tietoja">Vastikkeet ja maksutilanne näkyvät huoneiston osakkaalle ja yhtiön talous hallitukselle.</EmptyState>
        </div>
      ) : null}

      <div className="mt-4 grid gap-4">
        {units.map((u) => (
          <Panel key={u.shareGroupId}>
            <p className="text-sm text-ink/60">{u.companyName}</p>
            <h2 className="text-lg">Huoneisto {u.unitLabel}</h2>

            <div className="mt-3 rounded-xl bg-cloud px-4 py-3">
              <p className="text-sm text-ink/60">Kuukausivastike</p>
              <p className="tabular text-2xl font-bold">{formatEur(u.monthlyTotal)}</p>
              {u.charges.length > 0 ? (
                <ul className="mt-2 grid gap-1 text-sm">
                  {u.charges.map((c, i) => (
                    <li key={i} className="flex justify-between gap-3">
                      <span>{c.description}</span>
                      <span className="tabular whitespace-nowrap">{formatEur(c.amount)}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>

            <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-ink/50">Viitenumero</dt>
                <dd className="tabular mt-0.5 text-base font-semibold">{u.reference ? formatReference(u.reference) : "Ilmoitetaan ensimmäisellä laskulla"}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-ink/50">Tilinumero</dt>
                <dd className="tabular mt-0.5 text-base font-semibold">{u.iban ? formatIban(u.iban) : "–"}</dd>
                {u.bic ? <dd className="text-xs text-ink/55">BIC {u.bic}</dd> : null}
              </div>
              {u.dueDay ? (
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-ink/50">Eräpäivä</dt>
                  <dd className="mt-0.5">kuukauden {u.dueDay}. päivä</dd>
                </div>
              ) : null}
            </dl>

            <div className="mt-4 border-t border-line pt-4">
              <p className="font-semibold">Maksutilanne</p>
              {u.payment ? (
                <>
                  <p className="text-sm text-ink/60">Kirjanpidon tilanne {formatDate(u.payment.asOf)}</p>
                  {Number(u.payment.overdueEur) > 0 ? (
                    <div className="mt-2">
                      <Notice tone="alert" title={`Erääntynyt ${formatEur(u.payment.overdueEur)}`}>
                        Vanhin eräpäivä {formatDate(u.payment.oldestDueOn)}. Jos olet jo maksanut, suoritus näkyy seuraavassa päivityksessä.
                      </Notice>
                    </div>
                  ) : Number(u.payment.openEur) <= 0 ? (
                    <p className="mt-1 text-sm text-moss">Ei avoimia vastikkeita.</p>
                  ) : null}
                  <p className="mt-2 text-sm">Avoinna yhteensä {formatEur(u.payment.openEur)}</p>
                </>
              ) : (
                <p className="text-sm text-ink/60">Maksutilannetta ei ole vielä päivitetty.</p>
              )}
            </div>

            {u.loanShares.length > 0 ? (
              <div className="mt-4 border-t border-line pt-4">
                <p className="font-semibold">Lainaosuus</p>
                <ul className="mt-1 grid gap-2 text-sm">
                  {u.loanShares.map((s, i) => (
                    <li key={i}>
                      <p className="flex justify-between gap-3">
                        <span>{s.loanName}</span>
                        <span className="tabular font-semibold">{s.paidOffOn ? "Maksettu" : formatEur(s.remainingEur)}</span>
                      </p>
                      <p className="text-xs text-ink/55">
                        Alkuperäinen {formatEur(s.originalEur)} · {s.paidOffOn ? `kertasuoritus ${formatDate(s.paidOffOn)}` : `jäljellä ${formatDate(s.balanceDate)}`}
                        {s.dueOn ? ` · laina erääntyy ${formatDate(s.dueOn)}` : ""}
                      </p>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {u.lastBilled ? (
              <details className="mt-4 border-t border-line pt-4">
                <summary className="cursor-pointer font-semibold">
                  Viimeisin laskutus {Number(u.lastBilled.periodStart.slice(5, 7))}/{u.lastBilled.periodStart.slice(0, 4)}: {formatEur(u.lastBilled.total)}
                </summary>
                <ul className="mt-2 grid gap-1 text-sm">
                  {u.lastBilled.lines.map((l, i) => (
                    <li key={i} className="flex justify-between gap-3">
                      <span>{l.description}</span>
                      <span className="tabular whitespace-nowrap">{formatEur(l.amount)}</span>
                    </li>
                  ))}
                </ul>
                {u.lastBilled.dueOn ? <p className="mt-1 text-xs text-ink/55">Eräpäivä {formatDate(u.lastBilled.dueOn)}</p> : null}
              </details>
            ) : null}
          </Panel>
        ))}

        {boards.map((b) => (
          <Panel key={b.companyId}>
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg">{b.companyName}</h2>
              <Badge tone="info">Hallitus</Badge>
            </div>

            <p className="mt-3 font-semibold">Vastikkeet</p>
            {b.bases.length === 0 ? (
              <p className="text-sm text-ink/60">Vastikeperusteita ei ole kirjattu.</p>
            ) : (
              <ul className="mt-1 grid gap-1 text-sm">
                {b.bases.map((x) => (
                  <li key={x.id} className="flex justify-between gap-3">
                    <span>
                      {x.label || CHARGE_TYPE[x.charge_type]}
                      {x.starts_on > today ? <span className="text-ink/55"> (alkaen {formatDate(x.starts_on)})</span> : null}
                    </span>
                    <span className="tabular whitespace-nowrap">
                      {formatPrice(x.unit_price)} {x.basis === "fixed" ? "€/kk" : `€/${BASIS[x.basis]?.unit ?? ""}/kk`}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            <p className="mt-4 font-semibold">Maksutilanne</p>
            {b.payment ? (
              <div className="text-sm">
                <p className="text-ink/60">Kirjanpidon tilanne {formatDate(b.payment.as_of)}</p>
                <p>
                  Avoinna {formatEur(b.payment.open_eur)}, erääntynyt <span className={Number(b.payment.overdue_eur) > 0 ? "font-semibold text-coral" : undefined}>{formatEur(b.payment.overdue_eur)}</span>
                </p>
                <p className="text-ink/60">
                  Erääntyneitä {b.payment.overdue_units}/{b.payment.units} osakeryhmällä. Osakaskohtaiset tiedot ovat isännöitsijällä.
                </p>
              </div>
            ) : (
              <p className="text-sm text-ink/60">Maksutilannetta ei ole vielä tuotu.</p>
            )}

            {b.loans.length > 0 ? (
              <>
                <p className="mt-4 font-semibold">Lainat</p>
                <ul className="mt-1 grid gap-2 text-sm">
                  {b.loans.map((l) => (
                    <li key={l.id}>
                      <p className="flex justify-between gap-3">
                        <span>{l.name}</span>
                        <span className="tabular font-semibold">{formatEur(l.balance_eur ?? l.principal_eur)}</span>
                      </p>
                      <p className="text-xs text-ink/55">
                        {[l.lender, l.balance_date ? `saldo ${formatDate(l.balance_date)}` : null, l.due_on ? `erääntyy ${formatDate(l.due_on)}` : null, l.paid_off_count ? `${l.paid_off_count} kertasuoritusta` : null]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}

            <p className="mt-4 font-semibold">Laskutus</p>
            {b.runs.length === 0 ? (
              <p className="text-sm text-ink/60">Hyväksyttyjä laskutusajoja ei ole.</p>
            ) : (
              <ul className="mt-1 divide-y divide-line text-sm">
                {b.runs.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-3 py-1.5">
                    <span>
                      {Number(r.period_start.slice(5, 7))}/{r.period_start.slice(0, 4)} <span className="text-xs text-ink/55">{RUN_STATUS[r.status]?.label}</span>
                    </span>
                    <span className="tabular">{formatEur(r.totals.total_eur)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        ))}
      </div>
    </>
  );
}
