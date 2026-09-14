import { CompanyHeader, loadCompany } from "@/components/CompanyHeader";
import { FormError } from "@/components/FormError";
import { Badge, Button, EmptyState, Input, LinkButton, Notice, Panel, SectionTitle, Table, Td, Th } from "@/components/ui";
import { requireStaff } from "@/lib/auth/current-user";
import { formatDateTime, isoDateHelsinki } from "@/lib/format";
import { OBLIGATION_LABEL } from "@/lib/htj/obligation";
import { loadHtj2Data, REPORT_STATE_LABEL, SUBMISSION_KIND_LABEL, SUBMISSION_KINDS, SUBMISSION_STATUS_LABEL, unsubmittedRows } from "@/lib/htj/htj2";
import {
  companyHtjOverview,
  listPendingDiffs,
  listRequests,
  listSubmissions,
  listSyncs,
  REQUEST_OPERATION_LABEL,
  REQUEST_PURPOSE_LABEL,
  SYNC_STATUS_LABEL,
} from "@/lib/htj/queries";
import type { HtjSubmissionKind } from "@/lib/htj/types";
import {
  approveHtjSubmission,
  decideHtjDiffs,
  discardHtjDraft,
  fetchFromHtj,
  markHtjManualDone,
  prepareHtjSubmission,
  sendHtjSubmission,
} from "@/app/(henkilokunta)/htj/actions";
import { DiffDetails } from "./DiffDetails";

export const metadata = { title: "HTJ" };

const STATE_MESSAGE: Record<string, string> = {
  haettu: "Tiedot haettiin HTJ:stä. Tarkista erot ja hyväksy ne, jotka kirjataan rekisteriin.",
  tasmaa: "Tiedot haettiin HTJ:stä, ja rekisteri täsmää HTJ:n kanssa.",
  hyvaksytty: "Hyväksytyt erot kirjattiin rekisteriin ja portaalioikeudet päivitettiin.",
  hylatty: "Erot hylättiin. Rekisteriä ei muutettu.",
  luonnos: "Ilmoitusluonnos muodostettiin. Isännöitsijä hyväksyy sen ennen lähetystä.",
  "luonnos-poistettu": "Luonnos poistettiin.",
  "ilmoitus-hyvaksytty": "Ilmoitus hyväksyttiin ja se odottaa lähetystä.",
  lahetetty: "Ilmoitus lähetettiin HTJ:hin ja rivit merkittiin ilmoitetuiksi.",
  kasin: "Tiedot merkittiin käsin ilmoitetuiksi.",
};

const ACTION_LABEL: Record<string, string> = { add: "Lisäys", update: "Muutos", remove: "Poisto" };
const ACTION_TONE: Record<string, "ok" | "info" | "alert"> = { add: "ok", update: "info", remove: "alert" };

