import Link from "next/link";
import { CompanyHeader, loadCompany } from "@/components/CompanyHeader";
import { FormError } from "@/components/FormError";
import { Badge, Button, DefinitionList, EmptyState, LinkButton, Notice, Panel, SectionTitle, Table, Td, Th } from "@/components/ui";
import { requireStaff } from "@/lib/auth/current-user";
import { VISIBILITY_LABEL, VISIBILITY_TONE } from "@/lib/documents/labels";
import { formatDate, formatDateTime, isoDateHelsinki } from "@/lib/format";
import { RESCUE_PLAN_TEMPLATE_APPROVED } from "@/lib/rescue-plans/content";
import { currentAndDraft, listPlans } from "@/lib/rescue-plans/queries";
import { rescuePlanStatus } from "@/lib/registry/company-modules";
import { deleteRescuePlanDraft, startRescuePlanDraft } from "./actions";

export const metadata = { title: "Pelastussuunnitelma" };

const MESSAGES: Record<string, string> = {
  valmis: "Suunnitelma on tallennettu yhtiön dokumentteihin, ja seuraava tarkistus on vuosikellossa.",
  poistettu: "Luonnos poistettiin.",
};

export default async function RescuePlanPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ virhe?: string; tila?: string; liitevaroitus?: string }> }) {
  const ctx = await requireStaff();
  const { id } = await params;
  const sp = await searchParams;
  const company = await loadCompany(ctx, id);
  const today = isoDateHelsinki();
  const [plans, apartments] = await ctx.run((tx) =>
    Promise.all([
      listPlans(tx, id),
      tx.query<{ n: number }>("select count(*)::int as n from er_share_groups where company_id = $1 and removed_on is null and kind = 'apartment'", [id]),
    ]),
  );
  const { current, draft } = currentAndDraft(plans);
  const canWrite = ctx.can("owner", "manager", "assistant");
  const status = rescuePlanStatus(current?.next_review_on ?? null, Boolean(draft), today);
  const apartmentCount = apartments[0]?.n ?? 0;

  return (
    <>
      <CompanyHeader company={company} active="pelastussuunnitelma" />
      <FormError message={sp.virhe} />
      <div className="grid gap-6">
        {sp.tila && MESSAGES[sp.tila] ? <Notice tone="ok" title={MESSAGES[sp.tila]} /> : null}
        {sp.liitevaroitus ? <Notice tone="warn" title="Kaikkia liitteitä ei voitu liittää PDF:ään.">Tarkista liiteluettelo suunnitelman lopusta.</Notice> : null}
        {apartmentCount > 0 && apartmentCount < 3 ? (
          <Notice tone="info" title="Pelastussuunnitelma ei välttämättä ole pakollinen">
            Velvollisuus koskee asuinrakennuksia, joissa on vähintään kolme asuinhuoneistoa (VNa 407/2011 1 §). Yhtiöön on kirjattu {apartmentCount} huoneistoa.
          </Notice>
        ) : null}
        {!RESCUE_PLAN_TEMPLATE_APPROVED ? (
          <Notice tone="warn" title="Vakiotekstit odottavat hyväksyntää">
            Riskiarvion oletukset ja toimintaohjeet ovat luonnoksia, ja PDF:ssä on luonnosmerkintä, kunnes pohja on tarkistettu.
          </Notice>
        ) : null}

        <Panel>
          <SectionTitle actions={<Badge tone={status.tone === "ok" ? "ok" : status.tone === "alert" ? "alert" : "warn"}>{status.text}</Badge>}>Voimassa oleva suunnitelma</SectionTitle>
          {current ? (
            <div className="grid gap-4">
              <DefinitionList
                items={[
                  { label: "Versio", value: current.version },
                  { label: "Laadittu", value: formatDate(current.prepared_on) },
                  { label: "Seuraava tarkistus", value: formatDate(current.next_review_on) },
                  { label: "Näkyvyys", value: <Badge tone={VISIBILITY_TONE[current.visibility]}>{VISIBILITY_LABEL[current.visibility]}</Badge> },
                  { label: "Valmiiksi merkinnyt", value: current.finalized_by_name ? `${current.finalized_by_name}, ${formatDateTime(current.finalized_at)}` : formatDateTime(current.finalized_at) },
                  { label: "Kokoontumispaikka", value: current.content.assemblyPoint || "–" },
                ]}
              />
              <div className="flex flex-wrap gap-2">
                {current.document_id ? (
                  <a href={`/api/dokumentit/${current.document_id}`} target="_blank" rel="noopener" className="inline-flex min-h-[var(--size-touch)] items-center rounded-full bg-ink px-5 text-sm font-semibold text-paper hover:bg-ink-strong">
                    Avaa PDF
                  </a>
                ) : null}
                {canWrite && !draft ? (
                  <form action={startRescuePlanDraft}>
                    <input type="hidden" name="company_id" value={id} />
                    <Button variant="secondary">Päivitä suunnitelma (uusi versio)</Button>
                  </form>
                ) : null}
              </div>
            </div>
          ) : draft ? (
            <p className="text-sm text-ink/65">Suunnitelmaa ei ole vielä merkitty valmiiksi. Jatka luonnosta alla.</p>
          ) : (
            <EmptyState
              title="Yhtiölle ei ole laadittu pelastussuunnitelmaa eRapussa"
              action={
                canWrite ? (
                  <form action={startRescuePlanDraft}>
                    <input type="hidden" name="company_id" value={id} />
                    <Button>Laadi pelastussuunnitelma</Button>
                  </form>
                ) : null
              }
            >
              Lomake esitäytetään rekisterin tiedoista (rakennukset, lämmitys, yhteiset tilat, isännöitsijä, hallituksen puheenjohtaja ja kiinteistöhuolto). Aiemman paperisen
              suunnitelman voi tallentaa dokumentteihin luokkaan Pelastussuunnitelma.
            </EmptyState>
          )}
        </Panel>

        {draft ? (
          <Panel>
            <SectionTitle actions={<Badge tone="warn">Luonnos</Badge>}>Versio {draft.version}</SectionTitle>
            <p className="text-sm text-ink/65">
              Viimeksi tallennettu {formatDateTime(draft.updated_at)}
              {draft.updated_by_name ? `, ${draft.updated_by_name}` : ""}.
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              {canWrite ? <LinkButton href={`/taloyhtiot/${id}/pelastussuunnitelma/luonnos`}>Jatka luonnosta</LinkButton> : null}
              <a href={`/taloyhtiot/${id}/pelastussuunnitelma/${draft.id}/esikatselu`} target="_blank" rel="noopener" className="inline-flex min-h-[var(--size-touch)] items-center rounded-full border border-line bg-paper px-5 text-sm font-semibold hover:border-ink/30">
                Esikatsele PDF
              </a>
              {canWrite ? (
                <form action={deleteRescuePlanDraft}>
                  <input type="hidden" name="company_id" value={id} />
                  <input type="hidden" name="plan_id" value={draft.id} />
                  <Button variant="ghost">Poista luonnos</Button>
                </form>
              ) : null}
            </div>
          </Panel>
        ) : null}

        {plans.some((p) => p.status === "final") ? (
          <section>
            <h2 className="mb-3 text-lg">Versiohistoria</h2>
            <Table>
              <thead>
                <tr>
                  <Th>Versio</Th>
                  <Th>Laadittu</Th>
                  <Th className="hidden sm:table-cell">Tila</Th>
                  <Th>PDF</Th>
                </tr>
              </thead>
              <tbody>
                {plans
                  .filter((p) => p.status === "final")
                  .map((p) => (
                    <tr key={p.id}>
                      <Td>{p.version}</Td>
                      <Td>{formatDate(p.prepared_on)}</Td>
                      <Td className="hidden sm:table-cell">{p.superseded_at ? <Badge>Korvattu {formatDate(p.superseded_at)}</Badge> : <Badge tone="ok">Voimassa</Badge>}</Td>
                      <Td>
                        {p.document_id ? (
                          <a href={`/api/dokumentit/${p.document_id}`} target="_blank" rel="noopener" className="text-sky">
                            Avaa
                          </a>
                        ) : (
                          "–"
                        )}
                      </Td>
                    </tr>
                  ))}
              </tbody>
            </Table>
            <p className="mt-2 text-xs text-ink/55">
              Korvattujen versioiden PDF:t säilyvät henkilökunnan dokumenteissa. Asukkaat näkevät vain voimassa olevan version.{" "}
              <Link href={`/taloyhtiot/${id}/vuosikello`} className="text-sky">
                Vuosikello
              </Link>
            </p>
          </section>
        ) : null}
      </div>
    </>
  );
}
