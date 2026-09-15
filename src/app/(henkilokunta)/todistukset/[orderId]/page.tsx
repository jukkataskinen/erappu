import { notFound } from "next/navigation";
import { FormError } from "@/components/FormError";
import { PurposeFields } from "@/components/certificates/PurposeFields";
import { Badge, Button, DefinitionList, Notice, PageHeader, Panel, SectionTitle } from "@/components/ui";
import { requireStaff } from "@/lib/auth/current-user";
import { findAttachmentCandidates, parseStoredEntries, type AttachmentEntry } from "@/lib/certificates/attachments";
import { MAX_ATTACHMENT_BYTES } from "@/lib/certificates/assemble";
import { getOrder, loadPrices } from "@/lib/certificates/orders";
import { MAX_MERGED_BYTES } from "@/lib/certificates/pdf-merge";
import { CERTIFICATE_KIND, CERTIFICATE_TEMPLATE_APPROVED, ORDER_STATUS, ORDER_STATUS_TONE } from "@/lib/certificates/pricing";
import { formatBytes } from "@/lib/documents/labels";
import { formatDate, formatDateTime, formatEur } from "@/lib/format";
import { isUsingMockEsinetti } from "@/lib/esinetti";
import { markDeliveredAction, saveOrderOptionsAction, sealCertificateAction, setOrderStatusAction } from "../actions";

export const metadata = { title: "Isännöitsijäntodistus" };
// Liitteineen-todistuksen kokoaminen (lataus, tarkistus, yhdistäminen) voi kestää pidempään kuin oletus.
export const maxDuration = 60;

const STATE_MESSAGE: Record<string, string> = {
  tallennettu: "Valinnat tallennettiin.",
  muodostettu: "Todistus muodostettiin.",
  sinetoity: "Todistus sinetöitiin.",
};

const ENTRY_TONE: Record<AttachmentEntry["status"], "ok" | "alert" | "warn" | "neutral"> = {
  attached: "ok",
  missing: "warn",
  failed: "alert",
  available: "neutral",
};

const ENTRY_LABEL: Record<AttachmentEntry["status"], string> = {
  attached: "Liitetty",
  missing: "Ei saatavilla",
  failed: "Ei voitu liittää",
  available: "Saatavilla",
};

