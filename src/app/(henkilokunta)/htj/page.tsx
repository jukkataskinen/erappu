import Link from "next/link";
import { FormError } from "@/components/FormError";
import { Badge, Button, EmptyState, Input, Notice, PageHeader, Stat, Table, Td, Th } from "@/components/ui";
import { requireStaff } from "@/lib/auth/current-user";
import { formatDateTime, isoDateHelsinki } from "@/lib/format";
import { REPORT_STATE_LABEL } from "@/lib/htj/htj2";
import { OBLIGATION_LABEL } from "@/lib/htj/obligation";
import { listHtjOverview, SYNC_STATUS_LABEL } from "@/lib/htj/queries";
import { markHtjManualDone } from "./actions";

export const metadata = { title: "HTJ" };

export default async function HtjHomePage({ searchParams }: { searchParams: Promise<{ virhe?: string; tila?: string }> }) {
  const ctx = await requireStaff();
  const { virhe, tila } = await searchParams;
  const rows = await ctx.run((tx) => listHtjOverview(tx, ctx.org.organizationId, isoDateHelsinki()));
  const isManager = ctx.can("owner", "manager");

  const done = (s: string) => s === "sent" || s === "manual_done";
  const mandatoryOpen = rows.filter((r) => r.obligation.level === "mandatory" && !done(r.state));
  const diffs = rows.reduce((s, r) => s + r.pendingDiffs, 0);
  const notSynced = rows.filter((r) => !r.syncedAt).length;

  return (
    <>
      <PageHeader
        title="HTJ ja HTJ2-ilmoitukset"
        subtitle="Osakeluetteloiden vertailu huoneistotietojärjestelmään ja taloyhtiöiden ilmoitukset: vastikkeet, lainat, kunnossapito- ja muutostyöt sekä kunnossapitotarveselvitys."
      />
      <FormError message={virhe} />
      {tila === "kasin" ? (
        <div className="mb-5" role="status">
          <Notice tone="ok" title="Yhtiön tiedot merkittiin käsin ilmoitetuiksi." />
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Pakollisia ilmoittamatta" value={mandatoryOpen.length} tone={mandatoryOpen.length ? "alert" : "ok"} />
        <Stat label="Käsittelemättömät HTJ-erot" value={diffs} tone={diffs ? "warn" : undefined} />
        <Stat label="Yhtiöitä ilman HTJ-vertailua" value={notSynced} tone={notSynced ? "warn" : "ok"} />
      </div>

      {mandatoryOpen.length > 0 ? (
        <div className="mt-6">
          <Notice tone="alert" title="HTJ2-ilmoitusten määräaika 30.6.2026 on mennyt">
            Rajapintayhteyden valmistumiseen asti ilmoitukset tehdään käsin MML:n asiointipalvelussa. Avaa yhtiön yhteenveto, täydennä puutteet, ilmoita tiedot ja merkitse ne
            tässä ilmoitetuiksi. Aloita lainallisista yhtiöistä, koska niiden tietoja pyydetään asuntokaupoissa.
          </Notice>
        </div>
      ) : null}

      <div className="mt-6">
        {rows.length === 0 ? (
          <EmptyState title="Ei taloyhtiöitä">Lisää taloyhtiöt rekisteriin, niin niiden HTJ-tilanne näkyy tässä.</EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Yhtiö</Th>
                <Th numeric>Huoneistot</Th>
                <Th>Velvollisuus</Th>
                <Th>HTJ-vertailu</Th>
                <Th>Ilmoitukset</Th>
                <Th>Puutteet</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <Td>
                    <Link href={`/taloyhtiot/${r.id}/htj`} className="font-semibold hover:text-sky">
                      {r.name}
                    </Link>
                    <p className="text-xs text-ink/55">{r.businessId}</p>
                  </Td>
                  <Td numeric>{r.obligation.unitCount}</Td>
                  <Td>
                    <Badge tone={r.obligation.level === "mandatory" ? "alert" : "neutral"}>{OBLIGATION_LABEL[r.obligation.level]}</Badge>
                    {r.obligation.hasAllocatedLoan ? <p className="mt-1 text-xs text-ink/55">jaettava laina</p> : null}
                  </Td>
                  <Td>
                    {r.syncedAt ? <span className="text-sm">{formatDateTime(r.syncedAt)}</span> : <Badge tone="warn">Ei tehty</Badge>}
                    {r.lastSync && r.lastSync.status === "error" ? <p className="mt-1 text-xs text-coral">Viimeisin haku: {SYNC_STATUS_LABEL.error.toLowerCase()}</p> : null}
                    {r.pendingDiffs > 0 ? (
                      <p className="mt-1">
                        <Link href={`/taloyhtiot/${r.id}/htj`} className="text-xs font-semibold text-amber">
                          {r.pendingDiffs} eroa odottaa
                        </Link>
                      </p>
                    ) : null}
                  </Td>
                  <Td>
                    <Badge tone={done(r.state) ? "ok" : r.state === "draft" ? "warn" : r.state === "rejected" ? "alert" : "neutral"}>{REPORT_STATE_LABEL[r.state]}</Badge>
                    {r.unsubmitted > 0 && done(r.state) ? <p className="mt-1 text-xs text-ink/55">{r.unsubmitted} uutta riviä ilmoittamatta</p> : null}
                  </Td>
                  <Td>
                    {r.gaps.length === 0 ? (
                      <span className="text-sm text-moss">Kunnossa</span>
                    ) : (
                      <details>
                        <summary className={`cursor-pointer text-sm font-semibold ${r.gaps.some((g) => g.severity === "alert") ? "text-coral" : "text-amber"}`}>{r.gaps.length} puutetta</summary>
                        <ul className="mt-1 max-w-xs list-disc pl-4 text-xs text-ink/75">
                          {r.gaps.map((g) => (
                            <li key={g.message}>{g.message}</li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </Td>
                  <Td className="text-right">
                    <div className="flex flex-col items-end gap-1">
                      <Link href={`/taloyhtiot/${r.id}/htj/yhteenveto`} className="text-sm font-semibold text-sky">
                        Yhteenveto
                      </Link>
                      {isManager && r.unsubmitted > 0 ? (
                        <details className="text-left">
                          <summary className="cursor-pointer text-xs text-ink/65">Merkitse ilmoitetuksi käsin</summary>
                          <form action={markHtjManualDone} className="mt-2 grid w-56 gap-2">
                            <input type="hidden" name="company_id" value={r.id} />
                            <input type="hidden" name="back" value="/htj" />
                            <Input name="note" placeholder="Lisätieto (valinnainen)" aria-label="Lisätieto" maxLength={500} />
                            <Button variant="secondary">Vahvista ({r.unsubmitted} riviä)</Button>
                          </form>
                        </details>
                      ) : null}
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </div>
    </>
  );
}
