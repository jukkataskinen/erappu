import { Button, Textarea } from "@/components/ui";
import { ATTACHMENT_ACCEPT } from "@/lib/maintenance/attachments";
import { MAX_CONTACT_ATTACHMENTS, MAX_CONTACT_BODY } from "@/lib/contacts/labels";
import type { ThreadEntry } from "@/lib/contacts/queries";
import { formatDateTime } from "@/lib/format";
import { PhotoForm } from "@/lib/service-requests/components/PhotoForm";

/**
 * Yhteydenoton viestiketju. Portaalissa henkilökunnan kirjoittajaksi näytetään
 * "Isännöinti", koska portaalikäyttäjä ei näe henkilökunnan käyttäjätietoja.
 */
export function ThreadView({ entries, viewer }: { entries: ThreadEntry[]; viewer: "portal" | "staff" }) {
  return (
    <ol className="grid gap-3">
      {entries.map((e) => {
        const mine = viewer === "portal" ? !e.fromStaff : e.fromStaff;
        const author = e.fromStaff ? (viewer === "portal" ? "Isännöinti" : (e.authorName ?? "Henkilökunta")) : viewer === "portal" ? "Sinä" : (e.authorName ?? "Kysyjä");
        return (
          <li key={`${e.type}-${e.id}`} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[42rem] rounded-2xl border px-4 py-3 ${mine ? "border-sky/20 bg-sky-soft" : "border-line bg-paper"}`}>
              <p className="text-xs text-ink/55">
                <span className="font-semibold text-ink/75">{author}</span> · {formatDateTime(e.at)}
              </p>
              {e.type === "message" ? (
                <p className="mt-1 whitespace-pre-wrap break-words">{e.body}</p>
              ) : (
                <a href={`/api/dokumentit/${e.id}`} target="_blank" rel="noopener" className="mt-1 inline-flex items-center gap-1 font-semibold text-sky hover:underline">
                  Liite: {e.fileName}
                </a>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** Vastauslomake liitteineen. Kuvat pienennetään selaimessa ennen lähetystä. */
export function ReplyForm({
  action,
  threadId,
  label,
  hint,
  submitLabel = "Lähetä viesti",
}: {
  action: (formData: FormData) => Promise<void>;
  threadId: string;
  label: string;
  hint?: string;
  submitLabel?: string;
}) {
  return (
    <PhotoForm action={action} field="attachments" className="grid gap-3">
      <input type="hidden" name="thread_id" value={threadId} />
      <label htmlFor="reply-body" className="text-sm font-semibold">
        {label}
      </label>
      <Textarea id="reply-body" name="body" required maxLength={MAX_CONTACT_BODY} rows={4} />
      {hint ? <p className="text-xs text-ink/55">{hint}</p> : null}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="reply-attachments" className="text-sm font-semibold">
          Liitteet (valinnainen)
        </label>
        <input
          id="reply-attachments"
          name="attachments"
          type="file"
          accept={ATTACHMENT_ACCEPT}
          multiple
          className="block w-full rounded-xl border border-dashed border-line bg-paper px-3.5 py-3 text-sm file:mr-3 file:rounded-full file:border-0 file:bg-cloud file:px-4 file:py-2 file:font-semibold"
        />
        <p className="text-xs text-ink/55">Enintään {MAX_CONTACT_ATTACHMENTS} liitettä: PDF, kuva, Word tai Excel. Kuvista poistetaan sijaintitieto.</p>
      </div>
      <div>
        <Button type="submit" className="w-full sm:w-auto">
          {submitLabel}
        </Button>
      </div>
    </PhotoForm>
  );
}
