import Link from "next/link";
import type { ReactNode } from "react";
import { FormError } from "@/components/FormError";
import { Badge, Button, EmptyState, Field, Input, Notice, Panel, SectionTitle, Select, Table, Td, Th } from "@/components/ui";
import type { StaffContext } from "@/lib/auth/current-user";
import { activeOrderLinks, readOrderLinkFlash } from "@/lib/certificates/order-link";
import { listOrders } from "@/lib/certificates/orders";
import { CERTIFICATE_KIND, CERTIFICATE_TEMPLATE_APPROVED, ORDER_STATUS, ORDER_STATUS_TONE } from "@/lib/certificates/pricing";
import { formatDate, formatDateTime, formatEur } from "@/lib/format";
import { listCompanies } from "@/lib/registry/queries";
import { createStaffCertificateAction, generateCertificateAction, markDeliveredAction, setOrderStatusAction } from "./actions";
import { OrderLinkControls } from "./OrderLinkPanel";
import { latestKeyDocuments } from "@/lib/documents/key-documents";
import { KeyDocumentLinks } from "@/components/KeyDocuments";

/**
 * Isännöitsijäntodistukset koko organisaatiolle tai yhdelle yhtiölle
 * (`fixedCompanyId`). `basePath` kulkee lomakkeissa paluuosoitteena, jotta
 * käsittely jatkuu samassa näkymässä.
 */