export default async function CertificateOrderPage({ params, searchParams }: { params: Promise<{ orderId: string }>; searchParams: Promise<{ virhe?: string; tila?: string }> }) {
  const ctx = await requireStaff();
  const { orderId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(orderId)) notFound();
  const { virhe, tila } = await searchParams;
  const data = await ctx.run(async (tx) => {
    const order = await getOrder(tx, orderId);
    if (!order) return null;
    const [candidates, prices] = await Promise.all([findAttachmentCandidates(tx, order.company_id, order.share_group_id), loadPrices(tx, ctx.org.organizationId)]);
    return { order, candidates, prices };
  });
  if (!data) notFound();
  const { order, candidates, prices } = data;
  const back = `/todistukset/${orderId}`;
  const canWrite = ctx.can("owner", "manager", "assistant");
  const open = order.status === "new" || order.status === "in_progress";
  const editable = canWrite && open && !order.sealed_at;
  const excluded = new Set(order.excluded_attachments ?? []);
  const missing = candidates.filter((c) => !c.document);
  const selectedSize = candidates.filter((c) => c.document && !excluded.has(c.key)).reduce((s, c) => s + (c.document?.sizeBytes ?? 0), 0);
  const tooBig = candidates.filter((c) => c.document && c.document.sizeBytes > MAX_ATTACHMENT_BYTES);
  const result = parseStoredEntries(order.attachments);
  const problems = result.filter((e) => e.status === "failed" || (order.with_attachments && e.status === "missing"));

  return (
    <>
      <PageHeader
        title={CERTIFICATE_KIND[order.kind] ?? "Todistus"}
        subtitle={`${order.company_name}, huoneisto ${order.unit_label}`}
        back={{ href: `/taloyhtiot/${order.company_id}/todistukset`, label: "Yhtiön todistukset" }}
        actions={
          order.document_id ? (
            <a href={`/api/dokumentit/${order.document_id}`} target="_blank" rel="noopener" className="inline-flex min-h-[var(--size-touch)] items-center rounded-full bg-ink px-5 text-sm font-semibold text-paper">
              Avaa PDF
            </a>
          ) : null
        }
      />
      <FormError message={virhe} />
      {tila && STATE_MESSAGE[tila] ? (
        <div className="mb-5" role="status">
          <Notice tone="ok" title={STATE_MESSAGE[tila]} />
        </div>
      ) : null}
      {!CERTIFICATE_TEMPLATE_APPROVED ? (
        <div className="mb-5">
          <Notice tone="warn" title="Todistuspohja on luonnos">
            PDF:ssä on merkintä &quot;LUONNOS – sisältö tarkistettava&quot;, kunnes pohjan juridinen sisältö on hyväksytty.
          </Notice>
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[1.5fr_1fr]">
        <div className="grid min-w-0 content-start gap-6">
          <Panel>
            <SectionTitle>Todistuksen valinnat</SectionTitle>
            <form action={saveOrderOptionsAction} className="grid gap-5">
              <input type="hidden" name="order_id" value={order.id} />
              <fieldset disabled={!editable} className="grid gap-5">
                <div className="grid gap-2 sm:grid-cols-2">
                  <label className="flex items-start gap-3 rounded-xl border border-line p-3 text-sm">
                    <input type="radio" name="with_attachments" value="no" defaultChecked={!order.with_attachments} className="mt-1" />
                    <span>
                      <span className="block font-semibold">Ilman liitteitä · {formatEur(prices.standard)}</span>
                      <span className="text-ink/60">Liiteluettelo kertoo, mitkä asiakirjat ovat saatavilla isännöitsijältä.</span>
                    </span>
                  </label>
                  <label className="flex items-start gap-3 rounded-xl border border-line p-3 text-sm">
                    <input type="radio" name="with_attachments" value="yes" defaultChecked={order.with_attachments} className="mt-1" />
                    <span>
                      <span className="block font-semibold">Liitteineen · {formatEur(prices.withAttachments)}</span>
                      <span className="text-ink/60">Todistus ja valitut liitteet yhtenä PDF:nä.</span>
                    </span>
                  </label>
                </div>
                <PurposeFields defaultPurpose={order.purpose} defaultText={order.purpose_text} />

                <div>
                  <p className="mb-2 text-sm font-semibold">Liitteet (liitteineen-todistuksessa)</p>
                  <ul className="divide-y divide-line rounded-xl border border-line">
                    {candidates.map((c, i) => (
                      <li key={c.key} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2.5">
                        {c.document ? (
                          <label className="flex min-w-0 items-center gap-3 text-sm">
                            <input type="hidden" name="offered" value={c.key} />
                            <input type="checkbox" name={`include_${c.key}`} defaultChecked={!excluded.has(c.key)} className="size-4" />
                            <span className="min-w-0">
                              <span className="block font-semibold">
                                {i + 1}. {c.label}
                              </span>
                              <span className="block truncate text-xs text-ink/60">
                                {c.document.title} · {c.document.year ?? formatDate(c.document.createdAt.slice(0, 10))} · {formatBytes(c.document.sizeBytes)}
                              </span>
                            </span>
                          </label>
                        ) : (
                          <span className="text-sm">
                            <span className="block font-semibold text-ink/60">
                              {i + 1}. {c.label}
                            </span>
                            <span className="text-xs text-ink/50">Asiakirjaa ei ole tallennettu</span>
                          </span>
                        )}
                        {c.document ? (
                          c.document.sizeBytes > MAX_ATTACHMENT_BYTES ? <Badge tone="alert">Liian suuri</Badge> : <Badge tone="ok">Saatavilla</Badge>
                        ) : (
                          <Badge tone="warn">Ei saatavilla</Badge>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
                {missing.length > 0 ? (
                  <Notice tone="warn" title={`${missing.length} liitettä ei ole saatavilla`}>
                    {missing.map((m) => m.label).join(", ")}. Todistus muodostetaan silti, ja liiteluetteloon merkitään &quot;Ei saatavilla&quot;. Lisää puuttuva asiakirja yhtiön dokumentteihin, jos se halutaan mukaan.
                  </Notice>
                ) : null}
                {tooBig.length > 0 ? (
                  <Notice tone="alert" title="Liian suuri liite">
                    {tooBig.map((m) => m.label).join(", ")} ylittää 20 Mt:n rajan, eikä sitä voida liittää.
                  </Notice>
                ) : null}
                {selectedSize > MAX_MERGED_BYTES * 0.9 ? (
                  <Notice tone="alert" title="Liitteet ovat yhteensä hyvin suuria">
                    Valitut liitteet ovat yhteensä {formatBytes(selectedSize)}. Sinetöitävä todistus voi olla enintään 25 Mt; poista suurin liite valinnoista.
                  </Notice>
                ) : null}
              </fieldset>
              {editable ? (
                <div className="flex flex-wrap gap-3">
                  <Button name="intent" value="generate">
                    {order.document_id ? "Muodosta uudelleen" : "Muodosta todistus"}
                  </Button>
                  <Button variant="secondary" name="intent" value="save">
                    Tallenna valinnat
                  </Button>
                </div>
              ) : order.sealed_at ? (
                <p className="text-sm text-ink/60">Todistus on sinetöity, eikä valintoja voi enää muuttaa.</p>
              ) : null}
            </form>
          </Panel>

          {result.length > 0 ? (
            <Panel>
              <SectionTitle>Muodostetun todistuksen liiteluettelo</SectionTitle>
              {problems.length > 0 ? (
                <div className="mb-3">
                  <Notice tone="alert" title="Kaikkia liitteitä ei saatu mukaan">
                    {problems.map((p) => `${p.label}: ${p.status === "failed" ? `ei voitu liittää${p.reason ? ` (${p.reason})` : ""}` : "ei saatavilla"}`).join("; ")}.
                  </Notice>
                </div>
              ) : null}
              <ul className="divide-y divide-line">
                {result.map((e) => (
                  <li key={e.key} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <span>
                      <span className="font-semibold">
                        Liite {e.number}: {e.label}
                      </span>
                      <span className="block text-xs text-ink/60">{[e.title, e.dateText, e.pages ? `${e.pages} s.` : null].filter(Boolean).join(" · ")}</span>
                    </span>
                    <Badge tone={ENTRY_TONE[e.status]}>{ENTRY_LABEL[e.status]}</Badge>
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}
        </div>

        <div className="grid content-start gap-6">
          {order.document_id ? (
            <Panel>
              <SectionTitle>Sähköinen sinetti</SectionTitle>
              {order.sealed_at ? (
                <Notice tone="ok" title={`Sinetöity ${formatDateTime(order.sealed_at)}`}>
                  Todistus on varmennettu eSinetin sähköisellä sinetillä. Aitouden voi tarkistaa lataamalla PDF:n osoitteessa app.esinetti.fi/verify.
                </Notice>
              ) : (
                <>
                  <p className="mb-3 text-sm text-ink/65">
                    Sinetöinti varmentaa valmiin todistuksen. Sinetöity PDF korvaa nykyisen version, eikä todistusta voi sen jälkeen muodostaa uudelleen.
                  </p>
                  {isUsingMockEsinetti() ? (
                    <div className="mb-3">
                      <Notice tone="warn" title="eSinetti on jäljitelmätilassa">
                        Sinetöinti tehdään kehityksen jäljitelmällä, eikä sinetillä ole todistusvoimaa.
                      </Notice>
                    </div>
                  ) : null}
                  {ctx.can("owner", "manager") && order.status !== "cancelled" ? (
                    <form action={sealCertificateAction}>
                      <input type="hidden" name="order_id" value={order.id} />
                      <Button>{isUsingMockEsinetti() ? "Sinetöi (jäljitelmä)" : "Sinetöi eSinetillä"}</Button>
                    </form>
                  ) : (
                    <p className="text-sm text-ink/60">Todistuksen sinetöi pääkäyttäjä tai isännöitsijä.</p>
                  )}
                </>
              )}
            </Panel>
          ) : null}
          <Panel>
            <SectionTitle>Tilaus</SectionTitle>
            <DefinitionList
              items={[
                { label: "Tila", value: <Badge tone={ORDER_STATUS_TONE[order.status]}>{ORDER_STATUS[order.status]}</Badge> },
                { label: "Tilattu", value: formatDateTime(order.created_at) },
                { label: "Tilaaja", value: order.orderer_name },
                { label: "Yhteystiedot", value: [order.orderer_email, order.orderer_phone].filter(Boolean).join(" · ") },
                { label: "Lähde", value: order.source === "public_form" ? "Verkkolomake" : "Henkilökunta" },
                { label: "Toimitus", value: order.express ? "Pikatoimitus" : "Normaali" },
                { label: "Hinta", value: formatEur(order.price_eur) },
                { label: "Sinetöity", value: order.sealed_at ? formatDateTime(order.sealed_at) : "Ei" },
              ]}
            />
            {canWrite ? (
              <div className="mt-4 flex flex-wrap gap-3">
                {open && order.document_id ? (
                  <form action={markDeliveredAction}>
                    <input type="hidden" name="order_id" value={order.id} />
                    <input type="hidden" name="back" value={back} />
                    <Button variant="secondary">Merkitse toimitetuksi</Button>
                  </form>
                ) : null}
                {open ? (
                  <form action={setOrderStatusAction}>
                    <input type="hidden" name="order_id" value={order.id} />
                    <input type="hidden" name="back" value={back} />
                    <input type="hidden" name="status" value="cancelled" />
                    <Button variant="ghost">Peru tilaus</Button>
                  </form>
                ) : null}
              </div>
            ) : null}
          </Panel>
        </div>
      </div>
    </>
  );
}
