import Link from "next/link";
import { URGENT_REPAIR_SHORT } from "@/lib/responsibility/content";
import { FormError } from "@/components/FormError";
import { Button, Field, Input, Notice, Panel, Select, Textarea } from "@/components/ui";
import { requirePortal } from "@/lib/auth/current-user";
import { PhotoForm } from "@/lib/service-requests/components/PhotoForm";
import { PhotoInput } from "@/lib/service-requests/components/PhotoInput";
import { CATEGORIES, CATEGORY_LABEL, URGENCY_LABEL } from "@/lib/service-requests/labels";
import { listEmergencyContacts } from "@/lib/service-requests/queries";
import { createPortalRequest } from "../actions";

export const metadata = { title: "Tee huoltopyyntö" };

export default async function NewPortalRequestPage({ searchParams }: { searchParams: Promise<{ virhe?: string }> }) {
  const ctx = await requirePortal();
  const { virhe } = await searchParams;
  const emergency = await ctx.run((tx) => listEmergencyContacts(tx));

  // Valinnat portaalioikeuksista: huoneistot ensin, hallituksen jäsenelle myös yhtiön yhteiset tilat.
  const targets = new Map<string, string>();
  for (const g of ctx.user.portal) {
    if (g.role === "provider") continue;
    if (g.shareGroupId) targets.set(`${g.companyId}|${g.shareGroupId}`, `${g.companyName}, ${g.unitLabel ?? "huoneisto"}`);
  }
  for (const g of ctx.user.portal) {
    if (g.role === "provider") continue;
    targets.set(g.companyId, `${g.companyName}, yhteiset tilat`);
  }
  const options = [...targets.entries()];
  const companyIds = new Set(ctx.user.portal.map((g) => g.companyId));
  const contacts = emergency.filter((e) => companyIds.has(e.company_id));

  return (
    <>
      <Link href="/portaali/huoltopyynnot" className="text-sm text-ink/60 hover:text-ink">
        ← Huoltopyynnöt
      </Link>
      <h1 className="mt-2 text-2xl">Tee huoltopyyntö</h1>
      <p className="mt-1 text-sm text-ink/70">
        Kuuluuko vika yhtiölle vai minulle?{" "}
        <Link href="/portaali/vastuunjako" className="font-semibold text-sky underline-offset-2 hover:underline">
          Katso vastuunjakotaulukko
        </Link>
      </p>
      <p className="mt-1 text-sm text-ink/70">{URGENT_REPAIR_SHORT}</p>

      <div className="mt-4">
        <Notice tone="alert" title="Vesivuoto tai muu kiireellinen vaara">
          {contacts.length ? (
            <>
              Soita heti päivystykseen:{" "}
              {contacts.map((c, i) => (
                <span key={`${c.company_id}-${i}`}>
                  {i > 0 ? ", " : ""}
                  <a href={`tel:${c.emergency_phone.replace(/[^+0-9]/g, "")}`} className="font-semibold underline">
                    {c.emergency_phone}
                  </a>{" "}
                  ({c.provider_name})
                </span>
              ))}
              . Sulje vesi, jos pystyt. Tee pyyntö sen jälkeen.
            </>
          ) : (
            <>Soita heti kiinteistön päivystysnumeroon (porraskäytävän ilmoitustaululla). Sulje vesi, jos pystyt. Tee pyyntö sen jälkeen.</>
          )}
        </Notice>
      </div>

      <Panel className="mt-5">
        <FormError message={virhe} />
        {options.length === 0 ? (
          <p className="text-sm text-ink/70">Sinulla ei ole huoneistoa, johon voisit tehdä huoltopyynnön.</p>
        ) : (
          <PhotoForm action={createPortalRequest} className="grid gap-4">
            <Field label="Kohde" htmlFor="target">
              <Select id="target" name="target" required defaultValue={options[0][0]}>
                {options.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Aihe" htmlFor="category">
              <Select id="category" name="category" required defaultValue="">
                <option value="" disabled>
                  Valitse aihe
                </option>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_LABEL[c]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Mikä on vialla?" htmlFor="description">
              <Textarea id="description" name="description" required minLength={5} maxLength={5000} rows={5} placeholder="Kerro, mikä on rikki ja missä. Esim. keittiön hana tippuu jatkuvasti." />
            </Field>
            <fieldset className="grid gap-2">
              <legend className="mb-1 text-sm font-semibold">Kiireellisyys</legend>
              {(["normal", "urgent", "low"] as const).map((u) => (
                <label key={u} className="flex min-h-[var(--size-touch)] items-center gap-3 rounded-xl border border-line px-3.5">
                  <input type="radio" name="urgency" value={u} defaultChecked={u === "normal"} className="h-5 w-5" />
                  {URGENCY_LABEL[u]}
                </label>
              ))}
            </fieldset>
            <label className="flex min-h-[var(--size-touch)] items-center gap-3 text-sm">
              <input type="checkbox" name="may_use_master_key" className="h-5 w-5" /> Huoltomies saa mennä huoneistoon yleisavaimella, jos en ole kotona
            </label>
            <label className="flex min-h-[var(--size-touch)] items-center gap-3 text-sm">
              <input type="checkbox" name="has_pets" className="h-5 w-5" /> Huoneistossa on lemmikkejä
            </label>
            <Field label="Puhelin" htmlFor="reporter_phone" hint="Huoltomies voi soittaa ennen käyntiä. Numero näkyy vain tätä pyyntöä hoitavalle.">
              <Input id="reporter_phone" name="reporter_phone" type="tel" maxLength={40} autoComplete="tel" />
            </Field>
            <PhotoInput />
            <Button type="submit" className="w-full sm:w-auto">
              Lähetä pyyntö
            </Button>
          </PhotoForm>
        )}
      </Panel>
    </>
  );
}
