import { Button, EmptyState, Field, Select, Table, Td, Th } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { requireSettingsAccess } from "@/lib/settings/guard";
import { AUDIT_LIMIT, auditFacets, listAuditLog } from "@/lib/settings/audit-log";
import { listMembers } from "@/lib/settings/members";
import { SettingsHeader } from "../SettingsHeader";

export const metadata = { title: "Asetukset: tapahtumaloki" };

const UUID = /^[0-9a-f-]{36}$/i;
const TOKEN = /^[a-z_]{1,60}$/;

export default async function AuditLogPage({ searchParams }: { searchParams: Promise<{ kayttaja?: string; toiminto?: string; kohde?: string }> }) {
  const ctx = await requireSettingsAccess();
  const sp = await searchParams;
  // Suodattimet ovat tunnisteita, eivät vapaata tekstiä: muu syöte ohitetaan.
  const filter = {
    userId: sp.kayttaja && UUID.test(sp.kayttaja) ? sp.kayttaja : null,
    action: sp.toiminto && TOKEN.test(sp.toiminto) ? sp.toiminto : null,
    entity: sp.kohde && TOKEN.test(sp.kohde) ? sp.kohde : null,
  };
  const orgId = ctx.org.organizationId;
  const [rows, facets, members] = await ctx.run((tx) => Promise.all([listAuditLog(tx, orgId, filter), auditFacets(tx, orgId), listMembers(tx, orgId)]));

  return (
    <>
      <SettingsHeader active="loki" organizationName={ctx.org.organizationName} />
      <form method="get" className="mb-5 grid gap-3 sm:grid-cols-[repeat(3,minmax(0,1fr))_auto] sm:items-end">
        <Field label="Käyttäjä" htmlFor="kayttaja">
          <Select id="kayttaja" name="kayttaja" defaultValue={filter.userId ?? ""}>
            <option value="">Kaikki</option>
            {members.map((m) => (
              <option key={m.user_id} value={m.user_id}>
                {m.full_name ?? m.email}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Toiminto" htmlFor="toiminto">
          <Select id="toiminto" name="toiminto" defaultValue={filter.action ?? ""}>
            <option value="">Kaikki</option>
            {facets.actions.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Kohde" htmlFor="kohde">
          <Select id="kohde" name="kohde" defaultValue={filter.entity ?? ""}>
            <option value="">Kaikki</option>
            {facets.entities.map((e) => (
              <option key={e} value={e}>
                {e}
              </option>
            ))}
          </Select>
        </Field>
        <Button variant="secondary">Suodata</Button>
      </form>

      {rows.length === 0 ? (
        <EmptyState title="Ei tapahtumia" />
      ) : (
        <>
          <Table>
            <thead>
              <tr>
                <Th>Aika</Th>
                <Th>Käyttäjä</Th>
                <Th>Toiminto</Th>
                <Th>Kohde</Th>
                <Th>Tunniste</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <Td className="whitespace-nowrap">{formatDateTime(r.created_at)}</Td>
                  <Td>{r.user_label ?? (r.user_id ? "Portaalikäyttäjä" : "Järjestelmä")}</Td>
                  <Td>
                    <code className="text-xs">{r.action}</code>
                  </Td>
                  <Td>
                    <code className="text-xs">{r.entity}</code>
                  </Td>
                  <Td>
                    <code className="text-xs text-ink/55">{r.entity_id ? r.entity_id.slice(0, 8) : "–"}</code>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <p className="mt-2 text-sm text-ink/55">Näytetään enintään {AUDIT_LIMIT} uusinta tapahtumaa. Lisätietokenttää ei näytetä, koska se voi sisältää henkilötietoja.</p>
        </>
      )}
    </>
  );
}
