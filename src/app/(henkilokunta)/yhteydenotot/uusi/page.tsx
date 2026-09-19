import Link from "next/link";
import { FormError } from "@/components/FormError";
import { Button, Field, Input, Notice, PageHeader, Panel, Select, Textarea } from "@/components/ui";
import { requireStaff } from "@/lib/auth/current-user";
import { CONTACT_TOPIC_LABEL, CONTACT_TOPICS, MAX_CONTACT_ATTACHMENTS, MAX_CONTACT_BODY } from "@/lib/contacts/labels";
import { listContactRecipients } from "@/lib/contacts/queries";
import { ATTACHMENT_ACCEPT } from "@/lib/maintenance/attachments";
import { PhotoForm } from "@/lib/service-requests/components/PhotoForm";
import { listCompanyOptions } from "@/lib/service-requests/queries";
import { staffStartThread } from "../actions";

export const metadata = { title: "Uusi viesti" };

const ROLE_LABEL = { owner: "osakas", resident: "asukas", board: "hallitus" } as const;

/** Henkilökunnan aloittama viesti portaalikäyttäjälle (0104). */
export default async function StaffNewContactPage({ searchParams }: { searchParams: Promise<{ yhtio?: string; virhe?: string }> }) {
  const ctx = await requireStaff();
  const sp = await searchParams;
  const companyId = sp.yhtio && /^[0-9a-f-]{36}$/i.test(sp.yhtio) ? sp.yhtio : null;
  const [companies, recipients] = await ctx.run((tx) =>
    Promise.all([listCompanyOptions(tx, ctx.org.organizationId), companyId ? listContactRecipients(tx, companyId) : Promise.resolve([])]),
  );
  const canWrite = ctx.can("owner", "manager", "assistant", "accountant");

  return (
    <>
      <PageHeader title="Uusi viesti" subtitle="Viesti osakkaalle, asukkaalle tai hallituksen jäsenelle portaalin kautta" back={{ href: "/yhteydenotot", label: "Yhteydenotot" }} />
      <FormError message={sp.virhe} />
      <Panel className="max-w-2xl">
        <form method="get" className="mb-5 flex flex-wrap items-end gap-3">
          <Field label="Taloyhtiö" htmlFor="yhtio">
            <Select id="yhtio" name="yhtio" defaultValue={companyId ?? ""} required>
              <option value="" disabled>
                Valitse yhtiö
              </option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Button type="submit" variant="secondary">
            Valitse
          </Button>
        </form>

        {!companyId ? null : recipients.length === 0 ? (
          <Notice tone="warn" title="Yhtiössä ei ole portaalikäyttäjiä">
            Viestin voi lähettää vain henkilölle, jolla on portaalitunnus. Kutsu osakas portaaliin osakasluettelosta tai lähetä tiedote.
          </Notice>
        ) : !canWrite ? (
          <p className="text-sm text-ink/65">Roolillasi ei voi lähettää viestejä.</p>
        ) : (
          <PhotoForm action={staffStartThread} field="attachments" className="grid gap-4">
            <input type="hidden" name="company_id" value={companyId} />
            <Field label="Vastaanottaja" htmlFor="recipient" hint="Vain portaalitunnuksen omaavat. Huoneistoa koskeva viesti näkyy vastaanottajalle huoneiston asiana.">
              <Select id="recipient" name="recipient" required defaultValue="">
                <option value="" disabled>
                  Valitse vastaanottaja
                </option>
                {recipients.map((r) => (
                  <option key={`${r.userId}|${r.shareGroupId ?? ""}`} value={`${r.userId}|${r.shareGroupId ?? ""}`}>
                    {r.unitLabel ? `${r.unitLabel}: ` : ""}
                    {r.name} ({ROLE_LABEL[r.role]})
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Aihe" htmlFor="topic">
              <Select id="topic" name="topic" required defaultValue="general">
                {CONTACT_TOPICS.map((t) => (
                  <option key={t} value={t}>
                    {CONTACT_TOPIC_LABEL[t]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Otsikko" htmlFor="subject">
              <Input id="subject" name="subject" required minLength={3} maxLength={200} />
            </Field>
            <Field label="Viesti" htmlFor="body" hint="Vastaanottaja saa sähköpostiin ilmoituksen ja lukee viestin portaalissa.">
              <Textarea id="body" name="body" required maxLength={MAX_CONTACT_BODY} rows={6} />
            </Field>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="attachments" className="text-sm font-semibold">
                Liitteet (valinnainen, enintään {MAX_CONTACT_ATTACHMENTS})
              </label>
              <input id="attachments" name="attachments" type="file" multiple accept={ATTACHMENT_ACCEPT} className="text-sm" />
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button>Lähetä viesti</Button>
              <Link href="/yhteydenotot" className="text-sm text-ink/60 hover:text-ink">
                Peruuta
              </Link>
            </div>
          </PhotoForm>
        )}
      </Panel>
    </>
  );
}
