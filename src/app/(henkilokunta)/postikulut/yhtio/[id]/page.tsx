import { notFound } from "next/navigation";
import { FormError } from "@/components/FormError";
import { Button, Field, Input, Notice, PageHeader, Panel, Select } from "@/components/ui";
import { requireStaff } from "@/lib/auth/current-user";
import { getBillingProfile } from "@/lib/letters/billing";
import { billingProblems, INVOICE_CHANNEL_LABEL, INVOICE_CHANNELS } from "@/lib/letters/pricing";
import { saveBillingProfileAction } from "../../actions";

export const metadata = { title: "Taloyhtiön laskutustiedot" };

/**
 * Taloyhtiön laskutustiedot isännöintiyrityksen Fennoa-laskulle. Laskukanavalle
 * ei ole oletusta: se valitaan itse, ja puuttuva kanava estää viennin.
 */
export default async function BillingProfilePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ virhe?: string; tallennettu?: string }> }) {
  const ctx = await requireStaff();
  if (!ctx.can("owner", "manager", "accountant")) notFound();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const sp = await searchParams;
  const profile = await ctx.run((tx) => getBillingProfile(tx, id));
  if (!profile) notFound();
  const problems = profile.saved ? billingProblems(profile) : [];

  return (
    <>
      <PageHeader back={{ href: "/postikulut", label: "Postikulut" }} title={`Laskutustiedot: ${profile.company_name}`} subtitle="Postikulujen lasku Fennoaan." />
      <FormError message={sp.virhe} />
      {sp.tallennettu ? (
        <div className="mb-5">
          <Notice tone={problems.length ? "warn" : "ok"} title="Tallennettu">
            {problems.length ? `Laskua ei voi vielä viedä: ${problems.join(" ")}` : "Laskutustiedot ovat valmiit vientiin."}
          </Notice>
        </div>
      ) : null}
      <Panel>
        <form action={saveBillingProfileAction} className="grid gap-4 sm:grid-cols-2">
          <input type="hidden" name="company_id" value={profile.company_id} />
          <Field label="Fennoan asiakasnumero" htmlFor="fennoa_customer_no" hint="Sama asiakas kuin isännöintilaskuilla.">
            <Input id="fennoa_customer_no" name="fennoa_customer_no" defaultValue={profile.fennoa_customer_no ?? ""} />
          </Field>
          <Field label="Laskukanava" htmlFor="invoice_channel" hint="Valitse sama kanava kuin isännöintilaskuilla.">
            <Select id="invoice_channel" name="invoice_channel" defaultValue={profile.invoice_channel ?? ""}>
              <option value="">Valitse</option>
              {INVOICE_CHANNELS.map((c) => (
                <option key={c} value={c}>
                  {INVOICE_CHANNEL_LABEL[c]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Verkkolaskuosoite" htmlFor="einvoice_address" hint="Verkkolaskulle, esim. 003712345678">
            <Input id="einvoice_address" name="einvoice_address" defaultValue={profile.einvoice_address ?? ""} />
          </Field>
          <Field label="Välittäjätunnus" htmlFor="einvoice_operator" hint="Verkkolaskulle, esim. 003723327487 tai NDEAFIHH">
            <Input id="einvoice_operator" name="einvoice_operator" defaultValue={profile.einvoice_operator ?? ""} />
          </Field>
          <Field label="Laskutussähköposti" htmlFor="email" hint="Sähköpostilaskulle">
            <Input id="email" name="email" type="email" defaultValue={profile.email ?? ""} />
          </Field>
          <div />
          <Field label="Laskutusosoite" htmlFor="street_address" hint={profile.saved ? undefined : "Esitäytetty yhtiön osoitteella."}>
            <Input id="street_address" name="street_address" defaultValue={profile.street_address ?? ""} />
          </Field>
          <div className="grid grid-cols-[8rem_1fr] gap-3">
            <Field label="Postinumero" htmlFor="postal_code">
              <Input id="postal_code" name="postal_code" inputMode="numeric" defaultValue={profile.postal_code ?? ""} />
            </Field>
            <Field label="Postitoimipaikka" htmlFor="city">
              <Input id="city" name="city" defaultValue={profile.city ?? ""} />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Button>Tallenna</Button>
          </div>
        </form>
      </Panel>
    </>
  );
}
