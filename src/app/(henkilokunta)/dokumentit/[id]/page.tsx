import { notFound } from "next/navigation";
import { FormError } from "@/components/FormError";
import { Badge, Button, DefinitionList, Field, Input, LinkButton, Notice, PageHeader, Panel, SectionTitle, Select } from "@/components/ui";
import { requireStaff } from "@/lib/auth/current-user";
import { formatDateTime } from "@/lib/format";
import { getDocument } from "@/lib/documents/queries";
import { CATEGORY_LABEL, DOCUMENT_CATEGORIES, SELECTABLE_VISIBILITIES, VISIBILITY_LABEL, VISIBILITY_TONE, formatBytes } from "@/lib/documents/labels";
import { deleteDocument, updateDocument } from "../actions";

export const metadata = { title: "Dokumentti" };

export default async function DocumentPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ virhe?: string; tallennettu?: string }> }) {
  const ctx = await requireStaff();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { virhe, tallennettu } = await searchParams;

  const data = await ctx.run(async (tx) => {
    const doc = await getDocument(tx, id);
    if (!doc) return null;
    const groups = doc.company_id
      ? await tx.query<{ id: string; unit_label: string }>(
          "select id, unit_label from er_share_groups where company_id = $1 and removed_on is null order by length(unit_label), unit_label",
          [doc.company_id],
        )
      : [];
    return { doc, groups };
  });
  if (!data) notFound();
  const { doc, groups } = data;
  const canEdit = ctx.can("owner", "manager", "assistant", "accountant");
  const canDelete = ctx.can("owner", "manager") && !doc.sealed;
  const back = doc.company_id ? `/taloyhtiot/${doc.company_id}/dokumentit` : "/dokumentit";
  const lockedVisibility = !(SELECTABLE_VISIBILITIES as readonly string[]).includes(doc.visibility);

  return (
    <>
      <PageHeader
        back={{ href: back, label: doc.company_name ?? "Dokumentit" }}
        title={doc.title}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <span>{CATEGORY_LABEL[doc.category as keyof typeof CATEGORY_LABEL] ?? doc.category}</span>
            <Badge tone={VISIBILITY_TONE[doc.visibility] ?? "neutral"}>{VISIBILITY_LABEL[doc.visibility] ?? doc.visibility}</Badge>
            {doc.sealed ? <Badge tone="ok">Sinetöity</Badge> : null}
          </span>
        }
        actions={
          <>
            <LinkButton variant="secondary" href={`/api/dokumentit/${doc.id}`} target="_blank" prefetch={false}>
              Avaa
            </LinkButton>
            <LinkButton variant="secondary" href={`/api/dokumentit/${doc.id}?lataa=1`} prefetch={false}>
              Lataa
            </LinkButton>
          </>
        }
      />
      <FormError message={virhe} />
      {tallennettu ? (
        <div className="mb-5">
          <Notice tone="ok" title="Muutokset tallennettu" />
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[1fr_1fr]">
        <Panel>
          <SectionTitle>Tiedosto</SectionTitle>
          <DefinitionList
            items={[
              { label: "Yhtiö", value: doc.company_name },
              { label: "Huoneisto", value: doc.unit_label ?? "Koko yhtiö" },
              { label: "Tiedostonimi", value: doc.file_name },
              { label: "Koko", value: formatBytes(doc.size_bytes) },
              { label: "Tyyppi", value: doc.mime_type },
              { label: "Vuosi", value: doc.year ?? "–" },
              { label: "Lisätty", value: formatDateTime(doc.created_at) },
              { label: "Lisääjä", value: doc.uploaded_by_name },
              { label: "Liittyy", value: doc.subject_table ? "Toisen moduulin liite" : "–" },
            ]}
          />
        </Panel>

        <div className="grid content-start gap-6">
          {canEdit ? (
            <Panel>
              <SectionTitle>Muokkaa</SectionTitle>
              <form action={updateDocument} className="grid gap-4">
                <input type="hidden" name="id" value={doc.id} />
                <Field label="Otsikko" htmlFor="title">
                  <Input id="title" name="title" defaultValue={doc.title} maxLength={200} required />
                </Field>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Luokka" htmlFor="category">
                    <Select id="category" name="category" defaultValue={doc.category}>
                      {DOCUMENT_CATEGORIES.map((c) => (
                        <option key={c} value={c}>
                          {CATEGORY_LABEL[c]}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Vuosi" htmlFor="year">
                    <Input id="year" name="year" inputMode="numeric" defaultValue={doc.year ?? ""} />
                  </Field>
                </div>
                <Field label="Näkyvyys" htmlFor="visibility" hint={lockedVisibility ? "Liitteen näkyvyyttä hallitaan sen omassa moduulissa." : undefined}>
                  <Select id="visibility" name="visibility" defaultValue={lockedVisibility ? "internal" : doc.visibility} disabled={lockedVisibility}>
                    {SELECTABLE_VISIBILITIES.map((v) => (
                      <option key={v} value={v}>
                        {VISIBILITY_LABEL[v]}
                      </option>
                    ))}
                  </Select>
                  {lockedVisibility ? <input type="hidden" name="visibility" value="internal" /> : null}
                </Field>
                {groups.length > 0 ? (
                  <Field label="Huoneisto" htmlFor="share_group_id" hint="Huoneistokohtainen dokumentti näkyy vain sen osakkaille ja asukkaille.">
                    <Select id="share_group_id" name="share_group_id" defaultValue={doc.share_group_id ?? ""}>
                      <option value="">Koko yhtiö</option>
                      {groups.map((g) => (
                        <option key={g.id} value={g.id}>
                          {g.unit_label}
                        </option>
                      ))}
                    </Select>
                  </Field>
                ) : null}
                <div>
                  <Button variant="secondary">Tallenna</Button>
                </div>
              </form>
            </Panel>
          ) : null}

          {canDelete ? (
            <Panel>
              <SectionTitle>Poista</SectionTitle>
              <p className="mb-3 text-sm text-ink/65">Poisto poistaa myös tiedoston varastosta. Poistoa ei voi perua.</p>
              <form action={deleteDocument}>
                <input type="hidden" name="id" value={doc.id} />
                <input type="hidden" name="back" value={back} />
                <Button variant="danger">Poista dokumentti</Button>
              </form>
            </Panel>
          ) : null}
        </div>
      </div>
    </>
  );
}
