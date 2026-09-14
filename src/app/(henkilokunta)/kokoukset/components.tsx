import Link from "next/link";
import { Badge, Button, EmptyState, Field, Input, Panel, SectionTitle, Select, Table, Td, Th } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { MEETING_KIND, MEETING_KINDS, MEETING_STATUS, MEETING_STATUS_TONE } from "@/lib/meetings/labels";
import type { MeetingRow } from "@/lib/meetings/queries";
import { createMeetingAction } from "./actions";

/** Kokouslistan ja uuden kokouksen lomakkeen yhteiset osat /kokoukset- ja taloyhtiösivulle. */

export function MeetingTable({ meetings, showCompany, empty }: { meetings: MeetingRow[]; showCompany?: boolean; empty: string }) {
  if (meetings.length === 0) return <EmptyState title={empty} />;
  return (
    <Table>
      <thead>
        <tr>
          <Th>Aika</Th>
          {showCompany ? <Th>Taloyhtiö</Th> : null}
          <Th>Kokous</Th>
          <Th>Paikka</Th>
          <Th>Tila</Th>
        </tr>
      </thead>
      <tbody>
        {meetings.map((m) => (
          <tr key={m.id}>
            <Td className="whitespace-nowrap">
              <Link href={`/taloyhtiot/${m.company_id}/kokoukset/${m.id}`} className="font-semibold hover:text-sky">
                {formatDateTime(m.starts_at)}
              </Link>
            </Td>
            {showCompany ? <Td>{m.company_name}</Td> : null}
            <Td>{MEETING_KIND[m.kind]}</Td>
            <Td>{m.location ?? "–"}{m.remote_participation ? " · etä" : ""}</Td>
            <Td>
              <Badge tone={MEETING_STATUS_TONE[m.status]}>{MEETING_STATUS[m.status]}</Badge>
            </Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

export function NewMeetingForm({ companyId, companies }: { companyId?: string; companies?: { id: string; name: string }[] }) {
  const year = new Date().getFullYear();
  return (
    <Panel>
      <SectionTitle>Uusi kokous</SectionTitle>
      <form action={createMeetingAction} className="grid gap-4">
        {companyId ? (
          <input type="hidden" name="company_id" value={companyId} />
        ) : (
          <Field label="Taloyhtiö" htmlFor="company_id">
            <Select id="company_id" name="company_id" required defaultValue="">
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
        <Field label="Kokous" htmlFor="kind" hint="Asialista luodaan pohjasta, ja voit muokata sitä.">
          <Select id="kind" name="kind" defaultValue="annual_general">
            {MEETING_KINDS.map((k) => (
              <option key={k} value={k}>
                {MEETING_KIND[k]}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Päivä" htmlFor="date">
            <Input id="date" name="date" type="date" required />
          </Field>
          <Field label="Kello" htmlFor="time">
            <Input id="time" name="time" type="time" required defaultValue="18:00" />
          </Field>
        </div>
        <Field label="Paikka" htmlFor="location">
          <Input id="location" name="location" placeholder="Kerhohuone" />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="remote_participation" /> Etäosallistuminen mahdollinen
        </label>
        <Field label="Etäyhteyden osoite" htmlFor="remote_url">
          <Input id="remote_url" name="remote_url" type="url" placeholder="https://" />
        </Field>
        <Field label="Tilikausi" htmlFor="fiscal_year">
          <Input id="fiscal_year" name="fiscal_year" defaultValue={String(year - 1)} />
        </Field>
        <div>
          <Button>Luo kokous</Button>
        </div>
      </form>
    </Panel>
  );
}
