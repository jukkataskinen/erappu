import type { ReactNode } from "react";
import { Button, Field, Input, Select } from "@/components/ui";
import { CATEGORY_LABEL, DOCUMENT_CATEGORIES, UPLOAD_ACCEPT, VISIBILITY_LABEL, type DocumentCategory } from "@/lib/documents/labels";
import { formatDate } from "@/lib/format";
import type { ItemAttachment } from "@/lib/meetings/attachments";
import { attachExistingDocumentAction, removeAttachmentAction } from "../../../../kokoukset/actions";

/**
 * Pykälän liitteet kokoussivulla. Liite avautuu uuteen välilehteen, jotta
 * kokouksen aikana asialista pysyy auki pykälän käsittelyn ajan.
 */
export function AttachmentLinks({ attachments }: { attachments: ItemAttachment[] }) {
  if (attachments.length === 0) return null;
  return (
    <ul className="mt-2 grid gap-1">
      {attachments.map((a) => (
        <li key={a.id} className="flex flex-wrap items-baseline gap-x-2 text-sm">
          <span className="font-semibold tabular-nums text-ink/70">{a.label}</span>
          {a.title ? (
            <a href={`/api/dokumentit/${a.document_id}`} target="_blank" rel="noopener" className="font-semibold text-sky hover:underline">
              {a.title}
            </a>
          ) : (
            <span className="text-ink/55">ei näkyvissä</span>
          )}
        </li>
      ))}
    </ul>
  );
}

export function ItemAttachmentEditor({
  hidden,
  companyId,
  meetingId,
  itemId,
  itemPosition,
  attachments,
  documents,
  visibilityLabel,
}: {
  hidden: ReactNode;
  companyId: string;
  meetingId: string;
  itemId: string;
  itemPosition: number;
  attachments: ItemAttachment[];
  documents: { id: string; title: string; category: string; created_at: string }[];
  visibilityLabel: string;
}) {
  const linked = new Set(attachments.map((a) => a.document_id));
  const choices = documents.filter((d) => !linked.has(d.id));
  const next = `Liite ${itemPosition}.${attachments.length + 1}`;
  return (
    <div className="mt-3 grid gap-3 rounded-xl border border-line bg-cloud/40 p-3">
      <p className="text-sm font-semibold">Liitteet</p>
      {attachments.length > 0 ? (
        <ul className="grid gap-1.5">
          {attachments.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span>
                <span className="font-semibold tabular-nums">{a.label}</span> {a.title ?? "–"}
                {a.visibility ? <span className="ml-2 text-xs text-ink/55">näkyy: {VISIBILITY_LABEL[a.visibility] ?? a.visibility}</span> : null}
              </span>
              <form action={removeAttachmentAction}>
                {hidden}
                <input type="hidden" name="attachment_id" value={a.id} />
                <button className="text-xs text-coral">Poista liite</button>
              </form>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-ink/55">Asialla ei ole liitteitä.</p>
      )}

      <form action="/api/kokoukset/liite" method="post" encType="multipart/form-data" className="grid gap-3 border-t border-line pt-3 sm:grid-cols-2">
        <input type="hidden" name="company_id" value={companyId} />
        <input type="hidden" name="meeting_id" value={meetingId} />
        <input type="hidden" name="item_id" value={itemId} />
        <Field label={`Lisää tiedosto (${next})`} htmlFor={`att_file_${itemId}`} hint={`PDF, kuva, XLSX tai DOCX, enintään 20 Mt. Tallentuu yhtiön dokumentteihin, näkyy: ${visibilityLabel}.`}>
          <Input id={`att_file_${itemId}`} name="file" type="file" required accept={UPLOAD_ACCEPT} />
        </Field>
        <Field label="Otsikko" htmlFor={`att_title_${itemId}`} hint="Tyhjänä tiedoston nimi.">
          <Input id={`att_title_${itemId}`} name="title" maxLength={200} />
        </Field>
        <Field label="Dokumentin luokka" htmlFor={`att_category_${itemId}`}>
          <Select id={`att_category_${itemId}`} name="category" defaultValue="other">
            {DOCUMENT_CATEGORIES.filter((c) => !["minutes", "meeting_notice", "manager_certificate", "photo"].includes(c)).map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABEL[c as DocumentCategory]}
              </option>
            ))}
          </Select>
        </Field>
        <div className="flex items-end">
          <Button variant="secondary" className="min-h-10">
            Lataa liite
          </Button>
        </div>
      </form>

      {choices.length > 0 ? (
        <form action={attachExistingDocumentAction} className="grid gap-3 border-t border-line pt-3 sm:grid-cols-[1fr_auto] sm:items-end">
          {hidden}
          <input type="hidden" name="item_id" value={itemId} />
          <Field label="Tai valitse yhtiön dokumenteista" htmlFor={`att_doc_${itemId}`}>
            <Select id={`att_doc_${itemId}`} name="document_id" required defaultValue="">
              <option value="" disabled>
                Valitse dokumentti
              </option>
              {choices.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.title} ({CATEGORY_LABEL[d.category as DocumentCategory] ?? d.category}, {formatDate(d.created_at)})
                </option>
              ))}
            </Select>
          </Field>
          <Button variant="secondary" className="min-h-10">
            Liitä
          </Button>
        </form>
      ) : null}
    </div>
  );
}
