import { Badge, Button, EmptyState, Field, Input, Panel, SectionTitle, Select, Table, Td, Th } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { requireSettingsAccess } from "@/lib/settings/guard";
import { listMembers, listOpenInvitations } from "@/lib/settings/members";
import { STAFF_ROLES, STAFF_ROLE_LABEL, assignableStaffRoles } from "@/lib/invitations/rules";
import { changeRole, inviteStaff, removeMemberAction, resendInvite, revokeInvite, updateOwnContact } from "./actions";
import { SettingsHeader } from "./SettingsHeader";

export const metadata = { title: "Asetukset: henkilökunta" };

export default async function StaffSettingsPage({ searchParams }: { searchParams: Promise<{ virhe?: string; ok?: string }> }) {
  const ctx = await requireSettingsAccess();
  const { virhe, ok } = await searchParams;
  const orgId = ctx.org.organizationId;
  const [members, invitations, me] = await ctx.run((tx) =>
    Promise.all([
      listMembers(tx, orgId),
      listOpenInvitations(tx, orgId, "staff"),
      tx.query<{ email: string; full_name: string | null; phone: string | null; contact_email: string | null }>("select email, full_name, phone, contact_email from er_users where id = er_current_user_id()").then((r) => r[0]),
    ]),
  );
  const isOwner = ctx.can("owner");
  const ownerCount = members.filter((m) => m.role === "owner").length;
  const invitable = assignableStaffRoles(ctx.org.role);

  return (
    <>
      <SettingsHeader active="henkilokunta" organizationName={ctx.org.organizationName} virhe={virhe} ok={ok} />
      <div className="grid gap-6 xl:grid-cols-[1.6fr_1fr]">
        <div className="grid content-start gap-6">
          <section>
            <SectionTitle>Jäsenet</SectionTitle>
            <Table>
              <thead>
                <tr>
                  <Th>Nimi</Th>
                  <Th>Rooli</Th>
                  <Th>Jäsenenä alkaen</Th>
                  {isOwner ? <Th /> : null}
                </tr>
              </thead>
              <tbody>
                {members.map((m) => {
                  const lastOwner = m.role === "owner" && ownerCount <= 1;
                  return (
                    <tr key={m.user_id}>
                      <Td>
                        <p className="font-semibold">{m.full_name ?? m.email}</p>
                        {m.full_name ? <p className="text-ink/60">{m.email}</p> : null}
                        {m.user_id === ctx.user.id ? <Badge tone="info">Sinä</Badge> : null}
                      </Td>
                      <Td>
                        {isOwner && !lastOwner ? (
                          <form action={changeRole} className="flex flex-wrap items-center gap-2">
                            <input type="hidden" name="user_id" value={m.user_id} />
                            <label htmlFor={`role-${m.user_id}`} className="sr-only">
                              Rooli
                            </label>
                            <Select id={`role-${m.user_id}`} name="role" defaultValue={m.role} className="w-auto">
                              {STAFF_ROLES.map((r) => (
                                <option key={r} value={r}>
                                  {STAFF_ROLE_LABEL[r]}
                                </option>
                              ))}
                            </Select>
                            <Button variant="secondary">Vaihda</Button>
                          </form>
                        ) : (
                          <Badge tone={m.role === "owner" ? "info" : "neutral"}>{STAFF_ROLE_LABEL[m.role]}</Badge>
                        )}
                        {lastOwner && isOwner ? <p className="mt-1 text-xs text-ink/55">Ainoa pääkäyttäjä</p> : null}
                      </Td>
                      <Td>{formatDate(m.created_at)}</Td>
                      {isOwner ? (
                        <Td>
                          {!lastOwner ? (
                            <form action={removeMemberAction}>
                              <input type="hidden" name="user_id" value={m.user_id} />
                              <button className="text-xs text-coral">Poista organisaatiosta</button>
                            </form>
                          ) : null}
                        </Td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </Table>
            {!isOwner ? <p className="mt-2 text-sm text-ink/60">Rooleja ja jäsenyyksiä muuttaa pääkäyttäjä.</p> : null}
          </section>

          <section>
            <SectionTitle>Avoimet kutsut</SectionTitle>
            {invitations.length === 0 ? (
              <EmptyState title="Ei avoimia kutsuja" />
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Sähköposti</Th>
                    <Th>Rooli</Th>
                    <Th>Voimassa</Th>
                    <Th />
                  </tr>
                </thead>
                <tbody>
                  {invitations.map((i) => (
                    <tr key={i.id}>
                      <Td>{i.email}</Td>
                      <Td>{STAFF_ROLE_LABEL[i.role as keyof typeof STAFF_ROLE_LABEL] ?? i.role}</Td>
                      <Td>{i.expired ? <Badge tone="warn">Vanhentunut</Badge> : formatDate(i.expires_at)}</Td>
                      <Td>
                        <div className="flex flex-wrap gap-3">
                          <form action={resendInvite}>
                            <input type="hidden" name="id" value={i.id} />
                            <input type="hidden" name="back" value="/asetukset" />
                            <button className="text-xs text-sky">Lähetä uudelleen</button>
                          </form>
                          <form action={revokeInvite}>
                            <input type="hidden" name="id" value={i.id} />
                            <input type="hidden" name="back" value="/asetukset" />
                            <button className="text-xs text-coral">Peru</button>
                          </form>
                        </div>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </section>
        </div>

        <div className="grid content-start gap-6">
        <Panel>
          <SectionTitle>Omat yhteystiedot asiakirjoissa</SectionTitle>
          <p className="mb-3 text-sm text-ink/65">
            Näkyvät isännöitsijän tietoina kokouskutsussa, isännöitsijäntodistuksessa ja pelastussuunnitelmassa. Kirjautumissähköposti {me?.email} ei muutu.
          </p>
          <form action={updateOwnContact} className="grid gap-4">
            <Field label="Nimi" htmlFor="own_full_name">
              <Input id="own_full_name" name="full_name" defaultValue={me?.full_name ?? ""} autoComplete="name" />
            </Field>
            <Field label="Sähköposti asiakirjoihin" htmlFor="own_contact_email" hint="Tyhjänä käytetään kirjautumissähköpostia.">
              <Input id="own_contact_email" name="contact_email" type="email" defaultValue={me?.contact_email ?? ""} autoComplete="email" />
            </Field>
            <Field label="Puhelin" htmlFor="own_phone">
              <Input id="own_phone" name="phone" type="tel" defaultValue={me?.phone ?? ""} autoComplete="tel" />
            </Field>
            <div>
              <Button variant="secondary">Tallenna</Button>
            </div>
          </form>
        </Panel>
        <Panel className="content-start">
          <SectionTitle>Kutsu käyttäjä</SectionTitle>
          <form action={inviteStaff} className="grid gap-4">
            <Field label="Sähköposti" htmlFor="email" hint="Kutsu hyväksytään kirjautumalla tällä osoitteella.">
              <Input id="email" name="email" type="email" required autoComplete="off" />
            </Field>
            <Field label="Rooli" htmlFor="role">
              <Select id="role" name="role" defaultValue="accountant">
                {invitable.map((r) => (
                  <option key={r} value={r}>
                    {STAFF_ROLE_LABEL[r]}
                  </option>
                ))}
              </Select>
            </Field>
            <p className="text-sm text-ink/60">Linkki on voimassa 14 päivää. Kirjanpitäjä näkee talouden ja HTJ2-tiedot mutta ei muokkaa rekisteriä.</p>
            <div>
              <Button>Lähetä kutsu</Button>
            </div>
          </form>
        </Panel>
        </div>
      </div>
    </>
  );
}
