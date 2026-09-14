import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { loadCompany } from "@/components/CompanyHeader";
import { requireStaff } from "@/lib/auth/current-user";
import { formatDate, formatDateTime, formatEur, formatNumber, isoDateHelsinki } from "@/lib/format";
import {
  CHARGE_BASIS_UNIT,
  findGaps,
  HTJ_CHARGE_TYPE_LABEL,
  isCurrentCharge,
  isOpenLoan,
  loadHtj2Data,
  obligationFor,
  SUBMISSION_KIND_LABEL,
} from "@/lib/htj/htj2";
import { OBLIGATION_LABEL } from "@/lib/htj/obligation";
import { isKnownWorkType } from "@/lib/maintenance/work-types";
import { NEED_STATUS_LABEL, type NeedStatus } from "@/lib/maintenance/labels";
import { COMPANY_FORM, SHARE_GROUP_KIND } from "@/lib/registry/labels";
import { PrintButton } from "./PrintButton";

export const metadata = { title: "HTJ2-yhteenveto" };

/**
 * Yhtiökohtainen HTJ2-yhteenveto käsin ilmoittamista varten. Sivu on
 * tulostettava: valikot ja painikkeet piilotetaan (`no-print`), ja puuttuvat
 * tiedot korostetaan myös paperilla.
 */

const PRINT_CSS = `
@page { size: A4; margin: 14mm; }
@media print {
  main { max-width: none !important; padding: 0 !important; }
  .htj-sheet { font-size: 11px; }
  .htj-sheet table { page-break-inside: auto; }
  .htj-sheet tr { page-break-inside: avoid; }
  .htj-sheet section { page-break-inside: avoid; }
  .htj-missing { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
}`;

function Missing({ children = "puuttuu" }: { children?: ReactNode }) {
  return <span className="htj-missing rounded bg-coral-soft px-1.5 py-0.5 text-xs font-semibold text-coral">{children}</span>;
}

function Submitted({ at }: { at: string | null }) {
  return at ? <span className="text-xs text-moss">ilmoitettu {formatDate(at)}</span> : <span className="text-xs text-ink/55">ei ilmoitettu</span>;
}

function Section({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <section className="mt-6 break-inside-avoid">
      <h2 className="mb-2 border-b border-ink/20 pb-1 text-base">
        {n}. {title}
      </h2>
      {children}
    </section>
  );
}

const th = "border-b border-ink/20 px-2 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wide text-ink/60";
const td = "border-b border-line px-2 py-1.5 align-top";

