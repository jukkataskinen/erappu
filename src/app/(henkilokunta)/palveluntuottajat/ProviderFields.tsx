import { Field, Input, Textarea } from "@/components/ui";
import type { ProviderRow } from "@/lib/service-requests/queries";

export function ProviderFields({ provider }: { provider?: ProviderRow | null }) {
  return (
    <>
      <Field label="Nimi" htmlFor="name">
        <Input id="name" name="name" required maxLength={200} defaultValue={provider?.name ?? ""} />
      </Field>
      <Field label="Y-tunnus" htmlFor="business_id">
        <Input id="business_id" name="business_id" maxLength={20} defaultValue={provider?.business_id ?? ""} />
      </Field>
      <Field label="Sähköposti" htmlFor="email" hint="Työtilaukset lähetetään tähän osoitteeseen">
        <Input id="email" name="email" type="email" maxLength={254} defaultValue={provider?.email ?? ""} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Puhelin" htmlFor="phone">
          <Input id="phone" name="phone" type="tel" maxLength={40} defaultValue={provider?.phone ?? ""} />
        </Field>
        <Field label="Päivystysnumero" htmlFor="emergency_phone" hint="Näytetään portaalissa, jos palvelu on yhtiön oletus">
          <Input id="emergency_phone" name="emergency_phone" type="tel" maxLength={40} defaultValue={provider?.emergency_phone ?? ""} />
        </Field>
      </div>
      <Field label="Toimialat" htmlFor="trades" hint="Pilkulla eroteltuna, esim. kiinteistöhuolto, lvi, sähkö">
        <Input id="trades" name="trades" maxLength={500} defaultValue={provider?.trades.join(", ") ?? ""} />
      </Field>
      <Field label="Muistiinpanot" htmlFor="notes">
        <Textarea id="notes" name="notes" maxLength={2000} rows={3} defaultValue={provider?.notes ?? ""} />
      </Field>
    </>
  );
}
