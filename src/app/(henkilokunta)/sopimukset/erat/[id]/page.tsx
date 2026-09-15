import Link from "next/link";
import { notFound } from "next/navigation";
import { FormError } from "@/components/FormError";
import { Badge, Button, Field, Input, Notice, PageHeader, Panel, SectionTitle, Select, Table, Td, Th } from "@/components/ui";
import { requireStaff } from "@/lib/auth/current-user";
import { getTemplate, type FieldDef } from "@/lib/contract-templates";
import { effectiveValues, validateBatch } from "@/lib/contract-templates/batches";
import {
  BATCH_STATUS_LABEL,
  BATCH_STATUS_TONE,
  getBatch,
  ITEM_STATUS_LABEL,
  ITEM_STATUS_TONE,
  listActiveCompanies,
  listBatchItems,
  listProviderOptions,
} from "@/lib/contract-templates/queries";
import { formatFieldValue, validateValues } from "@/lib/contract-templates/render";
import { canSimulateSigning, isUsingMockEsinetti } from "@/lib/esinetti";
import { formatDate, formatDateTime, isoDateHelsinki } from "@/lib/format";
import { FieldInput } from "../FieldInput";
import {
  cancelBatchAction,
  generateBatchAction,
  renewBatchAction,
  sendBatchAction,
  setBatchCompaniesAction,
  simulateContractSigningAction,
  updateBatchDetailsAction,
  updateBatchItemsAction,
} from "../actions";

export const metadata = { title: "Sopimuserä" };

type Search = { virhe?: string; tallennettu?: string; muodostettu?: string; lahetetty?: string; epaonnistui?: string; uusittu?: string };

const SIGNER_STATUS: Record<string, string> = {
  pending: "odottaa",
  opened: "avannut",
  identified: "tunnistautunut",
  signed: "allekirjoittanut",
  declined: "hylännyt",
};

