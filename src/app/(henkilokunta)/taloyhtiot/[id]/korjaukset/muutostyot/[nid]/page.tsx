import { notFound } from "next/navigation";
import { CompanyHeader, loadCompany } from "@/components/CompanyHeader";
import { FormError } from "@/components/FormError";
import { Badge, Button, DefinitionList, Field, Input, Notice, Panel, SectionTitle, Select, Table, Td, Textarea, Th } from "@/components/ui";
import { requireStaff } from "@/lib/auth/current-user";
import { formatBytes } from "@/lib/documents/labels";
import { formatDate, formatDateTime, formatEur } from "@/lib/format";
import { CONTRACTOR_KIND_LABEL, type ContractorKind } from "@/lib/maintenance/notice-form";
import { getNotice, listNoticeAttachments, listNoticeWorks } from "@/lib/maintenance/queries";
import { nextStatuses, RENOVATION_STATUS_LABEL, RENOVATION_STATUS_TONE } from "@/lib/maintenance/renovation";
import { processRenovationNotice } from "../../actions";

export const metadata = { title: "Muutostyöilmoitus" };

export default async function NoticePage({ params, searchParams }: { params: Promise<{ id: string; nid: string }>; searchParams: Promise<{ virhe?: string; tila?: string }> }) {
  const ctx = await requireStaff();
  const { id, nid } = await params;
  const { virhe, tila } = await searchParams;
  const company = await loadCompany(ctx, id);
  if (!/^[0-9a-f-]{36}$/i.test(nid)) notFound();
  const [notice, works, attachments] = await ctx.run(async (tx) => [
    await getNotice(tx, nid),
    await listNoticeWorks(tx, nid),
    await listNoticeAttachments(tx, nid),
  ] as const);
  if (!notice || notice.company_id !== id) notFound();
  const canProcess = ctx.can("owner", "manager", "assistant");
  const options = [notice.status, ...nextStatuses(notice.status)];

  return (
    <>
      <CompanyHeader company={company} active="korjaukset" sub="Muutostyöilmoitus" />
      <FormError message={virhe} />
      {tila === "tallennettu" ? (
        <div className="mb-5" role="status">
          <Notice tone="ok" title="Käsittely tallennettiin. Ilmoittaja saa viestin tilamuutoksesta, jos hänen sähköpostiosoitteensa on rekisterissä." />
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
        <Panel>
          <SectionTitle actions={<Badge tone={RENOVATION_STATUS_TONE[notice.status]}>{RENOVATION_STATUS_LABEL[notice.status]}</Badge>}>
            Muutostyöilmoitus, huoneisto {notice.unit_label}
          </SectionTitle>
          <DefinitionList
            items={[
              { label: "Ilmoittaja", value: notice.submitted_by_name ?? "–" },
              { label: "Saapui", value: formatDateTime(notice.created_at) },
              { label: "Työlajit", value: notice.work_types ?? notice.work_type ?? "–" },
              {
                label: "Suunniteltu aika",
                value: notice.works_start ?? notice.planned_start
                  ? `${formatDate(notice.works_start ?? notice.planned_start)} – ${formatDate(notice.works_end ?? notice.planned_end)}`
                  : "–",
              },
              { label: "Päätös", value: formatDate(notice.decided_on) },
              { label: "Valmistui", value: formatDate(notice.completed_on) },
              { label: "Valvoja", value: notice.supervisor ?? "–" },
              {
                label: "Valvonnan kustannusarvio",
                value:
                  notice.supervision_cost_eur != null
                    ? `${formatEur(notice.supervision_cost_eur)}${notice.supervision_cost_basis ? ` (${notice.supervision_cost_basis})` : ""}`
                    : (notice.supervision_cost_basis ?? "–"),
              },
              { label: "Korjaushistoriassa", value: notice.maintenance_work_id ? "Kyllä" : "Ei" },
              {
                label: "Muutostyöohje kuitattu",
                value: notice.guide_acknowledged_at ? (
                  <>
                    {formatDateTime(notice.guide_acknowledged_at)}
                    {notice.guide_document_id ? (
                      <>
                        {" · "}
                        <a href={`/api/dokumentit/${notice.guide_document_id}`} className="text-sky underline">
                          ohje
                        </a>
                      </>
                    ) : (
                      " · yhtiöllä ei ollut tallennettua ohjetta"
                    )}
                  </>
                ) : (
                  <Badge tone="warn">Ei kuittausta</Badge>
                ),
              },
              {
                label: "Ilmoitustapa",
                value: [notice.notify_email ? "sähköposti" : null, notice.notify_sms ? "tekstiviesti (ei vielä käytössä)" : null].filter(Boolean).join(", ") || "ei ilmoituksia",
              },
            ]}
          />
          <h3 className="mt-5 text-sm font-semibold">Yhteenveto</h3>
          <p className="mt-1 whitespace-pre-wrap text-sm">{notice.description}</p>

          <h3 className="mt-5 text-sm font-semibold">Muutostyöt ({works.length})</h3>
          {works.length === 0 ? (
            <p className="mt-1 text-sm text-ink/65">Ilmoituksella ei ole työrivejä.</p>
          ) : (
            <ul className="mt-2 divide-y divide-line">
              {works.map((w) => (
                <li key={w.id} className="py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-semibold">{w.work_type}</p>
                    <p className="text-xs text-ink/60">
                      {w.planned_start ? `${formatDate(w.planned_start)} – ${formatDate(w.planned_end)}` : "aikataulu avoin"}
                    </p>
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-sm">{w.description}</p>
                  <p className="mt-1 text-xs text-ink/65">
                    Tekijä: {CONTRACTOR_KIND_LABEL[w.contractor_kind as ContractorKind] ?? w.contractor_kind}
                    {w.contractor_name ? ` · ${w.contractor_name}` : ""}
                    {w.contractor_business_id ? ` (${w.contractor_business_id})` : ""}
                    {w.contractor_contact ? ` · ${w.contractor_contact}` : ""}
                  </p>
                  {w.contractor_qualification ? <p className="text-xs text-ink/65">Pätevyys: {w.contractor_qualification}</p> : null}
                  {w.maintenance_work_id ? <p className="text-xs text-moss">Kirjattu korjaushistoriaan.</p> : null}
                </li>
              ))}
            </ul>
          )}

          <h3 className="mt-5 text-sm font-semibold">Liitteet ({attachments.length})</h3>
          {attachments.length === 0 ? (
            <p className="mt-1 text-sm text-ink/65">Osakas ei liittänyt tiedostoja.</p>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Tiedosto</Th>
                  <Th>Lisätty</Th>
                  <Th numeric>Koko</Th>
                </tr>
              </thead>
              <tbody>
                {attachments.map((a) => (
                  <tr key={a.id}>
                    <Td>
                      <a href={`/api/dokumentit/${a.id}`} target="_blank" rel="noreferrer" className="font-semibold hover:text-sky">
                        {a.file_name}
                      </a>
                    </Td>
                    <Td>{formatDate(a.created_at)}</Td>
                    <Td numeric>{formatBytes(a.size_bytes)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
          {notice.conditions ? (
            <>
              <h3 className="mt-5 text-sm font-semibold">Ehdot</h3>
              <p className="mt-1 whitespace-pre-wrap text-sm">{notice.conditions}</p>
            </>
          ) : null}
        </Panel>

        {canProcess && options.length > 1 ? (
          <Panel>
            <SectionTitle>Käsittely</SectionTitle>
            <p className="mb-4 text-sm text-ink/65">
              Yhtiö voi asettaa muutostyölle ehtoja ja valvoa työtä osakkaan kustannuksella (asunto-osakeyhtiölain 5 luku). Valvoja ja kustannusarvio näkyvät osakkaalle portaalissa ja tilamuutosviestissä. Valmistunut työ kirjataan korjaushistoriaan osakkaan tekemänä.
            </p>
            <form action={processRenovationNotice} className="grid gap-4">
              <input type="hidden" name="company_id" value={id} />
              <input type="hidden" name="id" value={notice.id} />
              <Field label="Tila" htmlFor="status">
                <Select id="status" name="status" defaultValue={notice.status}>
                  {options.map((s) => (
                    <option key={s} value={s}>
                      {RENOVATION_STATUS_LABEL[s]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Ehdot" htmlFor="conditions" hint="Pakollinen, kun hyväksytään ehdoin">
                <Textarea id="conditions" name="conditions" maxLength={4000} defaultValue={notice.conditions ?? ""} />
              </Field>
              <Field label="Valvoja" htmlFor="supervisor" hint="Esimerkiksi palveluntuottaja tai valvojan nimi ja yhteystieto">
                <Input id="supervisor" name="supervisor" maxLength={200} defaultValue={notice.supervisor ?? ""} />
              </Field>
              <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
                <Field label="Valvonnan arvio, €" htmlFor="supervision_cost_eur">
                  <Input id="supervision_cost_eur" name="supervision_cost_eur" inputMode="decimal" defaultValue={notice.supervision_cost_eur != null ? String(notice.supervision_cost_eur).replace(".", ",") : ""} />
                </Field>
                <Field label="Arvion peruste" htmlFor="supervision_cost_basis" hint="Näkyy osakkaalle, esim. 2 käyntiä à 120 € + alv">
                  <Input id="supervision_cost_basis" name="supervision_cost_basis" maxLength={500} defaultValue={notice.supervision_cost_basis ?? ""} />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Päätöspäivä" htmlFor="decided_on" hint="Tyhjä = tänään">
                  <Input id="decided_on" name="decided_on" type="date" defaultValue={notice.decided_on ?? ""} />
                </Field>
                <Field label="Valmistumispäivä" htmlFor="completed_on">
                  <Input id="completed_on" name="completed_on" type="date" defaultValue={notice.completed_on ?? ""} />
                </Field>
              </div>
              <div>
                <Button>Tallenna</Button>
              </div>
            </form>
          </Panel>
        ) : null}
      </div>
    </>
  );
}