export default async function CompanyHtjPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ virhe?: string; tila?: string }> }) {
  const ctx = await requireStaff();
  const { id } = await params;
  const { virhe, tila } = await searchParams;
  const company = await loadCompany(ctx, id);
  const today = isoDateHelsinki();
  const isManager = ctx.can("owner", "manager");
  const canPrepare = ctx.can("owner", "manager", "accountant", "assistant");

  const [overview, data, diffs, syncs, submissions, requests] = await ctx.run(async (tx) => [
    await companyHtjOverview(tx, id, today),
    await loadHtj2Data(tx, id, today),
    await listPendingDiffs(tx, id),
    await listSyncs(tx, id),
    await listSubmissions(tx, id),
    isManager ? await listRequests(tx, id) : [],
  ] as const);
  const o = overview!;
  const pending = unsubmittedRows(data!);
  const latestFetch = syncs.find((s) => s.kind === "fetch");
  const warnings = (latestFetch?.summary?.warnings as string[] | undefined) ?? [];
  const restricted = (latestFetch?.summary?.restrictedGroups as string[] | undefined) ?? [];

  return (
    <>
      <CompanyHeader
        company={company}
        active="htj"
        actions={
          <>
            <LinkButton variant="secondary" href={`/taloyhtiot/${id}/htj/yhteenveto`}>
              HTJ2-yhteenveto
            </LinkButton>
            {isManager ? (
              <form action={fetchFromHtj}>
                <input type="hidden" name="company_id" value={id} />
                <Button>Hae HTJ:stä</Button>
              </form>
            ) : null}
          </>
        }
      />
      <FormError message={virhe} />
      {tila && STATE_MESSAGE[tila] ? (
        <div className="mb-5" role="status">
          <Notice tone="ok" title={STATE_MESSAGE[tila]} />
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <div className="grid content-start gap-6">
          <section>
            <SectionTitle
              actions={
                diffs.length > 0 && isManager ? (
                  <div className="flex gap-2">
                    <form action={decideHtjDiffs}>
                      <input type="hidden" name="company_id" value={id} />
                      <input type="hidden" name="scope" value="all" />
                      <Button name="decision" value="accept">Hyväksy kaikki</Button>
                    </form>
                  </div>
                ) : null
              }
            >
              Erot rekisterin ja HTJ:n välillä
            </SectionTitle>
            {warnings.length > 0 ? (
              <div className="mb-3">
                <Notice tone="warn" title="Yhtiön tiedoissa huomioitavaa">
                  <ul className="list-disc pl-5">
                    {warnings.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                  <p className="mt-1">Yhtiön perustiedot ovat eRapun omia, joten ne korjataan yhtiön tietoihin käsin.</p>
                </Notice>
              </div>
            ) : null}
            {diffs.length === 0 ? (
              <EmptyState title={o.syncedAt ? "Ei käsittelemättömiä eroja" : "Yhtiötä ei ole vielä haettu HTJ:stä"}>
                {o.syncedAt
                  ? `Rekisteri on vertailtu HTJ:hin ${formatDateTime(o.syncedAt)}. Muutostietojen yöajo tuo uudet omistajanvaihdokset tähän hyväksyttäviksi.`
                  : "Hae tiedot HTJ:stä. Haku ei muuta rekisteriä: erot tulevat tähän listaan, ja vain hyväksytyt kirjataan. HTJ on omistustietojen päälähde."}
              </EmptyState>
            ) : (
              <form action={decideHtjDiffs}>
                <input type="hidden" name="company_id" value={id} />
                <Table>
                  <thead>
                    <tr>
                      <Th className="w-8" />
                      <Th>Muutos</Th>
                      <Th>Tiedot</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {diffs.map((d) => (
                      <tr key={d.id}>
                        <Td>
                          {isManager ? (
                            <input type="checkbox" name="diff_ids" value={d.id} aria-label={`Valitse: ${d.label}`} className="size-4" />
                          ) : null}
                        </Td>
                        <Td>
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge tone={ACTION_TONE[d.action]}>{ACTION_LABEL[d.action]}</Badge>
                            <span className="font-semibold">{d.label}</span>
                          </div>
                        </Td>
                        <Td>
                          <DiffDetails diff={d} />
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
                {isManager ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button name="decision" value="accept" variant="secondary">
                      Hyväksy valitut
                    </Button>
                    <Button name="decision" value="reject" variant="ghost">
                      Hylkää valitut
                    </Button>
                  </div>
                ) : (
                  <p className="mt-3 text-sm text-ink/60">Isännöitsijä tai pääkäyttäjä hyväksyy erot.</p>
                )}
              </form>
            )}
            {restricted.length > 0 ? (
              <p className="mt-3 text-sm text-ink/65">HTJ:ssä on rajoitusmerkintöjä osakeryhmillä: {restricted.join(", ")}. Tarkista ne HTJ:stä ennen isännöitsijäntodistusta.</p>
            ) : null}
          </section>

          <section>
            <SectionTitle>HTJ2-ilmoitusjono</SectionTitle>
            <Table>
              <thead>
                <tr>
                  <Th>Tieto</Th>
                  <Th numeric>Ilmoittamatta</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {SUBMISSION_KINDS.map((k: HtjSubmissionKind) => (
                  <tr key={k}>
                    <Td className="font-semibold">{SUBMISSION_KIND_LABEL[k]}</Td>
                    <Td numeric>{pending[k].length}</Td>
                    <Td className="text-right">
                      {canPrepare && pending[k].length > 0 ? (
                        <form action={prepareHtjSubmission}>
                          <input type="hidden" name="company_id" value={id} />
                          <input type="hidden" name="kind" value={k} />
                          <button className="text-sm font-semibold text-sky">Muodosta luonnos</button>
                        </form>
                      ) : null}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>

            {submissions.length > 0 ? (
              <div className="mt-4">
                <Table>
                  <thead>
                    <tr>
                      <Th>Ilmoitus</Th>
                      <Th>Tila</Th>
                      <Th numeric>Rivit</Th>
                      <Th>Käsittely</Th>
                      <Th />
                    </tr>
                  </thead>
                  <tbody>
                    {submissions.map((s) => (
                      <tr key={s.id}>
                        <Td className="font-semibold">{SUBMISSION_KIND_LABEL[s.kind as HtjSubmissionKind]}</Td>
                        <Td>
                          <Badge tone={s.status === "accepted" || s.status === "manual_done" ? "ok" : s.status === "rejected" ? "alert" : s.status === "approved" ? "info" : "warn"}>
                            {SUBMISSION_STATUS_LABEL[s.status]}
                          </Badge>
                          {s.error ? <p className="mt-1 text-xs text-coral">{s.error}</p> : null}
                        </Td>
                        <Td numeric>{s.payload?.items?.length ?? 0}</Td>
                        <Td className="text-xs text-ink/65">
                          <p>Laadittu {formatDateTime(s.created_at)}{s.prepared_by_name ? `, ${s.prepared_by_name}` : ""}</p>
                          {s.approved_at ? <p>Hyväksytty {formatDateTime(s.approved_at)}{s.approved_by_name ? `, ${s.approved_by_name}` : ""}</p> : null}
                          {s.sent_at ? <p>Lähetetty {formatDateTime(s.sent_at)}{s.response?.reference ? ` (${s.response.reference})` : ""}</p> : null}
                          {s.note ? <p>{s.note}</p> : null}
                        </Td>
                        <Td className="text-right">
                          <div className="flex flex-col items-end gap-1">
                            {s.status === "draft" && isManager ? (
                              <form action={approveHtjSubmission}>
                                <input type="hidden" name="company_id" value={id} />
                                <input type="hidden" name="id" value={s.id} />
                                <button className="text-sm font-semibold text-sky">Hyväksy</button>
                              </form>
                            ) : null}
                            {s.status === "draft" && canPrepare ? (
                              <form action={discardHtjDraft}>
                                <input type="hidden" name="company_id" value={id} />
                                <input type="hidden" name="id" value={s.id} />
                                <button className="text-xs text-coral">Poista luonnos</button>
                              </form>
                            ) : null}
                            {s.status === "approved" && isManager ? (
                              <form action={sendHtjSubmission}>
                                <input type="hidden" name="company_id" value={id} />
                                <input type="hidden" name="id" value={s.id} />
                                <button className="text-sm font-semibold text-sky">Lähetä HTJ:hin</button>
                              </form>
                            ) : null}
                          </div>
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
            ) : null}
          </section>
        </div>

        <div className="grid content-start gap-6">
          <Panel>
            <SectionTitle>HTJ2-ilmoitusvelvollisuus</SectionTitle>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={o.obligation.level === "mandatory" ? "alert" : "neutral"}>{OBLIGATION_LABEL[o.obligation.level]}</Badge>
              <Badge tone={o.state === "sent" || o.state === "manual_done" ? "ok" : o.state === "draft" ? "warn" : "neutral"}>{REPORT_STATE_LABEL[o.state]}</Badge>
            </div>
            <ul className="mt-3 list-disc pl-5 text-sm text-ink/75">
              {o.obligation.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
            {o.gaps.length > 0 ? (
              <div className="mt-4">
                <Notice tone={o.gaps.some((g) => g.severity === "alert") ? "alert" : "warn"} title={`Puutteet (${o.gaps.length})`}>
                  <ul className="list-disc pl-5">
                    {o.gaps.map((g) => (
                      <li key={g.message}>{g.message}</li>
                    ))}
                  </ul>
                </Notice>
              </div>
            ) : (
              <p className="mt-3 text-sm text-moss">Ilmoitettavat tiedot ovat kunnossa.</p>
            )}
            {isManager && o.unsubmitted > 0 ? (
              <form action={markHtjManualDone} className="mt-4 grid gap-2 border-t border-line pt-4">
                <input type="hidden" name="company_id" value={id} />
                <label htmlFor="note" className="text-sm font-semibold">
                  Ilmoitettu käsin MML:n asiointipalvelussa
                </label>
                <Input id="note" name="note" placeholder="Lisätieto, esim. päivä ja ilmoittaja" maxLength={500} />
                <div>
                  <Button variant="secondary">Merkitse ilmoitetuksi käsin</Button>
                </div>
                <p className="text-xs text-ink/55">Merkitsee {o.unsubmitted} ilmoittamatonta riviä ilmoitetuiksi ja kirjaa merkinnän jonoon.</p>
              </form>
            ) : null}
          </Panel>

          <Panel>
            <SectionTitle>Synkronoinnit</SectionTitle>
            {syncs.length === 0 ? (
              <p className="text-sm text-ink/65">Ei hakuja eikä ilmoituksia.</p>
            ) : (
              <ul className="divide-y divide-line text-sm">
                {syncs.map((s) => (
                  <li key={s.id} className="py-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold">
                        {s.kind === "fetch" ? (s.target === "changes" ? "Muutostiedot" : "Haku") : `Ilmoitus: ${SUBMISSION_KIND_LABEL[s.target as HtjSubmissionKind] ?? s.target}`}
                      </span>
                      <Badge tone={s.status === "ok" ? "ok" : s.status === "error" ? "alert" : s.status === "warnings" ? "warn" : "neutral"}>{SYNC_STATUS_LABEL[s.status]}</Badge>
                    </div>
                    <p className="text-xs text-ink/60">
                      {formatDateTime(s.started_at)} · {s.started_by_name ?? "ajastettu tehtävä"}
                    </p>
                    {s.error ? <p className="text-xs text-coral">{s.error}</p> : null}
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          {isManager ? (
            <Panel>
              <SectionTitle>Hakuloki</SectionTitle>
              <p className="mb-2 text-xs text-ink/55">MML:n ehtojen mukainen loki: kuka haki, milloin, mitä ja mihin tarkoitukseen. Omistajat haetaan suppealla haulla.</p>
              {requests.length === 0 ? (
                <p className="text-sm text-ink/65">Ei hakuja.</p>
              ) : (
                <ul className="divide-y divide-line text-xs">
                  {requests.map((q) => (
                    <li key={q.id} className="flex flex-wrap justify-between gap-2 py-1.5">
                      <span>
                        {REQUEST_OPERATION_LABEL[q.operation] ?? q.operation}
                        {q.scope ? ` (${q.scope === "wide" ? "laaja" : "suppea"})` : ""} · {REQUEST_PURPOSE_LABEL[q.purpose] ?? q.purpose}
                        {q.mode === "mock" ? " · jäljitelmä" : ""}
                      </span>
                      <span className="text-ink/55">
                        {formatDateTime(q.created_at)} · {q.user_name ?? "ajastettu"}
                        {q.outcome !== "ok" ? ` · ${q.outcome === "not_found" ? "ei löytynyt" : "virhe"}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          ) : null}
        </div>
      </div>
    </>
  );
}