export async function CertificatesView({
  ctx,
  virhe,
  fixedCompanyId,
  basePath,
  header,
}: {
  ctx: StaffContext;
  virhe?: string;
  fixedCompanyId?: string;
  basePath: string;
  header: ReactNode;
}) {
  const orgId = ctx.org.organizationId;
  const [orders, allCompanies, groups] = await ctx.run((tx) =>
    Promise.all([
      listOrders(tx, orgId, { limit: 300, companyId: fixedCompanyId }),
      listCompanies(tx, orgId),
      tx.query<{ id: string; unit_label: string; company_id: string; company_name: string }>(
        `select g.id, g.unit_label, g.company_id, c.name as company_name
           from er_share_groups g join er_housing_companies c on c.id = g.company_id
          where c.organization_id = $1 and g.removed_on is null and c.management_ended_on is null
            and ($2::uuid is null or c.id = $2::uuid)
          order by c.name, length(g.unit_label), g.unit_label`,
        [orgId, fixedCompanyId ?? null],
      ),
    ]),
  );
  const companies = fixedCompanyId ? allCompanies.filter((c) => c.id === fixedCompanyId) : allCompanies;
  const [links, keyDocs] = await ctx.run((tx) =>
    Promise.all([activeOrderLinks(tx, companies.map((c) => c.id)), latestKeyDocuments(tx, companies.map((c) => c.id))]),
  );
  const flash = await readOrderLinkFlash();
  const canWrite = ctx.can("owner", "manager", "assistant");
  const open = orders.filter((o) => o.status === "new" || o.status === "in_progress");
  const closed = orders.filter((o) => !open.includes(o));
  const byCompany = new Map<string, { name: string; groups: { id: string; unit_label: string }[] }>();
  for (const g of groups) {
    const entry = byCompany.get(g.company_id) ?? { name: g.company_name, groups: [] };
    entry.groups.push(g);
    byCompany.set(g.company_id, entry);
  }

  const table = (rows: typeof orders, actions: boolean) => (
    <Table>
      <thead>
        <tr>
          <Th>Tilattu</Th>
          <Th>Huoneisto</Th>
          <Th>Tilaaja</Th>
          <Th>Hinta</Th>
          <Th>Tila</Th>
          <Th />
        </tr>
      </thead>
      <tbody>
        {rows.map((o) => (
          <tr key={o.id}>
            <Td className="whitespace-nowrap">
              {formatDateTime(o.created_at)}
              {o.express ? (
                <span className="ml-2">
                  <Badge tone="alert">Pika</Badge>
                </span>
              ) : null}
            </Td>
            <Td>
              <Link href={`/taloyhtiot/${o.company_id}/kokoukset`} className="font-semibold hover:text-sky">
                {o.company_name}
              </Link>
              <div className="text-ink/65">
                {o.unit_label} · {CERTIFICATE_KIND[o.kind]}
              </div>
              <div className="mt-1.5">
                <span className="mr-2 text-xs text-ink/55">Liitteet:</span>
                <KeyDocumentLinks companyId={o.company_id} docs={keyDocs.get(o.company_id) ?? {}} compact />
              </div>
            </Td>
            <Td>
              {o.orderer_name}
              <div className="text-xs text-ink/55">{[o.orderer_email, o.orderer_phone].filter(Boolean).join(" · ")}</div>
              <div className="text-xs text-ink/55">{o.source === "public_form" ? "Verkkolomake" : "Henkilökunta"}</div>
            </Td>
            <Td>{formatEur(o.price_eur)}</Td>
            <Td>
              <Badge tone={ORDER_STATUS_TONE[o.status]}>{ORDER_STATUS[o.status]}</Badge>
              {o.delivered_at ? <div className="mt-1 text-xs text-ink/55">{formatDate(o.delivered_at)}</div> : null}
            </Td>
            <Td>
              <div className="flex flex-col items-start gap-1.5">
                {o.document_id ? (
                  <a href={`/api/dokumentit/${o.document_id}`} className="text-sm font-semibold text-sky">
                    Avaa PDF
                  </a>
                ) : null}
                {canWrite && actions ? (
                  <>
                    <form action={generateCertificateAction}>
                      <input type="hidden" name="order_id" value={o.id} />
                      <input type="hidden" name="back" value={basePath} />
                      <button className="text-sm text-sky">{o.document_id ? "Tee uudelleen" : "Tee todistus"}</button>
                    </form>
                    {o.document_id ? (
                      <form action={markDeliveredAction}>
                        <input type="hidden" name="order_id" value={o.id} />
                      <input type="hidden" name="back" value={basePath} />
                        <button className="text-sm text-moss">Merkitse toimitetuksi</button>
                      </form>
                    ) : null}
                    <form action={setOrderStatusAction}>
                      <input type="hidden" name="order_id" value={o.id} />
                      <input type="hidden" name="back" value={basePath} />
                      <input type="hidden" name="status" value="cancelled" />
                      <button className="text-xs text-coral">Peru</button>
                    </form>
                  </>
                ) : null}
                {canWrite && o.status === "delivered" ? (
                  <form action={setOrderStatusAction}>
                    <input type="hidden" name="order_id" value={o.id} />
                      <input type="hidden" name="back" value={basePath} />
                    <input type="hidden" name="status" value="invoiced" />
                    <button className="text-xs text-ink/60 hover:text-ink">Merkitse laskutetuksi</button>
                  </form>
                ) : null}
              </div>
            </Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );

  return (
    <>
      {header}
      <FormError message={virhe} />
      {!CERTIFICATE_TEMPLATE_APPROVED ? (
        <div className="mb-6">
          <Notice tone="warn" title="Todistuspohja on luonnos">
            PDF:ssä on merkintä &quot;LUONNOS – sisältö tarkistettava&quot;, kunnes pohjan juridinen sisältö on hyväksytty. Todistus toimitetaan tilaajalle erikseen: sähköposti kertoo vain, että todistus on valmis.
          </Notice>
        </div>
      ) : null}
      <div className="grid gap-6 xl:grid-cols-[1.7fr_1fr]">
        <div className="grid content-start gap-6">
          <section>
            <SectionTitle>Avoimet tilaukset</SectionTitle>
            {open.length === 0 ? <EmptyState title="Ei avoimia tilauksia" /> : table(open, true)}
          </section>
          {closed.length > 0 ? (
            <section>
              <SectionTitle>Toimitetut ja perutut</SectionTitle>
              {table(closed, false)}
            </section>
          ) : null}
        </div>

        <div className="grid content-start gap-6">
          {canWrite ? (
            <Panel>
              <SectionTitle>Uusi todistus</SectionTitle>
              <form action={createStaffCertificateAction} className="grid gap-4">
                <input type="hidden" name="back" value={basePath} />
                <Field label="Huoneisto" htmlFor="share_group_id">
                  <Select id="share_group_id" name="share_group_id" required defaultValue="">
                    <option value="" disabled>
                      Valitse huoneisto
                    </option>
                    {[...byCompany.entries()].map(([cid, c]) => (
                      <optgroup key={cid} label={c.name}>
                        {c.groups.map((g) => (
                          <option key={g.id} value={g.id}>
                            {g.unit_label}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </Select>
                </Field>
                <Field label="Todistus" htmlFor="kind">
                  <Select id="kind" name="kind" defaultValue="manager_certificate">
                    {Object.entries(CERTIFICATE_KIND).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Tilaaja" htmlFor="orderer_name" hint="Tyhjä = sinä">
                  <Input id="orderer_name" name="orderer_name" />
                </Field>
                <Field label="Tilaajan sähköposti" htmlFor="orderer_email">
                  <Input id="orderer_email" name="orderer_email" type="email" />
                </Field>
                <Field label="Puhelin" htmlFor="orderer_phone">
                  <Input id="orderer_phone" name="orderer_phone" />
                </Field>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="express" /> Pikatoimitus
                </label>
                <div>
                  <Button>Tee todistus</Button>
                </div>
              </form>
            </Panel>
          ) : null}

          <Panel>
            <SectionTitle>{fixedCompanyId ? "Tilauslinkki" : "Tilauslinkit"}</SectionTitle>
            <p className="mb-4 text-sm text-ink/65">Välittäjä tai osakas tilaa todistuksen yhtiökohtaisella linkillä ilman kirjautumista. Tilaus tulee tälle sivulle.</p>
            <ul className="grid gap-4">
              {companies.map((c) => (
                <li key={c.id} className="border-t border-line pt-3 first:border-t-0 first:pt-0">
                  {fixedCompanyId ? null : <p className="mb-1 font-semibold">{c.name}</p>}
                  <OrderLinkControls
                    companyId={c.id}
                    back={basePath}
                    active={links.has(c.id) ? { expiresAt: links.get(c.id) ?? null } : null}
                    flashUrl={flash?.companyId === c.id ? flash.url : null}
                    canWrite={canWrite}
                  />
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </div>
    </>
  );
}
