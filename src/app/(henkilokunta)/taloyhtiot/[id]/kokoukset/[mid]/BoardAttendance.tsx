import type { ReactNode } from "react";
import { Button, Field, Input } from "@/components/ui";
import type { AttendeeRow } from "@/lib/meetings/queries";
import { addAttendeeAction, deleteAttendeeAction, prefillAttendeesAction, saveAttendeesAction } from "../../../../kokoukset/actions";

/**
 * Hallituksen kokouksen läsnäolot siinä asialistan kohdassa, jossa ne
 * todetaan (Jukka 22.9.2026). Läsnä olleet kirjataan pöytäkirjaan samaan
 * pykälään, ja yhtiöjärjestyksen mukaan he voivat olla myös allekirjoittajat.
 *
 * Rekisterin henkilöillä sähköposti tulee rekisteristä; käsin lisätylle
 * läsnäolijalle (tyypillisesti isännöitsijä) se annetaan tässä, koska ilman
 * osoitetta allekirjoituskutsua ei voi lähettää (Jukka 24.9.2026).
 */
export function BoardAttendance({ hidden, attendees, canWrite, signersNote }: { hidden: ReactNode; attendees: AttendeeRow[]; canWrite: boolean; signersNote: string | null }) {
  const present = attendees.filter((a) => a.present);
  return (
    <div id="osallistujat" className="mt-3 grid gap-3 rounded-xl border border-line bg-cloud/40 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold">
          Läsnä {present.length}/{attendees.length}
        </p>
        {canWrite ? (
          <form action={prefillAttendeesAction}>
            {hidden}
            <Button variant="secondary" className="min-h-9 px-4 text-xs">
              {attendees.length ? "Esitäytä uudelleen hallituksesta" : "Esitäytä hallituksesta"}
            </Button>
          </form>
        ) : null}
      </div>
      {attendees.length === 0 ? (
        <p className="text-sm text-ink/65">Osallistujia ei ole. Esitäyttö hakee voimassa olevat hallituksen jäsenet rekisteristä.</p>
      ) : (
        <form action={saveAttendeesAction} className="grid gap-2">
          {hidden}
          <ul className="grid gap-1">
            {attendees.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                <input type="hidden" name="attendee_id" value={a.id} />
                <input type="hidden" name={`proxy_${a.id}`} value={a.proxy_name ?? ""} />
                <input type="hidden" name={`shares_${a.id}`} value={a.shares} />
                <span className="min-w-44 font-semibold">{a.display_name}</span>
                {a.party_email ? null : (
                  <label className="flex items-center gap-1.5 text-xs text-ink/70">
                    Sähköposti
                    <Input
                      name={`email_${a.id}`}
                      type="email"
                      defaultValue={a.email ?? ""}
                      disabled={!canWrite}
                      placeholder="allekirjoitusta varten"
                      className="min-h-9 w-56 text-sm"
                    />
                  </label>
                )}
                <label className="flex items-center gap-1.5">
                  <input type="checkbox" name={`present_${a.id}`} defaultChecked={a.present} disabled={!canWrite} className="h-5 w-5" /> Läsnä
                </label>
                <label className="flex items-center gap-1.5">
                  <input type="checkbox" name={`remote_${a.id}`} defaultChecked={a.remote} disabled={!canWrite} className="h-5 w-5" /> Etänä
                </label>
                {canWrite ? (
                  <button formAction={deleteAttendeeAction} name="delete_attendee_id" value={a.id} className="text-xs text-coral">
                    Poista
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
          {canWrite ? (
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" className="min-h-9 px-4 text-xs">
                Tallenna läsnäolot
              </Button>
              <Button type="submit" name="mark_all" value="1" variant="ghost" className="min-h-9 px-4 text-xs">
                Merkitse kaikki läsnä
              </Button>
            </div>
          ) : null}
        </form>
      )}
      {signersNote ? <p className="text-xs text-ink/60">{signersNote}</p> : null}
      {canWrite ? (
        <details>
          <summary className="cursor-pointer text-xs font-semibold text-sky">Lisää muu läsnäolija (esim. isännöitsijä)</summary>
          <form action={addAttendeeAction} className="mt-2 flex flex-wrap items-end gap-3">
            {hidden}
            <Field label="Nimi" htmlFor="display_name">
              <Input id="display_name" name="display_name" required />
            </Field>
            <Field label="Sähköposti" htmlFor="attendee_email" hint="Tarvitaan, jos hän allekirjoittaa pöytäkirjan.">
              <Input id="attendee_email" name="email" type="email" />
            </Field>
            <Button variant="secondary" className="min-h-10">
              Lisää
            </Button>
          </form>
        </details>
      ) : null}
    </div>
  );
}
