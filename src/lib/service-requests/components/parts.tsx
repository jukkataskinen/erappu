import { Badge } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import {
  EVENT_TYPE_LABEL, STATUS_LABEL, STATUS_TONE, URGENCY_LABEL, URGENCY_TONE, VISIBILITY_LABEL,
  type EventVisibility, type RequestStatus, type Urgency,
} from "../labels";

export function StatusBadge({ status }: { status: RequestStatus }) {
  return <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>;
}

export function UrgencyBadge({ urgency, hideNormal = true }: { urgency: Urgency; hideNormal?: boolean }) {
  if (hideNormal && urgency === "normal") return null;
  return <Badge tone={URGENCY_TONE[urgency]}>{URGENCY_LABEL[urgency]}</Badge>;
}

export interface TimelineEvent {
  id: string;
  type: string;
  body: string | null;
  old_status: RequestStatus | null;
  new_status: RequestStatus | null;
  visibility?: EventVisibility;
  provider_actor: boolean;
  actor_name?: string | null;
  document_id?: string | null;
  created_at: string | Date;
}

/** Tapahtumahistoria vanhimmasta uusimpaan. */
export function Timeline({
  events,
  photoHref,
  showVisibility = false,
}: {
  events: TimelineEvent[];
  photoHref?: (documentId: string) => string;
  showVisibility?: boolean;
}) {
  if (events.length === 0) return <p className="text-sm text-ink/60">Ei tapahtumia.</p>;
  return (
    <ol className="relative grid gap-4 border-l border-line pl-5">
      {events.map((e) => {
        const title =
          e.type === "status_change"
            ? e.old_status
              ? `${STATUS_LABEL[e.old_status]} → ${e.new_status ? STATUS_LABEL[e.new_status] : ""}`
              : "Pyyntö luotu"
            : EVENT_TYPE_LABEL[e.type] ?? e.type;
        return (
          <li key={e.id} className="relative">
            <span className="absolute -left-[1.6rem] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-paper bg-ink/40" aria-hidden />
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
              <span className="font-semibold">{title}</span>
              {e.actor_name ? <span className="text-ink/60">{e.actor_name}</span> : null}
              <span className="text-xs text-ink/50">{formatDateTime(e.created_at)}</span>
              {showVisibility && e.visibility ? (
                <Badge tone={e.visibility === "internal" ? "neutral" : "info"}>{VISIBILITY_LABEL[e.visibility]}</Badge>
              ) : null}
            </div>
            {e.body ? <p className="mt-1 whitespace-pre-wrap break-words text-sm text-ink/85">{e.body}</p> : null}
            {e.type === "attachment" && e.document_id && photoHref ? (
              <a href={photoHref(e.document_id)} target="_blank" rel="noreferrer" className="mt-2 inline-block">
                {/* eslint-disable-next-line @next/next/no-img-element -- yksityinen kuva reitin kautta, ei Nextin kuvaoptimointia */}
                <img src={photoHref(e.document_id)} alt="Huoltopyynnön kuva" className="h-28 w-28 rounded-lg border border-line object-cover" loading="lazy" />
              </a>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

export function PhotoGrid({ ids, href }: { ids: string[]; href: (id: string) => string }) {
  if (ids.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {ids.map((id) => (
        <a key={id} href={href(id)} target="_blank" rel="noreferrer">
          {/* eslint-disable-next-line @next/next/no-img-element -- yksityinen kuva reitin kautta */}
          <img src={href(id)} alt="Huoltopyynnön kuva" className="h-24 w-24 rounded-lg border border-line object-cover" loading="lazy" />
        </a>
      ))}
    </div>
  );
}

export function YesNo({ value }: { value: boolean }) {
  return <>{value ? "Kyllä" : "Ei"}</>;
}
