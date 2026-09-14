import { CompanyHeader, loadCompany } from "@/components/CompanyHeader";
import { FormError } from "@/components/FormError";
import { Badge, Button, EmptyState, Field, Input, Panel, SectionTitle, Select, Table, Td, Th } from "@/components/ui";
import { requireStaff } from "@/lib/auth/current-user";
import { formatDate } from "@/lib/format";
import { listBoard, listOwners } from "@/lib/registry/queries";
import { BOARD_ROLE } from "@/lib/registry/labels";
import { InvitePartyButton } from "@/components/invitations/InvitePartyButton";
import { addBoardMember, endBoardMembership } from "../../actions";

export const metadata = { title: "Hallitus" };

export default async function BoardPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ virhe?: string }> }) {
  const ctx = await requireStaff();
  const { id } = await params;
  const company = await loadCompany(ctx, id);
  const { virhe } = await searchParams;
  const [board, owners] = await ctx.run((tx) => Promise.all([listBoard(tx, id, true), listOwners(tx, id)]));
  const current = board.filter((b) => !b.ends_on || new Date(b.ends_on) >= new Date(new Date().toDateString()));
  const past = board.filter((b) => !current.includes(b));
  const ownerOptions = [...new Map(owners.map((o) => [o.party_id, o.display_name])).entries()].sort((a, b) => a[1].localeCompare(b[1], "fi"));
  const canWrite = ctx.can("owner", "manager", "assistant");
  const canInvite = ctx.can("owner", "manager");

  return (
    <>
      <CompanyHeader company={company} active="hallitus" />
      <FormError message={virhe} />
      <div className="grid gap-6 xl:grid-cols-[1.5fr_1fr]">
        <div className="grid content-start gap-6">
          {current.length === 0 ? (
            <EmptyState title="Hallitusta ei ole kirjattu">Hallituksen jäsenet saavat portaaliin hallituksen oikeudet toimikautensa ajaksi.</EmptyState>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Nimi</Th>
                  <Th>Rooli</Th>
                  <Th>Toimikausi</Th>
                  <Th>Yhteystiedot</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {current.map((b) => (
                  <tr key={b.id}>
                    <Td className="font-semibold">{b.display_name}</Td>
                    <Td>
                      <Badge tone={b.role === "chair" ? "info" : "neutral"}>{BOARD_ROLE[b.role]}</Badge>
                    </Td>
                    <Td>
                      {formatDate(b.starts_on)} – {b.ends_on ? formatDate(b.ends_on) : ""}
                    </Td>
                    <Td>{[b.email, b.phone].filter(Boolean).join(" · ") || "–"}</Td>
                    <Td>
                      <div className="flex flex-col items-end gap-1">
                        {canInvite ? <InvitePartyButton partyId={b.party_id} companyId={id} role="board" hasEmail={!!b.email} /> : null}
                        {canWrite ? (
                          <form action={endBoardMembership}>
                            <input type="hidden" name="company_id" value={id} />
                            <input type="hidden" name="id" value={b.id} />
                            <button className="text-xs text-coral">Päätä</button>
                          </form>
                        ) : null}
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
          {past.length > 0 ? (
            <details className="rounded-[var(--radius-panel)] border border-line bg-paper p-4">
              <summary className="cursor-pointer text-sm font-semibold">Aiemmat jäsenet ({past.length})</summary>
              <ul className="mt-3 text-sm text-ink/70">
                {past.map((b) => (
                  <li key={b.id}>
                    {b.display_name}, {BOARD_ROLE[b.role].toLowerCase()} {formatDate(b.starts_on)}–{formatDate(b.ends_on)}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>

        {canWrite ? (
          <Panel>
            <SectionTitle>Lisää hallitukseen</SectionTitle>
            <form action={addBoardMember} className="grid gap-4">
              <input type="hidden" name="company_id" value={id} />
              <Field label="Osakas" htmlFor="existing_party_id" hint="Tai jätä tyhjäksi ja anna uuden henkilön tiedot">
                <Select id="existing_party_id" name="existing_party_id" defaultValue="">
                  <option value="">Uusi henkilö</option>
                  {ownerOptions.map(([pid, name]) => (
                    <option key={pid} value={pid}>
                      {name}
                    </option>
                  ))}
                </Select>
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Etunimet" htmlFor="first_names">
                  <Input id="first_names" name="first_names" />
                </Field>
                <Field label="Sukunimi" htmlFor="last_name">
                  <Input id="last_name" name="last_name" />
                </Field>
              </div>
              <Field label="Sähköposti" htmlFor="email">
                <Input id="email" name="email" type="email" />
              </Field>
              <Field label="Rooli" htmlFor="role">
                <Select id="role" name="role" defaultValue="member">
                  {Object.entries(BOARD_ROLE).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </Select>
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Alkaa" htmlFor="starts_on">
                  <Input id="starts_on" name="starts_on" type="date" required />
                </Field>
                <Field label="Päättyy" htmlFor="ends_on">
                  <Input id="ends_on" name="ends_on" type="date" />
                </Field>
              </div>
              <div>
                <Button variant="secondary">Lisää</Button>
              </div>
            </form>
          </Panel>
        ) : null}
      </div>
    </>
  );
}
