import Link from "next/link";
import { notFound } from "next/navigation";
import { CompanyHeader, loadCompany } from "@/components/CompanyHeader";
import { FormError } from "@/components/FormError";
import { Badge, Button, EmptyState, Field, Input, Notice, Panel, Select, SectionTitle, Table, Td, Textarea, Th } from "@/components/ui";
import { requireStaff } from "@/lib/auth/current-user";
import { canSimulateSigning, isUsingMockEsinetti } from "@/lib/esinetti";
import { formatDate, formatDateTime, formatNumber } from "@/lib/format";
import { ATTACHMENTS_EDITABLE, attachmentVisibility, byItem, listAttachableDocuments, listItemAttachments } from "@/lib/meetings/attachments";
import { buildVoteSummary } from "@/lib/meetings/documents";
import { resolveGoverningAct } from "@/lib/meetings/governing-act";
import { isGeneralMeeting, MEETING_KIND, MEETING_STATUS, MEETING_STATUS_TONE, SIGNING_STATUS } from "@/lib/meetings/labels";
import { splitNoticeRecipients } from "@/lib/meetings/notice";
import { getMeeting, listAttendees, listItems, listMeetingDocuments, listSigningRounds } from "@/lib/meetings/queries";
import { listNoticeParties } from "@/lib/meetings/send-notice";
import { noticeWindow } from "@/lib/meetings/templates";
import { isoToHelsinkiLocal } from "@/lib/meetings/time";
import { BOARD_ROLE } from "@/lib/registry/labels";
import { VISIBILITY_LABEL } from "@/lib/documents/labels";
import { AttachmentLinks, ItemAttachmentEditor } from "./ItemAttachments";
import { listMinutesSignerChanges, loadMinutesSignerPlan } from "@/lib/meetings/minutes-signers";
import { attendanceItemPosition } from "@/lib/meetings/labels";
import { BoardAttendance } from "./BoardAttendance";
import { LetterJobs } from "@/components/letters/LetterJobs";
import { LETTER_FLASH } from "@/lib/letters/labels";
import { planMeetingLetters } from "@/lib/letters/meeting";
import { isUsingMockPostita } from "@/lib/postita";
import {
  addAttendeeAction,
  addItemAction,
  deleteAttendeeAction,
  deleteItemAction,
  deleteMeetingDocumentAction,
  moveItemAction,
  prefillAttendeesAction,
  saveAttendeesAction,
  sendForSigningAction,
  sendNoticeAction,
  setMeetingStatusAction,
  simulateSigningAction,
  updateItemAction,
  updateMeetingAction,
  uploadMeetingLettersAction,
} from "../../../../kokoukset/actions";

export const metadata = { title: "Kokous" };

/** "Vie isännöitsijän tehtävälistalle" ja vapaaehtoinen määräpäivä (oletus kaksi viikkoa kokouksesta). */
function TaskToggle({ idSuffix }: { idSuffix: string }) {
  return (
    <div className="grid gap-2 rounded-xl border border-line bg-cloud/40 p-3 sm:grid-cols-[1fr_auto] sm:items-end">
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="to_task" className="mt-0.5 h-5 w-5" />
        <span>
          <span className="font-semibold">Vie isännöitsijän tehtävälistalle</span>
          <span className="block text-xs text-ink/55">Tehtävä tulee yhtiön vuosikelloon isännöitsijälle. Määräpäivä on oletuksena kaksi viikkoa kokouksen jälkeen.</span>
        </span>
      </label>
      <Field label="Määräpäivä" htmlFor={`task_due_on_${idSuffix}`}>
        <Input id={`task_due_on_${idSuffix}`} name="task_due_on" type="date" />
      </Field>
    </div>
  );
}

/** Esikatselu ei tallenna mitään (esikatselu/route.ts). */
const DOC_BUTTONS = [
  { kind: "notice", label: "Kokouskutsu", generalOnly: false },
  { kind: "agenda", label: "Esityslista", generalOnly: false },
  { kind: "shareholders", label: "Osakasluettelo", generalOnly: true },
  { kind: "votes", label: "Ääniluettelo", generalOnly: true },
  { kind: "minutes", label: "Pöytäkirja", generalOnly: false },
] as const;

const VISIBILITY: Record<string, string> = { internal: "Sisäinen", board: "Hallitus", owners: "Osakkaat", residents: "Asukkaat" };

