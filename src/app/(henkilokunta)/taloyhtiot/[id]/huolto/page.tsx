import Link from "next/link";
import { CompanyHeader, loadCompany } from "@/components/CompanyHeader";
import { FormError } from "@/components/FormError";
import { Badge, Button, EmptyState, Field, Input, LinkButton, Notice, Panel, SectionTitle, Table, Td, Th } from "@/components/ui";
import { getCompanyMarketplace } from "@/lib/marketplace/queries";
import { requireStaff } from "@/lib/auth/current-user";
import { formatDate } from "@/lib/format";
import { QrCode } from "@/lib/service-requests/components/QrCode";
import { StatusBadge, UrgencyBadge } from "@/lib/service-requests/components/parts";
import { CATEGORY_LABEL } from "@/lib/service-requests/labels";
import { getPublicFormToken, publicFormUrl } from "@/lib/service-requests/links";
import { listCompanyServices, listRequests } from "@/lib/service-requests/queries";
import { isOpen } from "@/lib/service-requests/status";
import { rotatePublicForm, saveMarketplaceSettings } from "./actions";

export const metadata = { title: "Huolto" };

export default async function CompanyMaintenancePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ virhe?: string; kaikki?: string; tori?: string }> }) {
  const ctx = await requireStaff();
  const { id } = await params;
  const { virhe, kaikki, tori } = await searchParams;
  const company = await loadCompany(ctx, id);
  const [requests, services, form, marketplace] = await ctx.run((tx) =>
    Promise.all([
      listRequests(tx, company.organization_id, { companyId: id, openOnly: kaikki !== "1", limit: 200 }),
      listCompanyServices(tx, { companyId: id }),
      getPublicFormToken(tx, id),
      getCompanyMarketplace(tx, id),
    ]),
  );
  const canWrite = ctx.can("owner", "manager", "assistant");
  const url = form ? publicFormUrl(form.token) : null;
  const openCount = requests.filter((r) => isOpen(r.status)).length;

  return (
    <>
      <CompanyHeader
        company={company}
        active="huolto"
        actions={canWrite ? <LinkButton href={`/huoltopyynnot/uusi?yhtio=${id}`}>Uusi huoltopyyntö</LinkButton> : null}
      />
      <FormError message={virhe} />
      <div className="grid gap-6 xl:grid-cols-[1.6fr_1fr]">
        <div className="grid content-start gap-4">
          <SectionTitle
            actions={
              <Link href={kaikki === "1" ? `/taloyhtiot/${id}/huolto` : `/taloyhtiot/${id}/huolto?kaikki=1`} className="text-sm text-sky">
                {kaikki === "1" ? "Vain avoimet" : "Näytä myös valmiit"}
              </Link>
            }
          >
            {kaikki === "1" ? "Huoltopyynnöt" : `Avoimet huoltopyynnöt (${openCount})`}
          </SectionTitle>
          {requests.length === 0 ? (
            <EmptyState title="Ei huoltopyyntöjä">Osakkaat ja asukkaat voivat tehdä pyynnön portaalissa tai yhtiön QR-lomakkeella.</EmptyState>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Nro</Th>
                  <Th>Pyyntö</Th>
                  <Th>Tila</Th>
                  <Th>Vastuu</Th>
                  <Th>Saapui</Th>
                </tr>
              </thead>
              <tbody>
                {requests.map((r) => (
                  <tr key={r.id} className="hover:bg-cloud/50">
                    <Td className="tabular text-ink/60">#{r.number}</Td>
                    <Td>
                      <Link href={`/huoltopyynnot/${r.id}`} className="font-semibold hover:text-sky">
                        {r.title}
                      </Link>
                      <p className="text-xs text-ink/55">
                        {CATEGORY_LABEL[r.category]}
                        {r.unit_label ? ` · ${r.unit_label}` : ""}
                      </p>
                    </Td>
                    <Td>
                      <div className="flex flex-wrap gap-1">
                        <StatusBadge status={r.status} />
                        <UrgencyBadge urgency={r.urgency} />
                        {r.overdue ? <Badge tone="alert">Myöhässä</Badge> : null}
                      </div>
                    </Td>
                    <Td>
                      {r.assignee_name ?? "–"}
                      {r.provider_name ? <span className="block text-xs text-ink/55">{r.provider_name}</span> : null}
                    </Td>
                    <Td className="whitespace-nowrap text-ink/65">{formatDate(r.created_at)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </div>

        <div className="grid content-start gap-6">
          <Panel>
            <SectionTitle>Julkinen huoltopyyntölomake</SectionTitle>
            <p className="mb-4 text-sm text-ink/70">
              Tulosta QR-koodi porraskäytävän ilmoitustaululle. Lomakkeella voi ilmoittaa vian ilman kirjautumista. Lähetyksiä rajoitetaan viiteen tunnissa samasta osoitteesta.
            </p>
            {url ? (
              <div className="grid gap-3">
                <QrCode value={url} label={`QR-koodi: huoltopyyntölomake, ${company.name}`} />
                <p className="break-all rounded-lg bg-cloud px-3 py-2 font-mono text-xs">{url}</p>
                <p className="text-xs text-ink/55">Luotu {formatDate(form!.createdAt)}.</p>
              </div>
            ) : (
              <p className="mb-3 text-sm text-ink/65">Lomakelinkkiä ei ole vielä luotu.</p>
            )}
            {canWrite ? (
              <form action={rotatePublicForm} className="mt-4">
                <input type="hidden" name="company_id" value={id} />
                <Button variant={url ? "secondary" : "primary"} type="submit">
                  {url ? "Vaihda linkki (vanha lakkaa toimimasta)" : "Luo lomakelinkki"}
                </Button>
              </form>
            ) : null}
          </Panel>

          <Panel id="tori">
            <SectionTitle actions={marketplace?.marketplace_enabled ? <Badge tone="ok">Käytössä</Badge> : <Badge tone="neutral">Ei käytössä</Badge>}>Tori</SectionTitle>
            {tori === "tallennettu" ? (
              <div className="mb-3">
                <Notice tone="ok" title="Torin tiedot tallennettiin." />
              </div>
            ) : null}
            <p className="mb-4 text-sm text-ink/70">
              Torilta hyväksytyt palveluntuottajat voivat varata yhtiön huoltotöitä omalla tuntihinnallaan. Käyttö edellyttää hallituksen päätöstä ja eurorajaa: rajan
              ylittävän arvion isännöitsijä hyväksyy erikseen.
            </p>
            {ctx.can("owner", "manager") ? (
              <form action={saveMarketplaceSettings} className="grid gap-3">
                <input type="hidden" name="company_id" value={id} />
                <label className="flex items-center gap-2 text-sm font-semibold">
                  <input type="checkbox" name="enabled" value="1" defaultChecked={marketplace?.marketplace_enabled ?? false} className="h-5 w-5" /> Hallitus on hyväksynyt torin käytön
                </label>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Euroraja (€, sis. alv)" htmlFor="limit_eur" hint="Esim. 500">
                    <Input id="limit_eur" name="limit_eur" inputMode="decimal" defaultValue={marketplace?.marketplace_limit_eur ?? ""} />
                  </Field>
                  <Field label="Hallituksen päätöspäivä" htmlFor="decided_on">
                    <Input id="decided_on" name="decided_on" type="date" defaultValue={marketplace?.marketplace_decided_on ?? ""} />
                  </Field>
                </div>
                <Field label="Päätös ja pöytäkirja" htmlFor="decision_note" hint="Esim. hallituksen kokous 3/2026, 5 §">
                  <Input id="decision_note" name="decision_note" maxLength={500} defaultValue={marketplace?.marketplace_decision_note ?? ""} />
                </Field>
                <div>
                  <Button type="submit" variant="secondary">
                    Tallenna
                  </Button>
                </div>
              </form>
            ) : (
              <p className="text-sm text-ink/65">
                {marketplace?.marketplace_enabled
                  ? `Raja ${marketplace.marketplace_limit_eur} €, päätös ${formatDate(marketplace.marketplace_decided_on)}.`
                  : "Tori ei ole käytössä."}
              </p>
            )}
          </Panel>

          <Panel>
            <SectionTitle actions={<Link href="/palveluntuottajat" className="text-sm text-sky">Palveluntuottajat</Link>}>Palvelut</SectionTitle>
            {services.length === 0 ? (
              <p className="text-sm text-ink/65">Yhtiöön ei ole liitetty palveluntuottajia.</p>
            ) : (
              <ul className="divide-y divide-line">
                {services.map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-3 py-2">
                    <span>
                      <Link href={`/palveluntuottajat/${s.provider_id}`} className="font-semibold hover:text-sky">
                        {s.provider_name}
                      </Link>
                      <span className="block text-xs text-ink/55">{s.service}</span>
                    </span>
                    {s.default_for_requests ? <Badge tone="ok">Oletus</Badge> : null}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}