export default async function BatchPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Search> }) {
  const ctx = await requireStaff();
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const data = await ctx.run(async (tx) => {
    const batch = await getBatch(tx, id);
    if (!batch || batch.organization_id !== ctx.org.organizationId) return null;
    const [items, companies, providers, previousItems] = await Promise.all([
      listBatchItems(tx, id),
      listActiveCompanies(tx, ctx.org.organizationId),
      listProviderOptions(tx, ctx.org.organizationId),
      batch.previous_batch_id ? listBatchItems(tx, batch.previous_batch_id) : Promise.resolve([]),
    ]);
    return { batch, items, companies, providers, previousItems };
  });
  if (!data) notFound();
  const { batch, items, companies, providers, previousItems } = data;
  const template = getTemplate(batch.template_key);
  if (!template) notFound();

  const today = isoDateHelsinki();
  const canWrite = ctx.can("owner", "manager", "assistant");
  const canManage = ctx.can("owner", "manager");
  const editable = canWrite && (batch.status === "draft" || batch.status === "generated");
  const pending = items.filter((i) => i.status === "draft" || i.status === "generated");
  const problems = pending.length ? validateBatch(template, batch, pending, today) : [];
  const sharedFields = template.fields.filter((f) => f.scope === "batch" && f.type !== "provider");
  const itemFields: FieldDef[] = [...template.fields.filter((f) => f.scope === "company"), ...template.fields.filter((f) => f.scope === "batch" && f.overridable)];
  const itemIds = new Set(items.map((i) => i.company_id));
  const previousByCompany = new Map(previousItems.map((i) => [i.company_id, i]));
  const sendable = items.filter((i) => ["generated", "error", "declined"].includes(i.status) && i.document_id);
  const signedCount = items.filter((i) => i.status === "signed").length;
  const sentCount = items.filter((i) => ["sent", "signed", "declined"].includes(i.status)).length;
  const generatedCount = items.filter((i) => i.document_id).length;
  const hidden = <input type="hidden" name="batch_id" value={batch.id} />;

  const steps = [
    { n: 1, href: "#tiedot", label: "Tiedot", done: !!batch.provider_id },
    { n: 2, href: "#yhtiot", label: "Yhtiöt ja arvot", done: items.length > 0 && problems.length === 0 },
    { n: 3, href: "#muodosta", label: "Muodosta", done: items.length > 0 && generatedCount === items.length },
    { n: 4, href: "#laheta", label: "Lähetä", done: items.length > 0 && sentCount === items.length },
    { n: 5, href: "#seuranta", label: "Seuranta", done: items.length > 0 && signedCount === items.length },
  ];

  return (
    <>
      <PageHeader
        title={batch.title}
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-2">
            {template.name} · {batch.provider_name ?? "urakoitsija puuttuu"}
            <Badge tone={BATCH_STATUS_TONE[batch.status]}>{BATCH_STATUS_LABEL[batch.status]}</Badge>
          </span>
        }
        back={{ href: "/sopimukset/erat", label: "Massaluonti" }}
        actions={
          <>
            {canWrite && batch.status !== "draft" ? (
              <form action={renewBatchAction}>
                {hidden}
                <Button variant="secondary">Tee seuraavan kauden erä</Button>
              </form>
            ) : null}
            {canManage && batch.status !== "cancelled" && batch.status !== "completed" ? (
              <form action={cancelBatchAction}>
                {hidden}
                <Button variant="ghost">Peru erä</Button>
              </form>
            ) : null}
          </>
        }
      />
      <FormError message={sp.virhe} />
      {sp.tallennettu ? <div className="mb-5"><Notice tone="ok" title="Tallennettu" /></div> : null}
      {sp.uusittu ? (
        <div className="mb-5">
          <Notice tone="ok" title="Seuraavan kauden erä luotu">
            Voimassaolo siirtyi vuodella, hinnat ja yhtiökohtaiset arvot kopioitiin. Tilaajan edustajat haettiin rekisteristä uudelleen; muutokset on merkitty taulukkoon.
          </Notice>
        </div>
      ) : null}
      {sp.muodostettu ? <div className="mb-5"><Notice tone="ok" title={`Sopimuksia muodostettu: ${Number(sp.muodostettu) || 0}`}>Tarkista PDF:t ennen lähetystä.</Notice></div> : null}
      {sp.lahetetty ? (
        <div className="mb-5">
          <Notice tone={Number(sp.epaonnistui) > 0 ? "warn" : "ok"} title={`Lähetetty allekirjoitettavaksi: ${Number(sp.lahetetty) || 0}`}>
            {Number(sp.epaonnistui) > 0 ? `Epäonnistui: ${Number(sp.epaonnistui)}. Virheet näkyvät seurantataulukossa, ja rivin voi lähettää uudelleen.` : null}
          </Notice>
        </div>
      ) : null}

      <ol className="mb-6 flex flex-wrap gap-2 text-sm" aria-label="Vaiheet">
        {steps.map((s) => (
          <li key={s.n}>
            <a href={s.href} className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 ${s.done ? "border-moss/30 bg-moss-soft text-moss" : "border-line bg-paper text-ink/70 hover:border-ink/30"}`}>
              <span className="font-semibold">{s.n}</span> {s.label}
            </a>
          </li>
        ))}
      </ol>

      <div className="grid gap-6">
        <Panel id="tiedot">
          <SectionTitle>1. Tiedot</SectionTitle>
          {batch.previous_batch_id ? (
            <p className="mb-3 text-sm text-ink/65">
              Edellinen kausi: <Link href={`/sopimukset/erat/${batch.previous_batch_id}`} className="text-sky">{batch.previous_title}</Link>
            </p>
          ) : null}
          <form action={updateBatchDetailsAction} className="grid gap-4">
            {hidden}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Otsikko" htmlFor="title">
                <Input id="title" name="title" defaultValue={batch.title} maxLength={200} required disabled={!editable} />
              </Field>
              <Field label="Urakoitsija" htmlFor="provider_id" hint={<Link href="/palveluntuottajat" className="text-sky">Palveluntuottajat</Link>}>
                <Select id="provider_id" name="provider_id" defaultValue={batch.provider_id ?? ""} disabled={!editable} className={!batch.provider_id ? "border-coral" : ""}>
                  <option value="">Valitse urakoitsija</option>
                  {providers.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </Select>
              </Field>
              {sharedFields.map((f) => {
                const missing = f.required && (batch.shared_values[f.key] === null || batch.shared_values[f.key] === undefined || batch.shared_values[f.key] === "");
                return (
                  <Field key={f.key} label={f.label} htmlFor={`shared_${f.key}`} hint={f.hint} error={missing ? "Puuttuu" : null}>
                    <FieldInput field={f} id={`shared_${f.key}`} name={`shared[${f.key}]`} value={batch.shared_values[f.key]} invalid={missing} disabled={!editable} />
                  </Field>
                );
              })}
            </div>
            {editable ? (
              <div>
                <Button variant="secondary">Tallenna tiedot</Button>
                {batch.status === "generated" ? <p className="mt-2 text-xs text-ink/55">Muutos palauttaa sopimukset luonnokseksi; muodosta ne uudelleen.</p> : null}
              </div>
            ) : null}
          </form>
        </Panel>

        <Panel id="yhtiot">
          <SectionTitle>2. Yhtiöt ja yhtiökohtaiset arvot</SectionTitle>
          {editable ? (
            <details className="mb-4 rounded-xl border border-line p-3" open={items.length === 0}>
              <summary className="cursor-pointer text-sm font-semibold">Valitse yhtiöt ({items.length}/{companies.length})</summary>
              <form action={setBatchCompaniesAction} className="mt-3">
                {hidden}
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {companies.map((c) => (
                    <label key={c.id} className="flex items-center gap-3 rounded-xl border border-line px-3 py-2 text-sm">
                      <input type="checkbox" name="company_ids" value={c.id} defaultChecked={itemIds.has(c.id)} className="h-5 w-5" />
                      {c.name}
                    </label>
                  ))}
                </div>
                <Button variant="secondary" className="mt-3">Tallenna valinta</Button>
              </form>
            </details>
          ) : null}

          {items.length === 0 ? (
            <p className="text-sm text-ink/65">Erässä ei ole yhtiöitä.</p>
          ) : (
            <form action={updateBatchItemsAction}>
              {hidden}
              <Table>
                <thead>
                  <tr>
                    <Th>Yhtiö</Th>
                    {itemFields.map((f) => (
                      <Th key={f.key}>{f.label}{f.scope === "batch" ? " (poikkeus)" : ""}</Th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => {
                    const errors = new Set(validateValues(template, effectiveValues(template, batch, item)).map((e) => e.key));
                    const rowEditable = editable && (item.status === "draft" || item.status === "generated");
                    const prev = previousByCompany.get(item.company_id);
                    return (
                      <tr key={item.id}>
                        <Td className="min-w-44">
                          <span className="font-semibold">{item.company_name}</span>
                          <span className="mt-1 block"><Badge tone={ITEM_STATUS_TONE[item.status]}>{ITEM_STATUS_LABEL[item.status]}</Badge></span>
                        </Td>
                        {itemFields.map((f) => {
                          const changed = prev && f.source?.startsWith("representative.") && (prev.values[f.key] ?? null) !== (item.values[f.key] ?? null);
                          return (
                            <Td key={f.key} className={f.type === "boolean" ? "min-w-24" : f.type === "money" ? "min-w-28" : "min-w-48"}>
                              <FieldInput
                                field={f}
                                id={`i_${item.company_id}_${f.key}`}
                                name={`items[${item.company_id}][${f.key}]`}
                                value={item.values[f.key]}
                                placeholder={f.scope === "batch" ? formatFieldValue(f, batch.shared_values[f.key]) || "yhteinen" : undefined}
                                invalid={errors.has(f.key)}
                                disabled={!rowEditable}
                                compact
                              />
                              {changed ? <span className="mt-1 block text-xs text-amber">Muuttunut, aiemmin: {formatFieldValue(f, prev.values[f.key]) || "–"}</span> : null}
                            </Td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
              <p className="mt-2 text-xs text-ink/55">Punaisella korostetut tiedot puuttuvat tai ovat virheellisiä. Hintapoikkeaman voi jättää tyhjäksi, jolloin käytetään yhteistä hintaa.</p>
              {editable ? <Button variant="secondary" className="mt-3">Tallenna yhtiökohtaiset arvot</Button> : null}
            </form>
          )}
        </Panel>

        <Panel id="muodosta">
          <SectionTitle>3. Muodosta sopimukset</SectionTitle>
          {problems.length > 0 ? (
            <div className="mb-4">
              <Notice tone="warn" title="Täydennä ennen muodostusta">
                <ul className="mt-1 list-disc pl-5">
                  {problems.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              </Notice>
            </div>
          ) : null}
          <p className="mb-3 text-sm text-ink/65">
            Muodostus tekee jokaiselle yhtiölle PDF:n ja sopimusrekisterin rivin (voimassa {formatFieldValue(template.fields.find((f) => f.key === template.endsOnField), batch.shared_values[template.endsOnField ?? ""]) || "–"} asti, irtisanomisaika {template.noticeMonths ?? "–"} kk). Jos yhdenkin yhtiön tiedot puuttuvat, mitään ei muodosteta.
            {!template.approved ? " Pohjaa ei ole hyväksytty, joten PDF:ssä on luonnosmerkintä." : ""}
          </p>
          {editable && pending.length > 0 ? (
            <form action={generateBatchAction}>
              {hidden}
              <Button disabled={problems.length > 0}>{generatedCount > 0 ? "Muodosta sopimukset uudelleen" : "Muodosta sopimukset"}</Button>
              {generatedCount > 0 && !canManage ? <p className="mt-2 text-xs text-ink/55">Uudelleenmuodostus vaatii pääkäyttäjän tai isännöitsijän oikeudet.</p> : null}
            </form>
          ) : (
            <p className="text-sm text-ink/55">{generatedCount > 0 ? `Muodostettu ${generatedCount}/${items.length}.` : "Ei muodostettavia sopimuksia."}</p>
          )}
        </Panel>

        <Panel id="laheta">
          <SectionTitle>4. Lähetä allekirjoitettavaksi</SectionTitle>
          <p className="mb-3 text-sm text-ink/65">
            Jokaisesta sopimuksesta tehdään oma eSinetti-kierros: tilaajan edustaja ja urakoitsijan edustaja allekirjoittavat vahvalla tunnistuksella, kierros on voimassa 30 päivää. Sinetöity sopimus tallentuu yhtiön dokumentteihin ja korvaa luonnoksen sopimusrekisterissä.
            {isUsingMockEsinetti() ? " Kehitystilassa käytössä on eSinetin jäljitelmä." : ""}
          </p>
          {!canManage ? (
            <p className="text-sm text-ink/55">Sopimukset lähettää allekirjoitettavaksi pääkäyttäjä tai isännöitsijä.</p>
          ) : sendable.length === 0 ? (
            <p className="text-sm text-ink/55">{batch.status === "draft" ? "Muodosta sopimukset ensin." : "Ei lähetettäviä sopimuksia."}</p>
          ) : (
            <form action={sendBatchAction} id="send-form" className="flex flex-wrap gap-2">
              {hidden}
              <Button name="scope" value="all">Lähetä kaikki ({sendable.length})</Button>
              <Button name="scope" value="selected" variant="secondary">Lähetä valitut</Button>
              <p className="w-full text-xs text-ink/55">Valitse rivit seurantataulukosta.</p>
            </form>
          )}
        </Panel>

        <Panel id="seuranta">
          <SectionTitle>5. Seuranta</SectionTitle>
          <Table>
            <thead>
              <tr>
                <Th><span className="sr-only">Valitse</span></Th>
                <Th>Yhtiö</Th>
                <Th>Tila</Th>
                <Th>Asiakirjat</Th>
                <Th>Allekirjoittajat</Th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const canSend = canManage && sendable.includes(item);
                return (
                  <tr key={item.id}>
                    <Td>
                      {canSend ? <input type="checkbox" form="send-form" name="item_ids" value={item.id} aria-label={`Valitse ${item.company_name}`} className="h-5 w-5" /> : null}
                    </Td>
                    <Td>
                      <span className="font-semibold">{item.company_name}</span>
                      {item.contract_id ? <Link href={`/sopimukset/${item.contract_id}`} className="block text-xs text-sky">Sopimusrekisterissä</Link> : null}
                    </Td>
                    <Td>
                      <Badge tone={ITEM_STATUS_TONE[item.status]}>{ITEM_STATUS_LABEL[item.status]}</Badge>
                      {item.error ? <span className="mt-1 block max-w-56 text-xs text-coral">{item.error}</span> : null}
                    </Td>
                    <Td>
                      {item.document_id ? <a href={`/api/dokumentit/${item.document_id}`} className="block text-sky" target="_blank" rel="noreferrer">Sopimus (PDF)</a> : <span className="text-ink/45">–</span>}
                      {item.sealed_document_id ? <a href={`/api/dokumentit/${item.sealed_document_id}`} className="block font-semibold text-sky" target="_blank" rel="noreferrer">Sinetöity sopimus</a> : null}
                    </Td>
                    <Td>
                      {item.round_signers?.length ? (
                        <ul className="text-ink/70">
                          {item.round_signers.map((s) => (
                            <li key={s.email}>
                              {s.name}, {s.role.toLowerCase()}: {s.status === "signed" && s.signedAt ? `allekirjoitettu ${formatDateTime(s.signedAt)}` : SIGNER_STATUS[s.status ?? "pending"] ?? s.status}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <span className="text-ink/45">Ei lähetetty</span>
                      )}
                      {canWrite && canSimulateSigning() && item.status === "sent" && item.signing_round_id ? (
                        <form action={simulateContractSigningAction} className="mt-2">
                          {hidden}
                          <input type="hidden" name="round_id" value={item.signing_round_id} />
                          <Button variant="secondary" className="min-h-9 px-4 text-xs">Simuloi allekirjoitus (kehitys)</Button>
                        </form>
                      ) : null}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
          <p className="mt-2 text-xs text-ink/55">Luotu {formatDate(batch.created_at)}. Allekirjoitettu {signedCount}/{items.length}.</p>
        </Panel>
      </div>
    </>
  );
}
