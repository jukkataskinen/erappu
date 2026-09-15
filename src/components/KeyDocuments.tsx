import Link from "next/link";
import { KEY_DOCUMENT_CATEGORIES, type KeyCategory, type KeyDocument } from "@/lib/documents/key-documents";

/**
 * Perusdokumenttien pikalinkit. "Avaa" näyttää PDF:n selaimessa, "Lataa"
 * tallentaa tiedoston (esim. isännöitsijäntodistuksen liitteeksi).
 */
export function KeyDocumentLinks({ companyId, docs, compact }: { companyId: string; docs: Partial<Record<KeyCategory, KeyDocument>>; compact?: boolean }) {
  const items = compact ? KEY_DOCUMENT_CATEGORIES.filter((c) => c.category === "articles" || c.category === "financial_statement" || c.category === "energy_certificate") : KEY_DOCUMENT_CATEGORIES;
  return (
    <ul className={compact ? "flex flex-wrap gap-x-3 gap-y-1 text-xs" : "divide-y divide-line"}>
      {items.map(({ category, label }) => {
        const doc = docs[category];
        if (compact) {
          return doc ? (
            <li key={category}>
              <a href={`/api/dokumentit/${doc.id}?lataa=1`} className="font-semibold text-sky">
                {label}
                {doc.year ? ` ${doc.year}` : ""}
              </a>
            </li>
          ) : (
            <li key={category} className="text-ink/40">
              {label} puuttuu
            </li>
          );
        }
        return (
          <li key={category} className="flex items-center justify-between gap-3 py-2">
            <span className={doc ? "font-semibold" : "text-ink/55"}>
              {label}
              {doc?.year ? <span className="font-normal text-ink/55"> {doc.year}</span> : null}
            </span>
            {doc ? (
              <span className="flex gap-3 text-sm">
                <a href={`/api/dokumentit/${doc.id}`} target="_blank" rel="noopener" className="text-sky">
                  Avaa
                </a>
                <a href={`/api/dokumentit/${doc.id}?lataa=1`} className="text-sky">
                  Lataa
                </a>
              </span>
            ) : (
              <Link href={`/taloyhtiot/${companyId}/dokumentit`} className="text-sm text-coral">
                Lisää
              </Link>
            )}
          </li>
        );
      })}
    </ul>
  );
}
