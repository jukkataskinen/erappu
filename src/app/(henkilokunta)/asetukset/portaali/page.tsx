import { Badge, EmptyState, SectionTitle, Table, Td, Th } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { requireSettingsAccess } from "@/lib/settings/guard";
import { listOpenInvitations } from "@/lib/settings/members";
import { basisLabel, listPortalUsers } from "@/lib/settings/portal-users";
import { PORTAL_INVITE_ROLE_LABEL, type PortalInviteRole } from "@/lib/invitations/rules";
import { resendInvite, revokeInvite } from "../actions";
import { SettingsHeader } from "../SettingsHeader";

export const metadata = { title: "Asetukset: portaalikäyttäjät" };

const ROLE: Record<string, string> = { board: "Hallitus", owner: "Osakas", resident: "Asukas", provider: "Palveluntuottaja" };

export default async function PortalUsersPage({ searchParams }: { searchParams: Promise<{ virhe?: string; ok?: string; paattyneet?: string }> }) {
  const ctx = await requireSettingsAccess();
  const { virhe, ok, paattyneet } = await searchParams;
  const includeEnded = paattyneet === "1";
  const orgId = ctx.org.organizationId;
  const [users, invitations] = await ctx.run((tx) => Promise.all([listPortalUsers(tx, orgId, includeEnded), listOpenInvitations(tx, orgId, "portal")]));

  return (
    <>
      <SettingsHeader active="portaali" organizationName={ctx.org.organizationName} virhe={virhe} ok={ok} />
      <section className="mb-8">
        <SectionTitle
          actions={
            <a href={includeEnded ? "/asetukset/portaali" : "/asetukset/portaali?paattyneet=1"} className="text-sm text-sky">
              {includeEnded ? "Vain voimassa olevat" : "Näytä myös päättyneet"}
            </a>
          }
        >
          Portaalioikeudet
        </SectionTitle>
        {users.length === 0 ? (
          <EmptyState title="Ei portaalikäyttäjiä">Kutsu osakas tai asukas portaaliin huoneiston sivulta tai hallituksen jäsen hallitussivulta.</EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Käyttäjä</Th>
                <Th>Yhtiö</Th>
                <Th>Rooli</Th>
                <Th>Peruste</Th>
                <Th>Voimassa</Th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <Td>
                    <p className="font-semibold">{u.person ?? "Tuntematon osapuoli"}</p>
                    {u.email ? <p className="text-ink/60">{u.email}</p> : null}
                  </Td>
                  <Td>
                    {u.company_name}
                    {u.unit_label ? <span className="text-ink/60"> · {u.unit_label}</span> : null}
                  </Td>
                  <Td>
                    <Badge tone={u.role === "board" ? "info" : "neutral"}>{ROLE[u.role]}</Badge>
                  </Td>
                  <Td>{basisLabel(u.basis)}</Td>
                  <Td className="whitespace-nowrap">
                    {formatDate(u.starts_on)} – {u.ends_on ? formatDate(u.ends_on) : ""}
                    {!u.active ? (
                      <span className="ml-2">
                        <Badge>Päättynyt</Badge>
                      </span>
                    ) : null}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>

      <section>
        <SectionTitle>Avoimet portaalikutsut</SectionTitle>
        {invitations.length === 0 ? (
          <EmptyState title="Ei avoimia portaalikutsuja" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Henkilö</Th>
                <Th>Yhtiö</Th>
                <Th>Kutsuttu</Th>
                <Th>Voimassa</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {invitations.map((i) => (
                <tr key={i.id}>
                  <Td>
                    <p className="font-semibold">{i.party_name ?? "–"}</p>
                    <p className="text-ink/60">{i.email}</p>
                  </Td>
                  <Td>{i.company_name ?? "–"}</Td>
                  <Td>{PORTAL_INVITE_ROLE_LABEL[i.role as PortalInviteRole] ?? i.role}</Td>
                  <Td>{i.expired ? <Badge tone="warn">Vanhentunut</Badge> : formatDate(i.expires_at)}</Td>
                  <Td>
                    <div className="flex flex-wrap gap-3">
                      <form action={resendInvite}>
                        <input type="hidden" name="id" value={i.id} />
                        <input type="hidden" name="back" value="/asetukset/portaali" />
                        <button className="text-xs text-sky">Lähetä uudelleen</button>
                      </form>
                      <form action={revokeInvite}>
                        <input type="hidden" name="id" value={i.id} />
                        <input type="hidden" name="back" value="/asetukset/portaali" />
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
    </>
  );
}
