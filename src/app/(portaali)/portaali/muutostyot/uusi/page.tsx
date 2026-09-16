import Link from "next/link";
import { FormError } from "@/components/FormError";
import { Button, EmptyState, Field, Input, Notice, Panel, Select, Textarea } from "@/components/ui";
import { requirePortal } from "@/lib/auth/current-user";
import { ATTACHMENT_ACCEPT } from "@/lib/maintenance/attachments";
import { MAX_NOTICE_ATTACHMENTS, MAX_NOTICE_WORKS } from "@/lib/maintenance/notice-form";
import { listRenovationGuides, type RenovationGuideRow } from "@/lib/maintenance/queries";
import { WORK_TYPE_LABELS } from "@/lib/maintenance/work-types";
import { PhotoForm } from "@/lib/service-requests/components/PhotoForm";
import { submitRenovationNotice } from "../actions";

export const metadata = { title: "Uusi muutostyöilmoitus" };

/**
 * Yksi muutostyö ilmoituksella. Lohkot lähettävät samannimiset kentät, ja
 * palvelin kokoaa niistä rivit (`parseNoticeWorks`). Tyhjä lohko jätetään
 * huomiotta, joten lomake toimii myös ilman JavaScriptiä.
 */
function WorkBlock({ index }: { index: number }) {
  const id = (name: string) => `${name}_${index}`;
  return (
    <div className="grid gap-4">
      <Field label="Työlaji" htmlFor={id("work_type")}>
        <Select id={id("work_type")} name="work_type" defaultValue="">
          <option value="">Valitse</option>
          {WORK_TYPE_LABELS.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Mitä tehdään" htmlFor={id("work_description")} hint="Missä tilassa, mitä rakenteita tai järjestelmiä työ koskee, tarvitaanko vedenkatkoa.">
        <Textarea id={id("work_description")} name="work_description" rows={3} maxLength={2000} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Aloitus" htmlFor={id("work_planned_start")}>
          <Input id={id("work_planned_start")} name="work_planned_start" type="date" />
        </Field>
        <Field label="Valmistuu" htmlFor={id("work_planned_end")}>
          <Input id={id("work_planned_end")} name="work_planned_end" type="date" />
        </Field>
      </div>
      <Field label="Työn tekee" htmlFor={id("contractor_kind")}>
        <Select id={id("contractor_kind")} name="contractor_kind" defaultValue="">
          <option value="">Valitse</option>
          <option value="contractor">Urakoitsija tai muu ulkopuolinen tekijä</option>
          <option value="shareholder">Osakas itse</option>
        </Select>
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Yrityksen nimi" htmlFor={id("contractor_name")} hint="Pakollinen, jos työn tekee urakoitsija">
          <Input id={id("contractor_name")} name="contractor_name" maxLength={200} />
        </Field>
        <Field label="Y-tunnus" htmlFor={id("contractor_business_id")}>
          <Input id={id("contractor_business_id")} name="contractor_business_id" maxLength={20} placeholder="1234567-8" />
        </Field>
      </div>
      <Field label="Yhteyshenkilö ja puhelin" htmlFor={id("contractor_contact")}>
        <Input id={id("contractor_contact")} name="contractor_contact" maxLength={200} />
      </Field>
      <Field label="Pätevyys" htmlFor={id("contractor_qualification")} hint="Esimerkiksi sertifioitu vedeneristäjä, sähköpätevyys tai KVV-työnjohtaja.">
        <Input id={id("contractor_qualification")} name="contractor_qualification" maxLength={500} />
      </Field>
    </div>
  );
}

function GuideLink({ guides, multiCompany }: { guides: RenovationGuideRow[]; multiCompany: boolean }) {
  if (guides.length === 0) {
    return (
      <p className="text-xs text-ink/60">
        Yhtiön omaa muutostyöohjetta ei ole tallennettu portaaliin. Noudata asunto-osakeyhtiölain 5 luvun sääntöjä: ilmoita työstä etukäteen kirjallisesti, käytä päteviä
        tekijöitä, älä kajoa yhtiön vastuulla oleviin rakenteisiin ilman lupaa ja siivoa jäljet. Isännöitsijä kertoo tarvittaessa yhtiön omat käytännöt.
      </p>
    );
  }
  return (
    <ul className="text-xs text-ink/70">
      {guides.map((g) => (
        <li key={g.id}>
          <a href={`/api/dokumentit/${g.id}`} target="_blank" rel="noreferrer" className="text-sky underline">
            {multiCompany && g.company_name ? `${g.company_name}: ${g.title}` : g.title}
          </a>
        </li>
      ))}
    </ul>
  );
}

export default async function NewRenovationNoticePage({ searchParams }: { searchParams: Promise<{ virhe?: string }> }) {
  const ctx = await requirePortal();
  const { virhe } = await searchParams;
  const units = [...new Map(ctx.user.portal.filter((g) => g.role === "owner" && g.shareGroupId).map((g) => [g.shareGroupId, g])).values()];
  const companyIds = [...new Set(units.map((u) => u.companyId))];
  const guides = await ctx.run((tx) => listRenovationGuides(tx, companyIds));

  return (
    <>
      <Link href="/portaali/muutostyot" className="text-sm text-ink/60 hover:text-ink">
        ← Muutostyöt
      </Link>
      <h1 className="mt-2 text-2xl">Muutostyöilmoitus</h1>
      <p className="mt-2 text-sm text-ink/65">
        Kerro, mitä aiot tehdä ja kuka työn tekee. Isännöitsijä käsittelee ilmoituksen, voi pyytää lisätietoja ja asettaa työlle ehtoja.
      </p>

      <div className="mt-4">
        <Notice tone="warn" title="Ennen kuin aloitat">
          <ul className="list-disc space-y-1 pl-4">
            <li>
              Ilmoituksen käsittely kestää tavallisesti 2–4 viikkoa. Jos työ vaatii hallituksen käsittelyä tai ulkopuolista asiantuntijaa, aikaa voi kulua poikkeustapauksessa jopa
              kaksi kuukautta.
            </li>
            <li>Työtä ei saa aloittaa ennen kuin ilmoitus on käsitelty ja olet saanut yhtiöltä aloitusluvan. Ilman lupaa aloitettu työ jää osakkaan vastuulle myös silloin, kun se joudutaan purkamaan.</li>
            <li>Jos kyse on vahingosta tai muusta kiireestä, soita isännöitsijälle. Älä jää odottamaan lomakkeen käsittelyä.</li>
          </ul>
        </Notice>
      </div>

      <div className="mt-5">
        <FormError message={virhe} />
      </div>

      {units.length === 0 ? (
        <EmptyState title="Ei huoneistoa">Muutostyöilmoituksen voi tehdä vain huoneiston osakas.</EmptyState>
      ) : (
        <PhotoForm action={submitRenovationNotice} field="attachments" className="grid gap-5">
          <Panel className="grid gap-4">
            <Field label="Huoneisto" htmlFor="share_group_id">
              <Select id="share_group_id" name="share_group_id" required defaultValue={units.length === 1 ? units[0].shareGroupId! : ""}>
                {units.length > 1 ? (
                  <option value="" disabled>
                    Valitse
                  </option>
                ) : null}
                {units.map((u) => (
                  <option key={u.shareGroupId} value={u.shareGroupId!}>
                    {u.companyName}, {u.unitLabel}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Yhteenveto" htmlFor="description" hint="Yhdellä lauseella: mistä remontista on kyse ja miksi.">
              <Textarea id="description" name="description" required minLength={10} maxLength={4000} rows={3} />
            </Field>
          </Panel>

          <Panel className="grid gap-4">
            <h2 className="text-lg">Muutostyöt</h2>
            <p className="text-sm text-ink/65">
              Ilmoita jokainen työlaji erikseen ja kerro kunkin työn tekijä. Samaan ilmoitukseen mahtuu {MAX_NOTICE_WORKS} työtä.
            </p>
            <WorkBlock index={1} />
            {Array.from({ length: MAX_NOTICE_WORKS - 1 }, (_, i) => i + 2).map((n) => (
              <details key={n} className="rounded-[var(--radius-panel)] border border-line bg-cloud/40 p-4">
                <summary className="cursor-pointer text-sm font-semibold">Muutostyö {n} (valinnainen)</summary>
                <div className="mt-4">
                  <WorkBlock index={n} />
                </div>
              </details>
            ))}
          </Panel>

          <Panel className="grid gap-4">
            <h2 className="text-lg">Liitteet</h2>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="attachments" className="text-sm font-semibold">
                Suunnitelmat, piirustukset ja kuvat
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
                Enintään {MAX_NOTICE_ATTACHMENTS} liitettä, yhteensä 20 Mt: PDF, kuva, Word tai Excel. Liitteet näkyvät sinulle, isännöitsijälle ja hallitukselle. Kuvista poistetaan
                sijaintitieto.
              </p>
            </div>
          </Panel>

          <Panel className="grid gap-4">
            <h2 className="text-lg">Kuittaus ja ilmoitustapa</h2>
            <div className="grid gap-1.5">
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" name="guide_ack" value="on" required className="mt-0.5 size-4" />
                <span>Olen lukenut muutostyöohjeen ja noudatan sitä.</span>
              </label>
              <GuideLink guides={guides} multiCompany={companyIds.length > 1} />
            </div>
            <fieldset className="grid gap-1.5">
              <legend className="text-sm font-semibold">Haluan tiedon tilamuutoksista</legend>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="notify_email" value="on" defaultChecked className="size-4" /> Sähköpostilla
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="notify_sms" value="on" className="size-4" /> Tekstiviestillä
              </label>
              <p className="text-xs text-ink/55">Tekstiviestit eivät ole vielä käytössä. Valinta tallennetaan, ja viestit lähtevät toistaiseksi sähköpostilla.</p>
            </fieldset>
          </Panel>

          <div>
            <Button className="w-full sm:w-auto">Lähetä ilmoitus</Button>
          </div>
        </PhotoForm>
      )}
    </>
  );
}