export default async function MeetingPage({ params, searchParams }: { params: Promise<{ id: string; mid: string }>; searchParams: Promise<{ virhe?: string; asiakirja?: string; esikatselu?: string; kirjeet?: string }> }) {
  const ctx = await requireStaff();
  const { id, mid } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(mid)) notFound();
  const company = await loadCompany(ctx, id);
  const { virhe, asiakirja, esikatselu, kirjeet } = await searchParams;

  const data = await ctx.run(async (tx) => {
    const meeting = await getMeeting(tx, mid);
    if (!meeting || meeting.company_id !== id) return null;
    const [items, attendees, documents, rounds, parties, attachments, attachable, signerPlan, attendeeEmails, signerChanges, letterPlan] = await Promise.all([
      listItems(tx, mid),
      listAttendees(tx, mid),
      listMeetingDocuments(tx, mid),
      listSigningRounds(tx, "er_meetings", mid),
      listNoticeParties(tx, id, meeting.kind),
      listItemAttachments(tx, mid),
      listAttachableDocuments(tx, id),
      loadMinutesSignerPlan(tx, mid),
      tx.query<{ id: string; email: string | null }>("select a.id, p.email from er_meeting_attendees a left join er_parties p on p.id = a.party_id where a.meeting_id = $1", [mid]),
      listMinutesSignerChanges(tx, mid),
      planMeetingLetters(tx, mid),
    ]);
    return { meeting, items, attendees, documents, rounds, parties, attachments, attachable, signerPlan, attendeeEmails, signerChanges, letterPlan };
  });
  if (!data) notFound();

  const { meeting, items, attendees, documents, rounds, parties, attachments, attachable, signerPlan, attendeeEmails, signerChanges, letterPlan } = data;
  const emailById = new Map(attendeeEmails.map((a) => [a.id, a.email]));
  const attendancePos = attendanceItemPosition(items);
  const attachmentsByItem = byItem(attachments);
  const attachmentsEditable = ctx.can("owner", "manager", "assistant") && (ATTACHMENTS_EDITABLE as readonly string[]).includes(meeting.status);
  const attachmentVisibilityLabel = VISIBILITY_LABEL[attachmentVisibility(meeting.kind)];
  const general = isGeneralMeeting(meeting.kind);
  const canWrite = ctx.can("owner", "manager", "assistant");
  const local = isoToHelsinkiLocal(meeting.starts_at);
  const act = resolveGoverningAct(company.company_form, company.governing_act);
  const summary = buildVoteSummary(attendees, act);
  const votesById = new Map(summary.voters.map((v) => [v.id, v]));
  const recipients = splitNoticeRecipients(parties, general);
  // Kutsuaika: AOYL 6:20 § viimeistään kaksi viikkoa, OYL 5:19 § viimeistään viikkoa ennen.
  const noticeDates = noticeWindow(new Date(meeting.starts_at).toISOString(), act === "oyl" ? 7 : 14);
  const canDeleteDocs = ctx.can("owner", "manager");
  const roundDocIds = new Set(rounds.flatMap((r) => [r.original_document_id, r.sealed_document_id].filter((x): x is string => !!x)));
  const activeRound = rounds.find((r) => ["draft", "sent", "partially_signed"].includes(r.status));
  const checkers = meeting.minutes_checkers ?? [];
  const hidden = (
    <>
      <input type="hidden" name="company_id" value={id} />
      <input type="hidden" name="meeting_id" value={mid} />
    </>
  );

  return (
    <>
      <CompanyHeader company={company} active="kokoukset" sub="Kokous" />
      <FormError message={virhe} />

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href={`/taloyhtiot/${id}/kokoukset`} className="text-sm text-ink/60 hover:text-ink">
            ← Kokoukset
          </Link>
          <h2 className="mt-1 text-xl">
            {MEETING_KIND[meeting.kind]} {formatDateTime(meeting.starts_at)}
          </h2>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-ink/65">
            <Badge tone={MEETING_STATUS_TONE[meeting.status]}>{MEETING_STATUS[meeting.status]}</Badge>
            {meeting.notice_sent_at ? <span>Kutsu lähetetty {formatDate(meeting.notice_sent_at)}</span> : null}
          </div>
        </div>
        {canWrite ? (
          <div className="flex flex-wrap gap-2">
            {meeting.status === "draft" || meeting.status === "notice_sent" ? (
              <form action={setMeetingStatusAction}>
                {hidden}
                <input type="hidden" name="status" value="held" />
                <Button variant="secondary">Merkitse pidetyksi</Button>
              </form>
            ) : null}
            {["draft", "notice_sent", "held"].includes(meeting.status) ? (
              <form action={setMeetingStatusAction}>
                {hidden}
                <input type="hidden" name="status" value="cancelled" />
                <Button variant="ghost">Peru kokous</Button>
              </form>
            ) : null}
            {meeting.status === "cancelled" ? (
              <form action={setMeetingStatusAction}>
                {hidden}
                <input type="hidden" name="status" value="draft" />
                <Button variant="secondary">Palauta luonnokseksi</Button>
              </form>
            ) : null}
          </div>
        ) : null}
      </div>


      <div className="grid gap-6 xl:grid-cols-[1.6fr_1fr]">
        <div className="grid content-start gap-6">
          <Panel>
            <SectionTitle>Perustiedot</SectionTitle>
            <form action={updateMeetingAction} className="grid gap-4">
              {hidden}
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Päivä" htmlFor="date">
                  <Input id="date" name="date" type="date" required defaultValue={local.date} disabled={!canWrite} />
                </Field>
                <Field label="Kello" htmlFor="time">
                  <Input id="time" name="time" type="time" required defaultValue={local.time} disabled={!canWrite} />
                </Field>
                <Field label="Tilikausi" htmlFor="fiscal_year">
                  <Input id="fiscal_year" name="fiscal_year" defaultValue={meeting.fiscal_year ?? ""} disabled={!canWrite} />
                </Field>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Paikka" htmlFor="location">
                  <Input id="location" name="location" defaultValue={meeting.location ?? ""} disabled={!canWrite} />
                </Field>
                <Field label="Etäyhteyden osoite" htmlFor="remote_url">
                  <Input id="remote_url" name="remote_url" type="url" defaultValue={meeting.remote_url ?? ""} disabled={!canWrite} />
                </Field>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="remote_participation" defaultChecked={meeting.remote_participation} disabled={!canWrite} /> Etäosallistuminen mahdollinen
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Puheenjohtaja" htmlFor="chair_name">
                  <Input id="chair_name" name="chair_name" defaultValue={meeting.chair_name ?? ""} disabled={!canWrite} />
                </Field>
                <Field label="Puheenjohtajan sähköposti" htmlFor="chair_email" hint="Allekirjoituskutsua varten">
                  <Input id="chair_email" name="chair_email" type="email" defaultValue={meeting.chair_email ?? ""} disabled={!canWrite} />
                </Field>
                <Field label="Sihteeri" htmlFor="secretary_name">
                  <Input id="secretary_name" name="secretary_name" defaultValue={meeting.secretary_name ?? ""} disabled={!canWrite} />
                </Field>
                <div />
                {general || (attendees.length === 0 && signerPlan?.rule !== "all_present") ? (
                  <>
                    {[1, 2].map((n) => (
                      <div key={n} className="contents">
                        <Field label={`Pöytäkirjantarkastaja ${n}`} htmlFor={`checker${n}_name`}>
                          <Input id={`checker${n}_name`} name={`checker${n}_name`} defaultValue={checkers[n - 1]?.name ?? ""} disabled={!canWrite} />
                        </Field>
                        <Field label="Sähköposti" htmlFor={`checker${n}_email`}>
                          <Input id={`checker${n}_email`} name={`checker${n}_email`} type="email" defaultValue={checkers[n - 1]?.email ?? ""} disabled={!canWrite} />
                        </Field>
                      </div>
                    ))}
                  </>
                ) : signerPlan?.rule === "all_present" ? (
                  <div className="rounded-xl bg-cloud/60 p-3 text-sm sm:col-span-2">
                    <p className="font-semibold">Pöytäkirjan allekirjoittavat kaikki läsnä olleet (yhtiöjärjestys)</p>
                    <p className="mt-0.5 text-ink/70">
                      {signerPlan.signers.length ? signerPlan.signers.map((s) => s.name).join(", ") : "Ei vielä osallistujia."}
                      {attendancePos ? ` Läsnäolot merkitään kohdassa ${attendancePos} §.` : ""}
                    </p>
                  </div>
                ) : (
                  <Field label="Hallituksen valitsema jäsen" htmlFor="checker_attendee_id" hint="Allekirjoittaa pöytäkirjan puheenjohtajan kanssa. Sähköposti tulee rekisteristä.">
                    <Select id="checker_attendee_id" name="checker_attendee_id" disabled={!canWrite} defaultValue={attendees.find((a) => checkers[0]?.email && emailById.get(a.id)?.toLowerCase() === checkers[0].email.toLowerCase())?.id ?? ""}>
                      <option value="">Valitse</option>
                      {attendees.map((a) => (
                        <option key={a.id} value={a.id} disabled={!emailById.get(a.id)}>
                          {a.display_name}
                          {emailById.get(a.id) ? "" : " (sähköposti puuttuu)"}
                        </option>
                      ))}
                    </Select>
                  </Field>
                )}
              </div>
              <Field label="Muistiinpanot (sisäinen)" htmlFor="notes">
                <Textarea id="notes" name="notes" defaultValue={meeting.notes ?? ""} disabled={!canWrite} />
              </Field>
              {canWrite ? (
                <div>
                  <Button variant="secondary">Tallenna</Button>
                </div>
              ) : null}
            </form>
          </Panel>

          <Panel id="asiat">
            <SectionTitle>Asialista</SectionTitle>
            {items.length === 0 ? <p className="mb-4 text-sm text-ink/65">Asialistalla ei ole asioita.</p> : null}
            <ol className="grid gap-2">
              {items.map((item, index) => (
                <li key={item.id} className="rounded-xl border border-line p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold">
                        {item.position} § {item.title}
                      </p>
                      {item.proposal ? <p className="mt-0.5 text-sm text-ink/65">{item.proposal}</p> : null}
                      {item.decision ? (
                        <p className="mt-1 text-sm">
                          <span className="font-semibold">Päätös:</span> {item.decision}
                        </p>
                      ) : null}
                      <AttachmentLinks attachments={attachmentsByItem.get(item.id) ?? []} />
                      {item.position === attendancePos && general ? (
                        <a href="#osallistujat" className="mt-1 inline-block text-xs font-semibold text-sky hover:underline">
                          Läsnäolijat ja ääniluettelo: läsnä {attendees.filter((a) => a.present).length}/{attendees.length}
                        </a>
                      ) : null}
                      {item.position === attendancePos && !general ? (
                        <BoardAttendance
                          hidden={hidden}
                          attendees={attendees}
                          canWrite={canWrite}
                          signersNote={signerPlan?.rule === "all_present" ? "Yhtiöjärjestyksen mukaan pöytäkirjan allekirjoittavat kaikki läsnä olleet." : null}
                        />
                      ) : null}
                      {item.task_id ? (
                        <Link href={`/taloyhtiot/${id}/vuosikello`} className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-sky hover:underline">
                          {item.task_done ? "Tehtävä kuitattu" : `Isännöitsijän tehtävälistalla, määräpäivä ${formatDate(item.task_due_on)}`}
                        </Link>
                      ) : null}
                    </div>
                    {canWrite ? (
                      <div className="flex shrink-0 gap-1">
                        <form action={moveItemAction}>
                          {hidden}
                          <input type="hidden" name="item_id" value={item.id} />
                          <input type="hidden" name="direction" value="up" />
                          <button className="rounded-full px-2 py-1 text-sm text-ink/60 hover:text-ink disabled:opacity-30" disabled={index === 0} aria-label="Siirrä ylös">
                            ↑
                          </button>
                        </form>
                        <form action={moveItemAction}>
                          {hidden}
                          <input type="hidden" name="item_id" value={item.id} />
                          <input type="hidden" name="direction" value="down" />
                          <button className="rounded-full px-2 py-1 text-sm text-ink/60 hover:text-ink disabled:opacity-30" disabled={index === items.length - 1} aria-label="Siirrä alas">
                            ↓
                          </button>
                        </form>
                      </div>
                    ) : null}
                  </div>
                  {canWrite ? (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-xs font-semibold text-sky">Muokkaa esitystä, päätöstä ja liitteitä</summary>
                      <form action={updateItemAction} className="mt-3 grid gap-3">
                        {hidden}
                        <input type="hidden" name="item_id" value={item.id} />
                        <Field label="Otsikko" htmlFor={`title_${item.id}`}>
                          <Input id={`title_${item.id}`} name="title" required defaultValue={item.title} />
                        </Field>
                        <Field label="Esitys" htmlFor={`proposal_${item.id}`}>
                          <Textarea id={`proposal_${item.id}`} name="proposal" defaultValue={item.proposal ?? ""} />
                        </Field>
                        <Field label="Päätös" htmlFor={`decision_${item.id}`}>
                          <Textarea id={`decision_${item.id}`} name="decision" defaultValue={item.decision ?? ""} />
                        </Field>
                        {item.task_id ? null : <TaskToggle idSuffix={item.id} />}
                        <div className="flex gap-2">
                          <Button variant="secondary">Tallenna</Button>
                        </div>
                      </form>
                      {attachmentsEditable ? (
                        <ItemAttachmentEditor
                          hidden={hidden}
                          companyId={id}
                          meetingId={mid}
                          itemId={item.id}
                          itemPosition={item.position}
                          attachments={attachmentsByItem.get(item.id) ?? []}
                          documents={attachable}
                          visibilityLabel={attachmentVisibilityLabel}
                        />
                      ) : null}
                      <form action={deleteItemAction} className="mt-2">
                        {hidden}
                        <input type="hidden" name="item_id" value={item.id} />
                        <button className="text-xs text-coral">Poista asia</button>
                      </form>
                    </details>
                  ) : null}
                </li>
              ))}
            </ol>
            {canWrite ? (
              <form action={addItemAction} className="mt-4 grid gap-3 border-t border-line pt-4">
                {hidden}
                <Field label="Uusi asia" htmlFor="new_title">
                  <Input id="new_title" name="title" required placeholder="Otsikko" />
                </Field>
                <Field label="Esitys" htmlFor="new_proposal">
                  <Textarea id="new_proposal" name="proposal" />
                </Field>
                <TaskToggle idSuffix="new" />
                <div>
                  <Button variant="secondary">Lisää asia</Button>
                </div>
              </form>
            ) : null}
          </Panel>

          {!general && attendancePos !== null ? null : (
          <Panel id="osallistujat">
            <SectionTitle
              actions={
                canWrite ? (
                  <form action={prefillAttendeesAction}>
                    {hidden}
                    <Button variant="secondary" className="min-h-9 px-4 text-xs">
                      {attendees.length ? "Esitäytä uudelleen" : general ? "Esitäytä osakasluettelosta" : "Esitäytä hallituksesta"}
                    </Button>
                  </form>
                ) : null
              }
            >
              {general ? "Osallistujat ja ääniluettelo" : "Osallistujat"}
            </SectionTitle>
            {general ? (
              <p className="mb-3 text-sm text-ink/65">
                Edustettuna {formatNumber(summary.representedShares)} osaketta · äänet leikkurin jälkeen {formatNumber(summary.totalVotes)}
                {summary.cap !== null ? ` · enimmäisäänimäärä ${formatNumber(summary.cap)} (1/5, AOYL 6:13 §)` : ""}
              </p>
            ) : null}
            {attendees.length === 0 ? (
              <EmptyState title="Osallistujia ei ole">Esitäyttö hakee {general ? "osakkaat osakasluettelosta" : "hallituksen jäsenet"}. Esitäytä uudelleen ennen kokousta, jos omistukset ovat muuttuneet.</EmptyState>
            ) : (
              <form action={saveAttendeesAction}>
                {hidden}
                <Table>
                  <thead>
                    <tr>
                      <Th>Nimi</Th>
                      {general ? <Th>Huoneistot</Th> : null}
                      <Th>Läsnä</Th>
                      <Th>Etänä</Th>
                      <Th>Asiamies (valtakirja)</Th>
                      {general ? <Th numeric>Osakkeet</Th> : null}
                      {general ? <Th numeric>Äänet</Th> : null}
                      <Th />
                    </tr>
                  </thead>
                  <tbody>
                    {attendees.map((a) => {
                      const v = votesById.get(a.id);
                      return (
                        <tr key={a.id}>
                          <Td className="font-semibold">
                            <input type="hidden" name="attendee_id" value={a.id} />
                            {a.display_name}
                          </Td>
                          {general ? <Td>{a.unit_labels ?? "–"}</Td> : null}
                          <Td>
                            <input type="checkbox" name={`present_${a.id}`} defaultChecked={a.present} disabled={!canWrite} aria-label="Läsnä" />
                          </Td>
                          <Td>
                            <input type="checkbox" name={`remote_${a.id}`} defaultChecked={a.remote} disabled={!canWrite} aria-label="Etänä" />
                          </Td>
                          <Td>
                            <Input name={`proxy_${a.id}`} defaultValue={a.proxy_name ?? ""} className="min-h-9 text-sm" disabled={!canWrite} aria-label="Asiamies" />
                          </Td>
                          {general ? (
                            <Td numeric>
                              <Input name={`shares_${a.id}`} type="number" min={0} defaultValue={a.shares} className="min-h-9 w-24 text-right text-sm" disabled={!canWrite} aria-label="Osakkeet" />
                            </Td>
                          ) : (
                            <input type="hidden" name={`shares_${a.id}`} value={a.shares} />
                          )}
                          {general ? (
                            <Td numeric>
                              {v?.present ? formatNumber(v.votes) : "–"}
                              {v?.capped ? <span className="ml-1 text-xs text-amber">rajattu</span> : null}
                            </Td>
                          ) : null}
                          <Td>
                            {canWrite ? (
                              <button formAction={deleteAttendeeAction} name="delete_attendee_id" value={a.id} className="text-xs text-coral">
                                Poista
                              </button>
                            ) : null}
                          </Td>
                        </tr>
                      );
                    })}
                  </tbody>
                </Table>
                {canWrite ? (
                  <div className="mt-3">
                    <Button variant="secondary">Tallenna läsnäolot</Button>
                  </div>
                ) : null}
              </form>
            )}
            {canWrite ? (
              <form action={addAttendeeAction} className="mt-4 flex flex-wrap items-end gap-3 border-t border-line pt-4">
                {hidden}
                <Field label="Lisää osallistuja" htmlFor="display_name">
                  <Input id="display_name" name="display_name" required placeholder="Nimi" />
                </Field>
                {general ? (
                  <Field label="Osakkeet" htmlFor="new_shares">
                    <Input id="new_shares" name="shares" type="number" min={0} defaultValue={0} className="w-28" />
                  </Field>
                ) : null}
                <Button variant="secondary">Lisää</Button>
              </form>
            ) : null}
          </Panel>
          )}

          <Panel id="kutsu">
            <SectionTitle>Kokouskutsu</SectionTitle>
            {general ? (
              <p className="mb-3 text-sm text-ink/65">
                Kutsu toimitetaan aikaisintaan {formatDate(noticeDates.earliest)} ja viimeistään {formatDate(noticeDates.latest)}, ellei yhtiöjärjestyksessä määrätä toisin.
              </p>
            ) : null}
            <p className="text-sm">
              Sähköpostilla: <span className="font-semibold">{recipients.electronic.length}</span> · paperikutsu: <span className="font-semibold">{recipients.paper.length}</span>
            </p>
            {meeting.status === "draft" && canWrite ? (
              <form action={sendNoticeAction} className="mt-4">
                {hidden}
                <Button disabled={items.length === 0}>Lähetä kutsu</Button>
                <p className="mt-2 text-xs text-ink/55">Kutsu tallennetaan dokumentteihin ({general ? "osakkaille" : "hallitukselle"} näkyväksi), sähköpostit lähtevät jonosta ja kokous merkitään kutsutuksi. Paperikutsut lähetetään sen jälkeen kirjeinä tältä sivulta.</p>
              </form>
            ) : null}
            {recipients.paper.length > 0 ? (
              <details className="mt-4" open={meeting.status === "notice_sent"}>
                <summary className="cursor-pointer text-sm font-semibold">Tarvitsee paperikutsun ({recipients.paper.length})</summary>
                <p className="mt-2 text-xs text-ink/55">
                  Näillä {general ? "osakkailla" : "jäsenillä"} ei ole sähköpostiosoitetta{general ? " tai suostumusta sähköiseen kutsuun" : ""}. Kutsu lähetetään kirjeenä Postitan kautta: kirjeen etusivulla on
                  osoite ja sen perässä lähetetty kokouskutsu liitteineen.
                </p>
                <div className="mt-2">
                  <Table>
                    <thead>
                      <tr>
                        <Th>Nimi</Th>
                        <Th>Postiosoite</Th>
                        <Th>{general ? "Huoneistot" : "Rooli"}</Th>
                        <Th>Kirje</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {(letterPlan?.paper ?? []).map(({ party: p, addressLines, letter }) => (
                        <tr key={p.party_id}>
                          <Td className="font-semibold">{p.display_name}</Td>
                          <Td>{addressLines ? addressLines.slice(1).join(", ") : <span className="text-coral">Osoite puutteellinen</span>}</Td>
                          <Td>{general ? p.unit_labels : p.unit_labels.split(", ").map((r) => BOARD_ROLE[r] ?? r).join(", ")}</Td>
                          <Td>
                            {letter ? (
                              <Badge tone={letter.status === "confirmed" ? "ok" : "warn"}>{letter.status === "confirmed" ? "Postitus vahvistettu" : "Odottaa vahvistusta"}</Badge>
                            ) : addressLines ? (
                              <span className="text-ink/55">Ei lähetetty</span>
                            ) : (
                              <span className="text-coral">Täydennä osoite rekisteriin</span>
                            )}
                          </Td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </div>
                {kirjeet && LETTER_FLASH[kirjeet] ? (
                  <div className="mt-3">
                    <Notice tone="ok">{LETTER_FLASH[kirjeet]}</Notice>
                  </div>
                ) : null}
                {letterPlan ? (
                  <LetterJobs
                    jobs={letterPlan.jobs}
                    readyCount={letterPlan.ready.length}
                    blocker={letterPlan.blocker}
                    canManage={ctx.can("owner", "manager")}
                    back={`/taloyhtiot/${id}/kokoukset/${mid}`}
                    uploadAction={uploadMeetingLettersAction}
                    hidden={{ company_id: id, meeting_id: mid }}
                    previewHref={`/taloyhtiot/${id}/kokoukset/${mid}/kirjeet`}
                    mock={isUsingMockPostita()}
                  />
                ) : null}
              </details>
            ) : null}
          </Panel>

          <Panel id="allekirjoitus">
            <SectionTitle>Pöytäkirjan allekirjoitus</SectionTitle>
            <p className="mb-3 text-sm text-ink/65">
              Pöytäkirja lähetetään eSinettiin allekirjoitettavaksi vahvalla tunnistuksella: yhtiökokouksessa puheenjohtajalle ja pöytäkirjantarkastajille, hallituksen kokouksessa yhtiöjärjestyksen mukaan. Sinetöity pöytäkirja tallentuu dokumentteihin automaattisesti.
              {isUsingMockEsinetti() ? " Kehitystilassa käytössä on eSinetin jäljitelmä." : ""}
            </p>
            {signerPlan && meeting.status !== "minutes_signed" ? (
              <div className="mb-4 rounded-xl border border-line bg-cloud/40 p-3 text-sm">
                {signerPlan.ruleLabel ? (
                  <p>
                    <span className="font-semibold">Allekirjoittavat:</span> {signerPlan.ruleLabel.toLowerCase()}.{" "}
                    <Link href={`/taloyhtiot/${id}/muokkaa`} className="text-sky">
                      Muuta perustiedoissa
                    </Link>
                  </p>
                ) : null}
                {signerPlan.preview ? <p className="mt-1 text-xs text-ink/60">Ennen kokousta allekirjoittajiksi oletetaan kaikki osallistujat. Lopulliset allekirjoittajat ovat ne, jotka merkitään läsnä olleiksi.</p> : null}
                {signerPlan.chairFromRegistry ? <p className="mt-1 text-xs text-ink/60">Puheenjohtaja on hallituksen puheenjohtaja rekisteristä. Jos kokouksen puheenjohtaja on joku muu, kirjaa hänet perustietoihin.</p> : null}
                {signerPlan.signers.length ? (
                  <ul className="mt-1 text-ink/75">
                    {signerPlan.signers.map((s) => (
                      <li key={s.email}>
                        {s.name}, {s.role.toLowerCase()} · {s.email}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {signerPlan.problems.map((p) => (
                  <p key={p} className="mt-1 text-coral">
                    {p}
                  </p>
                ))}
              </div>
            ) : null}
            {rounds.length > 0 ? (
              <ul className="mb-4 grid gap-2">
                {rounds.map((r) => (
                  <li key={r.id} className="rounded-xl border border-line p-3 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span>Lähetetty {formatDateTime(r.created_at)}</span>
                      <Badge tone={r.status === "completed" ? "ok" : r.status === "cancelled" || r.status === "expired" || r.status === "error" ? "alert" : "warn"}>
                        {SIGNING_STATUS[r.status] ?? r.status}
                      </Badge>
                    </div>
                    <ul className="mt-2 text-ink/70">
                      {r.signers.map((s) => (
                        <li key={s.email}>
                          {s.name}, {s.role.toLowerCase()}: {s.status === "signed" ? `allekirjoitettu ${formatDateTime(s.signedAt ?? null)}` : "odottaa"}
                        </li>
                      ))}
                    </ul>
                    {r.sealed_document_id ? (
                      <a href={`/api/dokumentit/${r.sealed_document_id}`} className="mt-2 inline-block font-semibold text-sky">
                        Avaa sinetöity pöytäkirja
                      </a>
                    ) : null}
                    {canWrite && canSimulateSigning() && ["draft", "sent", "partially_signed"].includes(r.status) ? (
                      <form action={simulateSigningAction} className="mt-2">
                        {hidden}
                        <input type="hidden" name="round_id" value={r.id} />
                        <Button variant="secondary" className="min-h-9 px-4 text-xs">
                          Simuloi allekirjoitus (kehitys)
                        </Button>
                      </form>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}
            {signerChanges.length ? (
              <details className="mb-4">
                <summary className="cursor-pointer text-xs font-semibold text-sky">Puheenjohtajan ja tarkastajien muutokset ({signerChanges.length})</summary>
                <ul className="mt-2 grid gap-1.5 text-xs text-ink/70">
                  {signerChanges.map((c) => (
                    <li key={c.at}>
                      <span className="font-semibold">{formatDateTime(c.at)}</span>
                      {c.by ? ` · ${c.by}` : ""}: puheenjohtaja {c.before.chair ?? "–"} → {c.after.chair ?? "–"}; tarkastajat {c.before.checkers.join(", ") || "–"} → {c.after.checkers.join(", ") || "–"}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
            {canWrite && meeting.status === "held" && !activeRound ? (
              <form action={sendForSigningAction}>
                {hidden}
                <Button>Lähetä pöytäkirja allekirjoitettavaksi</Button>
                <p className="mt-2 text-xs text-ink/55">Tarkista päätökset, puheenjohtaja ja pöytäkirjantarkastajat sähköposteineen ennen lähetystä.</p>
              </form>
            ) : null}
            {meeting.status !== "held" && meeting.status !== "minutes_signed" ? (
              <p className="text-sm text-ink/55">Pöytäkirjan voi lähettää allekirjoitettavaksi, kun kokous on merkitty pidetyksi.</p>
            ) : null}
          </Panel>
        </div>

        <div className="grid content-start gap-6">
          <Panel id="asiakirjat">
            <SectionTitle>Asiakirjat</SectionTitle>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink/50">Esikatselu</p>
            <div className="mb-2 flex flex-wrap gap-2">
              {DOC_BUTTONS.filter((b) => general || !b.generalOnly).map((b) => (
                <Link
                  key={b.kind}
                  href={`?esikatselu=${b.kind}#asiakirjat`}
                  aria-current={esikatselu === b.kind ? "page" : undefined}
                  className={`inline-flex min-h-9 items-center rounded-full border px-4 text-xs font-semibold ${esikatselu === b.kind ? "border-ink bg-ink text-paper" : "border-line bg-paper text-ink hover:border-ink/30"}`}
                >
                  {b.label}
                </Link>
              ))}
            </div>
            <p className="mb-4 text-xs text-ink/55">Esikatselu muodostetaan kokouksen nykyisistä tiedoista, eikä sitä tallenneta. Kutsu ja esityslista tallentuvat, kun kutsu lähetetään, ja pöytäkirja, kun se lähetetään allekirjoitettavaksi.</p>
            {DOC_BUTTONS.some((b) => b.kind === esikatselu && (general || !b.generalOnly)) ? (
              <div className="mb-4 grid gap-2 rounded-xl border border-line bg-cloud/40 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold">Esikatselu: {DOC_BUTTONS.find((b) => b.kind === esikatselu)!.label.toLowerCase()}</p>
                  <a
                    href={`/taloyhtiot/${id}/kokoukset/${mid}/esikatselu?kind=${esikatselu}`}
                    target="_blank"
                    rel="noopener"
                    className="inline-flex min-h-9 items-center rounded-full bg-ink px-4 text-xs font-semibold text-paper hover:bg-ink-strong"
                  >
                    Avaa uuteen välilehteen
                  </a>
                </div>
                <iframe src={`/taloyhtiot/${id}/kokoukset/${mid}/esikatselu?kind=${esikatselu}`} title="Esikatselu" className="h-[32rem] w-full rounded-lg border border-line bg-paper" />
              </div>
            ) : null}
            {(() => {
              const created = asiakirja ? documents.find((d) => d.id === asiakirja) : undefined;
              return created ? (
                <div className="mb-4 grid gap-2 rounded-xl border border-moss/25 bg-moss-soft p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-moss">Valmis: {created.title}</p>
                    <a
                      href={`/api/dokumentit/${created.id}`}
                      target="_blank"
                      rel="noopener"
                      className="inline-flex min-h-9 items-center rounded-full bg-ink px-4 text-xs font-semibold text-paper hover:bg-ink-strong"
                    >
                      Avaa uuteen välilehteen
                    </a>
                  </div>
                  <iframe src={`/api/dokumentit/${created.id}`} title={created.title} className="h-[32rem] w-full rounded-lg border border-line bg-paper" />
                </div>
              ) : null;
            })()}
            {documents.length === 0 ? (
              <p className="text-sm text-ink/65">Tallennettuja asiakirjoja ei vielä ole.</p>
            ) : (
              <ul className="divide-y divide-line text-sm">
                {documents.map((d) => (
                  <li key={d.id} className="flex items-start justify-between gap-3 py-2">
                    <a href={`/api/dokumentit/${d.id}`} target="_blank" rel="noopener" className="font-semibold text-sky hover:underline">
                      {d.title}
                    </a>
                    <span className="flex shrink-0 flex-col items-end gap-1">
                      {d.sealed ? <Badge tone="ok">Sinetöity</Badge> : null}
                      <span className="text-xs text-ink/55">
                        {VISIBILITY[d.visibility] ?? d.visibility} · {formatDate(d.created_at)}
                      </span>
                      {canDeleteDocs && !d.sealed && !roundDocIds.has(d.id) ? (
                        <details className="text-right">
                          <summary className="cursor-pointer list-none text-xs text-coral [&::-webkit-details-marker]:hidden">Poista</summary>
                          <form action={deleteMeetingDocumentAction} className="mt-1">
                            {hidden}
                            <input type="hidden" name="document_id" value={d.id} />
                            <button className="rounded-full border border-coral/40 px-3 py-1 text-xs font-semibold text-coral hover:bg-coral-soft">Vahvista poisto</button>
                          </form>
                        </details>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <Panel>
            <SectionTitle>Isännöitsijäntodistukset</SectionTitle>
            <p className="text-sm text-ink/65">Todistukset ja tilaukset ovat omalla sivullaan.</p>
            <Link href="/todistukset" className="mt-2 inline-block text-sm font-semibold text-sky">
              Todistukset
            </Link>
          </Panel>
        </div>
      </div>
    </>
  );
}
