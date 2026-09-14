import { Button, Field, Input, Panel, SectionTitle, Select } from "@/components/ui";
import { CATEGORY_LABEL, DOCUMENT_CATEGORIES, SELECTABLE_VISIBILITIES, UPLOAD_ACCEPT, VISIBILITY_LABEL } from "@/lib/documents/labels";

/**
 * Latauslomake. Lähetetään reitille /api/dokumentit/upload (multipart), joka
 * ohjaa takaisin `back`-polkuun. Jos yhtiö on kiinnitetty, huoneiston voi
 * valita; yleisessä dokumenttipankissa huoneisto valitaan dokumentin sivulta.
 */
export function DocumentUploadForm({
  back,
  companies,
  fixedCompanyId,
  shareGroups = [],
}: {
  back: string;
  companies?: { id: string; name: string }[];
  fixedCompanyId?: string;
  shareGroups?: { id: string; unit_label: string }[];
}) {
  const year = new Date().getFullYear();
  return (
    <Panel>
      <SectionTitle>Lisää dokumentti</SectionTitle>
      <form action="/api/dokumentit/upload" method="post" encType="multipart/form-data" className="grid gap-4">
        <input type="hidden" name="back" value={back} />
        {fixedCompanyId ? (
          <input type="hidden" name="company_id" value={fixedCompanyId} />
        ) : (
          <Field label="Taloyhtiö" htmlFor="company_id">
            <Select id="company_id" name="company_id" defaultValue="" required>
              <option value="" disabled>
                Valitse yhtiö
              </option>
              {(companies ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field label="Tiedosto" htmlFor="file" hint="PDF, kuva (JPG, PNG, WebP), CSV, XLSX tai DOCX, enintään 20 Mt.">
          <Input id="file" name="file" type="file" accept={UPLOAD_ACCEPT} required className="py-2" />
        </Field>
        <Field label="Otsikko" htmlFor="title" hint="Tyhjä = tiedoston nimi">
          <Input id="title" name="title" maxLength={200} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Luokka" htmlFor="category">
            <Select id="category" name="category" defaultValue="other">
              {DOCUMENT_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABEL[c]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Vuosi" htmlFor="year">
            <Input id="year" name="year" inputMode="numeric" placeholder={String(year)} />
          </Field>
        </div>
        <Field label="Näkyvyys" htmlFor="visibility" hint="Kuka portaalissa näkee dokumentin. Henkilökunta näkee aina.">
          <Select id="visibility" name="visibility" defaultValue="internal">
            {SELECTABLE_VISIBILITIES.map((v) => (
              <option key={v} value={v}>
                {VISIBILITY_LABEL[v]}
              </option>
            ))}
          </Select>
        </Field>
        {fixedCompanyId && shareGroups.length > 0 ? (
          <Field label="Huoneisto (valinnainen)" htmlFor="share_group_id" hint="Huoneistokohtainen dokumentti näkyy vain sen osakkaille ja asukkaille.">
            <Select id="share_group_id" name="share_group_id" defaultValue="">
              <option value="">Koko yhtiö</option>
              {shareGroups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.unit_label}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        <div>
          <Button variant="secondary">Lataa</Button>
        </div>
      </form>
    </Panel>
  );
}
