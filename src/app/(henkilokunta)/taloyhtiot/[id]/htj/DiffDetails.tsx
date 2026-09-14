import { formatDate, formatFraction, formatNumber } from "@/lib/format";
import { shareGroupChanges, type OwnershipSnapshot, type ShareGroupSnapshot } from "@/lib/htj/diff";
import type { DiffRowView } from "@/lib/htj/queries";
import { formatRanges } from "@/lib/registry/share-ranges";
import { SHARE_GROUP_KIND } from "@/lib/registry/labels";

const FIELD_LABEL: Record<string, string> = {
  unitLabel: "Tunnus",
  kind: "Tyyppi",
  areaM2: "Pinta-ala",
  intendedUse: "Käyttötarkoitus",
  layout: "Huoneistotyyppi",
  floor: "Kerros",
  ranges: "Osakkeet",
};

function fieldValue(s: ShareGroupSnapshot, field: string): string {
  switch (field) {
    case "kind":
      return SHARE_GROUP_KIND[s.kind] ?? s.kind;
    case "areaM2":
      return formatNumber(s.areaM2, "m²");
    case "ranges":
      return s.ranges.length ? formatRanges(s.ranges) : "–";
    default:
      return String((s as unknown as Record<string, unknown>)[field] ?? "–");
  }
}

/** Eron sisältö: osakeryhmästä muuttuvat kentät, omistuksesta osuus ja alkupäivä. */
export function DiffDetails({ diff }: { diff: DiffRowView }) {
  if (diff.entity === "share_group") {
    const before = diff.before as ShareGroupSnapshot | null;
    const after = diff.after as ShareGroupSnapshot | null;
    if (before && after) {
      const fields = shareGroupChanges(before, after);
      if (fields.length === 0) return <span className="text-ink/55">Ei muutoksia tietoihin.</span>;
      return (
        <ul className="text-xs text-ink/70">
          {fields.map((f) => (
            <li key={f}>
              {FIELD_LABEL[f] ?? f}: <span className="line-through">{fieldValue(before, f)}</span> → <span className="font-semibold text-ink">{fieldValue(after, f)}</span>
            </li>
          ))}
        </ul>
      );
    }
    const s = (after ?? before)!;
    return (
      <span className="text-xs text-ink/70">
        {SHARE_GROUP_KIND[s.kind] ?? s.kind} · {formatNumber(s.areaM2, "m²")} · osakkeet {s.ranges.length ? formatRanges(s.ranges) : "–"}
      </span>
    );
  }
  const o = (diff.after ?? diff.before) as OwnershipSnapshot;
  return (
    <span className="text-xs text-ink/70">
      Osuus {formatFraction(o.numerator, o.denominator)}
      {o.startsOn ? ` · alkaen ${formatDate(o.startsOn)}` : ""}
      {o.kind === "company" ? " · yhteisö" : ""}
      {o.protected ? " · turvakielto, osoitetta ei tallenneta" : ""}
    </span>
  );
}
