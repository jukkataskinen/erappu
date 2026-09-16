import Link from "next/link";
import { FormError } from "@/components/FormError";
import { Button, Field, Input, Notice, Panel, Select, Textarea } from "@/components/ui";
import { requirePortal } from "@/lib/auth/current-user";
import { CONTACT_TOPIC_LABEL, CONTACT_TOPICS, MAX_CONTACT_ATTACHMENTS, MAX_CONTACT_BODY } from "@/lib/contacts/labels";
import { ATTACHMENT_ACCEPT } from "@/lib/maintenance/attachments";
import { PhotoForm } from "@/lib/service-requests/components/PhotoForm";
import { createContact } from "../actions";

export const metadata = { title: "Uusi yhteydenotto" };

export default async function NewContactPage({ searchParams }: { searchParams: Promise<{ virhe?: string; aihe?: string }> }) {
  const ctx = await requirePortal();
  const { virhe, aihe } = await searchParams;

  // Omat huoneistot ensin, sitten yhtiön yleiset asiat.
  const targets = new Map<string, string>();
  for (const g of ctx.user.portal) {
    if ((g.role === "owner" || g.role === "resident") && g.shareGroupId) targets.set(`huoneisto:${g.shareGroupId}`, `${g.companyName}, huoneisto ${g.unitLabel ?? ""}`.trim());
  }
  for (const g of ctx.user.portal) {
    if (g.role !== "provider") targets.set(`yhtio:${g.companyId}`, `${g.companyName}, yhtiötä koskeva asia`);
  }
  const options = [...targets.entries()];
  const topic = CONTACT_TOPICS.find((t) => t === aihe) ?? "general";

  return (
    <>
      <Link href="/portaali/yhteydenotot" className="text-sm text-ink/60 hover:text-ink">
        ← Yhteydenotot
      </Link>
      <h1 className="mt-2 text-2xl">Uusi yhteydenotto</h1>
      <div className="mt-4 max-w-2xl">
        <Notice tone="info" title="Vika, vuoto tai rikkoutunut laite?">
          Tee siitä{" "}
          <Link href="/portaali/huoltopyynnot/uusi" className="font-semibold underline">
            huoltopyyntö
          </Link>
          , niin korjaus tilataan suoraan. Kiireellisessä vaarassa soita kiinteistön päivystykseen.
        </Notice>
      </div>

      <Panel className="mt-5 max-w-2xl">
        <FormError message={virhe} />
        {options.length === 0 ? (
          <p className="text-sm text-ink/70">Sinulla ei ole taloyhtiötä, jonka isännöintiin voisit ottaa yhteyttä.</p>
        ) : (
          <PhotoForm action={createContact} field="attachments" className="grid gap-4">
            <Field label="Mitä asia koskee" htmlFor="target">
              <Select id="target" name="target" required defaultValue={options[0][0]}>
                {options.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Aihe" htmlFor="topic">
              <Select id="topic" name="topic" required defaultValue={topic}>
                {CONTACT_TOPICS.map((t) => (
                  <option key={t} value={t}>
                    {CONTACT_TOPIC_LABEL[t]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Otsikko" htmlFor="subject">
              <Input id="subject" name="subject" required minLength={3} maxLength={200} placeholder="Esim. Vastikelaskun erittely" />
            </Field>
            <Field label="Viesti" htmlFor="body" hint="Älä kirjoita viestiin henkilötunnusta tai pankkitunnuksia.">
              <Textarea id="body" name="body" required maxLength={MAX_CONTACT_BODY} rows={6} />
            </Field>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="attachments" className="text-sm font-semibold">
                Liitteet (valinnainen)
              </label>
              <input
                id="attachments"
                name="attachments"
                type="file"
                accept={ATTACHMENT_ACCEPT}
                multiple
                className="block w-full rounded-xl border border-dashed border-line bg-paper px-3.5 py-3 text-sm file:mr-3 file:rounded-full file:border-0 file:bg-cloud file:px-4 file:py-2 file:font-semibold"
              />
              <p className="text-xs text-ink/55">
                Enintään {MAX_CONTACT_ATTACHMENTS} liitettä: PDF, kuva, Word tai Excel. Liitteet näkyvät vain sinulle ja isännöinnille.
              </p>
            </div>
            <div>
              <Button type="submit" className="w-full sm:w-auto">
                Lähetä isännöinnille
              </Button>
            </div>
          </PhotoForm>
        )}
      </Panel>
    </>
  );
}
