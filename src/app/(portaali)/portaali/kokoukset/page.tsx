import { Badge, EmptyState, Panel } from "@/components/ui";
import { requirePortal } from "@/lib/auth/current-user";
import { formatDate, formatDateTime } from "@/lib/format";
import { MEETING_KIND, MEETING_STATUS } from "@/lib/meetings/labels";
import { byItem, listItemAttachments } from "@/lib/meetings/attachments";
import { listMeetings, type MeetingItemRow } from "@/lib/meetings/queries";

export const metadata = { title: "Kokoukset" };

/**
 * Portaalin kokoukset. RLS rajaa näkyvyyden: osakas näkee yhtiökokoukset
 * kutsun lähettämisen jälkeen, hallitus myös hallituksen kokoukset.
 * Dokumenteista näkyvät vain rivit, joiden näkyvyys sallii.
 */
export default async function PortalMeetingsPage() {
  const ctx = await requirePortal();
  const data = await ctx.run(async (tx) => {
    const upcoming = await listMeetings(tx, { scope: "upcoming", limit: 20 });
    const past = await listMeetings(tx, { scope: "past", limit: 20 });
    const ids = [...upcoming, ...past].map((m) => m.id);
    const docs = ids.length
      ? await tx.query<{ id: string; title: string; subject_id: string; sealed: boolean; created_at: string }>(
          `select id, title, subject_id, sealed, created_at from er_documents
            where subject_table = 'er_meetings' and subject_id = any($1::uuid[]) and category in ('meeting_notice', 'minutes')
            order by created_at desc`,
          [ids],
        )
      : [];
    const items = upcoming.length
      ? await tx.query<MeetingItemRow & { meeting_id: string }>(
          "select id, meeting_id, position, title, proposal, decision from er_meeting_items where meeting_id = any($1::uuid[]) order by position",
          [upcoming.map((m) => m.id)],
        )
      : [];
    // Pykälän liitteet: luettelo näkyy kokouksen näkijöille, tiedoston avaus noudattaa dokumentin näkyvyyttä.
    const attachments = byItem(await listItemAttachments(tx, upcoming.map((m) => m.id)));
    return { upcoming, past, docs, items, attachments };
  });

  const docsFor = (id: string) => data.docs.filter((d) => d.subject_id === id);

  return (
    <>
      <h1 className="text-2xl">Kokoukset</h1>
      <h2 className="mb-3 mt-6 text-lg">Tulevat</h2>
      {data.upcoming.length === 0 ? (
        <EmptyState title="Ei tulevia kokouksia">Kun hallitus kutsuu kokouksen koolle, kutsu ja asialista näkyvät täällä.</EmptyState>
      ) : (
        <div className="grid gap-3">
          {data.upcoming.map((m) => (
            <Panel key={m.id}>
              <p className="text-sm text-ink/60">{m.company_name}</p>
              <p className="mt-1 font-semibold">{MEETING_KIND[m.kind]}</p>
              <p className="mt-1">{formatDateTime(m.starts_at)}</p>
              <p className="text-sm text-ink/70">
                {m.location ?? "Paikka ilmoitetaan"}
                {m.remote_participation ? " · etäosallistuminen mahdollinen" : ""}
              </p>
              {m.remote_participation && m.remote_url ? (
                <a href={m.remote_url} className="mt-1 inline-block break-all text-sm text-sky" rel="noopener noreferrer">
                  Etäyhteys
                </a>
              ) : null}
              <details className="mt-3" open={new Date(m.starts_at).getTime() - Date.now() < 36 * 3600 * 1000}>
                <summary className="cursor-pointer text-sm font-semibold">Asialista</summary>
                <ol className="mt-2 grid gap-1.5 text-sm">
                  {data.items
                    .filter((i) => i.meeting_id === m.id)
                    .map((i) => (
                      <li key={i.id}>
                        {i.position}. {i.title}
                        {(data.attachments.get(i.id) ?? []).length ? (
                          <ul className="ml-5 mt-0.5 grid gap-0.5">
                            {data.attachments.get(i.id)!.map((a) => (
                              <li key={a.id}>
                                <span className="tabular-nums text-ink/60">{a.label}</span>{" "}
                                {a.title ? (
                                  <a href={`/api/dokumentit/${a.document_id}`} target="_blank" rel="noopener" className="font-semibold text-sky hover:underline">
                                    {a.title}
                                  </a>
                                ) : (
                                  <span className="text-ink/55">ei näkyvissä sinulle</span>
                                )}
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </li>
                    ))}
                </ol>
              </details>
              <DocLinks docs={docsFor(m.id)} />
            </Panel>
          ))}
        </div>
      )}

      <h2 className="mb-3 mt-8 text-lg">Pidetyt</h2>
      {data.past.length === 0 ? (
        <p className="text-sm text-ink/65">Ei pidettyjä kokouksia.</p>
      ) : (
        <div className="grid gap-3">
          {data.past.map((m) => (
            <Panel key={m.id}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm text-ink/60">{m.company_name}</p>
                  <p className="font-semibold">
                    {MEETING_KIND[m.kind]} {formatDate(m.starts_at)}
                  </p>
                </div>
                <Badge tone={m.status === "minutes_signed" ? "ok" : "neutral"}>{MEETING_STATUS[m.status]}</Badge>
              </div>
              <DocLinks docs={docsFor(m.id)} />
            </Panel>
          ))}
        </div>
      )}
    </>
  );
}

function DocLinks({ docs }: { docs: { id: string; title: string; sealed: boolean }[] }) {
  if (docs.length === 0) return null;
  return (
    <ul className="mt-3 grid gap-1 border-t border-line pt-3 text-sm">
      {docs.map((d) => (
        <li key={d.id} className="flex items-center gap-2">
          <a href={`/api/dokumentit/${d.id}`} className="font-semibold text-sky">
            {d.title}
          </a>
          {d.sealed ? <Badge tone="ok">Allekirjoitettu</Badge> : null}
        </li>
      ))}
    </ul>
  );
}