export default async function Htj2SummaryPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireStaff();
  const { id } = await params;
  const company = await loadCompany(ctx, id);
  const today = isoDateHelsinki();
  const data = await ctx.run((tx) => loadHtj2Data(tx, id, today));
  if (!data) notFound();

  const obligation = obligationFor(data);
  const gaps = findGaps(data);
  const units = data.groups.filter((g) => g.kind === "apartment" || g.kind === "commercial");
  const otherGroups = data.groups.length - units.length;
  const reportedCharges = data.charges.filter((c) => c.htj_charge_type || ["maintenance", "land", "heating", "capital"].includes(c.charge_type));
  const openLoans = data.loans.filter(isOpenLoan);
  const shareGroupsForLoans = data.groups.filter((g) => units.includes(g) || data.loanShares.some((s) => s.share_group_id === g.id));
  const areaBasis = data.charges.some((c) => c.basis === "area_m2");

  return (
    <div className="htj-sheet mx-auto max-w-4xl">
      <style>{PRINT_CSS}</style>
      <div className="no-print mb-6 flex flex-wrap items-center justify-between gap-3">
        <Link href={`/taloyhtiot/${id}/htj`} className="text-sm text-ink/60 hover:text-ink">
          ← {company.name}, HTJ
        </Link>
        <PrintButton />
      </div>

      <article className="rounded-[var(--radius-panel)] border border-line bg-paper p-6 print:border-0 print:p-0">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-ink/55">HTJ2-yhteenveto käsin ilmoittamista varten</p>
            <h1 className="mt-1 text-2xl">{data.company.name}</h1>
            <p className="text-sm text-ink/70">
              {data.company.business_id} · {COMPANY_FORM[data.company.company_form] ?? data.company.company_form}
            </p>
          </div>
          <div className="text-right text-sm">
            <p>
              Ilmoitusvelvollisuus: <strong>{OBLIGATION_LABEL[obligation.level]}</strong>
            </p>
            <p className="text-ink/60">Koottu {formatDate(today)}</p>
          </div>
        </header>

        {gaps.length > 0 ? (
          <div className="htj-missing mt-5 rounded-xl border border-coral/30 bg-coral-soft px-4 py-3 text-sm">
            <p className="font-semibold text-coral">Puuttuvat tai tarkistettavat tiedot ({gaps.length})</p>
            <ul className="mt-1 list-disc pl-5 text-ink/85">
              {gaps.map((g) => (
                <li key={g.message}>
                  {g.area === "registry" ? "Rekisteri" : SUBMISSION_KIND_LABEL[g.area]}: {g.message}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <Section n={1} title="Yhtiön perustiedot">
          <dl className="grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
            <div><dt className="inline text-ink/60">Osoite: </dt><dd className="inline">{[data.company.street_address, [data.company.postal_code, data.company.city].filter(Boolean).join(" ")].filter(Boolean).join(", ") || <Missing />}</dd></div>
            <div><dt className="inline text-ink/60">Osakkeita: </dt><dd className="inline">{data.company.total_shares ? formatNumber(data.company.total_shares) : <Missing />}</dd></div>
            <div><dt className="inline text-ink/60">Huoneistot: </dt><dd className="inline">{units.filter((g) => g.kind === "apartment").length} asuin, {units.filter((g) => g.kind === "commercial").length} liike{otherGroups ? `, ${otherGroups} muuta osakeryhmää` : ""}</dd></div>
            <div><dt className="inline text-ink/60">HTJ-vertailu: </dt><dd className="inline">{data.company.htj_synced_at ? formatDateTime(data.company.htj_synced_at) : "ei tehty"}</dd></div>
            <div className="sm:col-span-2"><dt className="inline text-ink/60">Perustelu: </dt><dd className="inline">{obligation.reasons.join(" ")}</dd></div>
          </dl>
        </Section>

        <Section n={2} title="Vastikkeet (voimassa olevat ja tulevat)">
          {reportedCharges.length === 0 ? (
            <p className="text-sm"><Missing>Vastikkeita ei ole kirjattu</Missing></p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr><th className={th}>Vastikelaji (HTJ)</th><th className={`${th} text-right`}>Määrä</th><th className={th}>Voimassa</th><th className={th}>Päätös</th><th className={th}>HTJ</th></tr>
                </thead>
                <tbody>
                  {reportedCharges.map((c) => (
                    <tr key={c.id}>
                      <td className={td}>{c.htj_charge_type ? HTJ_CHARGE_TYPE_LABEL[c.htj_charge_type] : <Missing>vastikelaji puuttuu</Missing>}{c.label ? <span className="block text-xs text-ink/55">{c.label}</span> : null}</td>
                      <td className={`${td} tabular text-right`}>{formatNumber(c.unit_price)} {CHARGE_BASIS_UNIT[c.basis] ?? c.basis}</td>
                      <td className={td}>{formatDate(c.starts_on)} – {c.ends_on ? formatDate(c.ends_on) : ""}{!isCurrentCharge(c, today) ? <span className="block text-xs text-ink/55">tuleva</span> : null}</td>
                      <td className={td}>{c.decided_on ? formatDate(c.decided_on) : <Missing />}</td>
                      <td className={td}><Submitted at={c.htj_submitted_at} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {areaBasis ? <p className="mt-1 text-xs text-ink/55">€/m²/kk-vastikkeen peruste on huoneiston pinta-ala osakeluettelossa.</p> : null}
        </Section>

        <Section n={3} title="Yhtiölainat ja lainaosuudet">
          {data.loans.length === 0 ? (
            <p className="text-sm text-ink/70">Yhtiöllä ei ole kirjattuja lainoja.</p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr><th className={th}>Laina</th><th className={`${th} text-right`}>Alkupääoma</th><th className={th}>Nostettu / erääntyy</th><th className={`${th} text-right`}>Saldo</th><th className={th}>Jaettu</th><th className={th}>HTJ</th></tr>
                  </thead>
                  <tbody>
                    {data.loans.map((l) => (
                      <tr key={l.id}>
                        <td className={td}>{l.name}{l.lender ? <span className="block text-xs text-ink/55">{l.lender}</span> : null}</td>
                        <td className={`${td} tabular text-right`}>{formatEur(l.principal_eur)}</td>
                        <td className={td}>{formatDate(l.drawn_on)} / {formatDate(l.due_on)}</td>
                        <td className={`${td} tabular text-right`}>{l.balance_eur !== null && l.balance_date ? <>{formatEur(l.balance_eur)}<span className="block text-xs text-ink/55">{formatDate(l.balance_date)}</span></> : <Missing />}</td>
                        <td className={td}>{l.allocated ? "Kyllä" : "Ei"}</td>
                        <td className={td}><Submitted at={l.htj_submitted_at} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {openLoans.some((l) => l.allocated) ? (
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <tr>
                        <th className={th}>Osakeryhmä</th>
                        {openLoans.filter((l) => l.allocated).map((l) => (
                          <th key={l.id} className={`${th} text-right`}>{l.name}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {shareGroupsForLoans.map((g) => (
                        <tr key={g.id}>
                          <td className={td}>{g.unit_label} <span className="text-xs text-ink/55">{SHARE_GROUP_KIND[g.kind]}</span></td>
                          {openLoans.filter((l) => l.allocated).map((l) => {
                            const s = data.loanShares.find((x) => x.loan_id === l.id && x.share_group_id === g.id);
                            return (
                              <td key={l.id} className={`${td} tabular text-right`}>
                                {!s ? <Missing /> : s.paid_off_on ? <span className="text-xs text-ink/60">maksettu {formatDate(s.paid_off_on)}</span> : (
                                  <>
                                    {formatEur(s.remaining_eur)}
                                    <span className="block text-xs text-ink/55">alkuperäinen {formatEur(s.original_eur)}, {formatDate(s.balance_date)}{s.htj_submitted_at ? " · ilmoitettu" : ""}</span>
                                  </>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </>
          )}
        </Section>

        <Section n={4} title="Kunnossapito- ja muutostyöt">
          {data.works.length === 0 ? (
            <p className="text-sm"><Missing>Töitä ei ole kirjattu</Missing></p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr><th className={th}>Hanke</th><th className={th}>Työlaji</th><th className={th}>Valmistunut</th><th className={th}>Tekijä</th><th className={th}>HTJ</th></tr>
                </thead>
                <tbody>
                  {data.works.map((w) => (
                    <tr key={w.id}>
                      <td className={td}>{w.project}</td>
                      <td className={td}>{isKnownWorkType(w.work_type) ? w.work_type : <Missing>{w.work_type} (tarkista työlaji)</Missing>}</td>
                      <td className={td}>{w.completed_year ?? <Missing />}</td>
                      <td className={td}>{w.performed_by === "shareholder" ? `Osakas${w.unit_label ? `, ${w.unit_label}` : ""}` : "Yhtiö"}</td>
                      <td className={td}><Submitted at={w.htj_submitted_at} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>

        <Section n={5} title={`Kunnossapitotarveselvitys ${data.year}–${data.year + 5}`}>
          {data.needs.length === 0 ? (
            <p className="text-sm"><Missing>Selvitys puuttuu</Missing></p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr><th className={th}>Vuosi</th><th className={th}>Kohde</th><th className={th}>Toimenpide</th><th className={th}>Työlaji</th><th className={th}>Tila</th><th className={th}>HTJ</th></tr>
                </thead>
                <tbody>
                  {data.needs.map((x) => (
                    <tr key={x.id}>
                      <td className={`${td} tabular`}>{x.planned_year}</td>
                      <td className={td}>{x.target}</td>
                      <td className={td}>{x.action}{x.affects_residents ? <span className="block text-xs text-ink/55">vaikuttaa asumiseen</span> : null}</td>
                      <td className={td}>{x.work_type ?? <Missing />}</td>
                      <td className={td}>{NEED_STATUS_LABEL[x.status as NeedStatus] ?? x.status}</td>
                      <td className={td}><Submitted at={x.htj_submitted_at} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>

        <footer className="mt-8 border-t border-line pt-3 text-xs text-ink/55">
          Tiedot on koottu eRapun rekisteristä. Ilmoita ne Maanmittauslaitoksen huoneistotietojärjestelmän asiointipalvelussa ja merkitse ilmoitus tehdyksi
          eRapun HTJ-välilehdellä. Tiedot päivitetään yhtiökokouksen jälkeen ja vähintään kerran vuodessa.
        </footer>
      </article>
    </div>
  );
}
