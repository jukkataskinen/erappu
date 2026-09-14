import { notFound } from "next/navigation";
import { CompanyHeader, loadCompany } from "@/components/CompanyHeader";
import { FormError } from "@/components/FormError";
import { Badge, Button, DefinitionList, Field, Input, Notice, Panel, SectionTitle, Select, Textarea } from "@/components/ui";
import { requireStaff } from "@/lib/auth/current-user";
import { formatDate, formatDateTime } from "@/lib/format";
import { getNotice } from "@/lib/maintenance/queries";
import { nextStatuses, RENOVATION_STATUS_LABEL, RENOVATION_STATUS_TONE } from "@/lib/maintenance/renovation";
import { processRenovationNotice } from "../../actions";

export const metadata = { title: "Muutostyöilmoitus" };

export default async function NoticePage({ params, searchParams }: { params: Promise<{ id: string; nid: string }>; searchParams: Promise<{ virhe?: string; tila?: string }> }) {
  const ctx = await requireStaff();
  const { id, nid } = await params;
  const { virhe, tila } = await searchParams;
  const company = await loadCompany(ctx, id);
  if (!/^[0-9a-f-]{36}$/i.test(nid)) notFound();
  const notice = await ctx.run((tx) => getNotice(tx, nid));
  if (!notice || notice.company_id !== id) notFound();
  const canProcess = ctx.can("owner", "manager", "assistant");
  const options = [notice.status, ...nextStatuses(notice.status)];

  return (
    <>
      <CompanyHeader company={company} active="korjaukset" />
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
              { label: "Työlaji", value: notice.work_type ?? "–" },
              { label: "Suunniteltu aika", value: notice.planned_start ? `${formatDate(notice.planned_start)} – ${formatDate(notice.planned_end)}` : "–" },
              { label: "Päätös", value: formatDate(notice.decided_on) },
              { label: "Valmistui", value: formatDate(notice.completed_on) },
              { label: "Valvoja", value: notice.supervisor ?? "–" },
              { label: "Korjaushistoriassa", value: notice.maintenance_work_id ? "Kyllä" : "Ei" },
            ]}
          />
          <h3 className="mt-5 text-sm font-semibold">Kuvaus</h3>
          <p className="mt-1 whitespace-pre-wrap text-sm">{notice.description}</p>
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
              Yhtiö voi asettaa muutostyölle ehtoja ja valvoa työtä osakkaan kustannuksella (asunto-osakeyhtiölain 5 luku). Valmistunut työ kirjataan korjaushistoriaan osakkaan tekemänä.
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
              <Field label="Valvoja" htmlFor="supervisor">
                <Input id="supervisor" name="supervisor" maxLength={200} defaultValue={notice.supervisor ?? ""} />
              </Field>
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
