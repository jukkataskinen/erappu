import Link from "next/link";
import { CompanyHeader, loadCompany } from "@/components/CompanyHeader";
import { Badge, EmptyState, Notice, Table, Td, Th } from "@/components/ui";
import { requireStaff } from "@/lib/auth/current-user";
import { formatFraction, formatNumber } from "@/lib/format";
import { listOwners } from "@/lib/registry/queries";
import { SOURCE } from "@/lib/registry/labels";

export const metadata = { title: "Osakkaat" };

/**
 * Osakasluettelo. HTJ-siirron jälkeen yhtiön ei tarvitse ylläpitää
 * osakeluetteloa, mutta isännöitsijä tarvitsee ajantasaisen osakasluettelon
 * yhteystietoineen kokouskutsuja ja laskutusta varten.
 */
export default async function OwnersPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireStaff();
  const { id } = await params;
  const company = await loadCompany(ctx, id);
  const owners = await ctx.run((tx) => listOwners(tx, id));

  // Huoneistojärjestys (A 2 ennen A 10), saman huoneiston omistajat nimen mukaan.
  const unitOrder = new Intl.Collator("fi", { numeric: true, sensitivity: "base" });
  const sorted = [...owners].sort((a, b) => unitOrder.compare(a.unit_label, b.unit_label) || unitOrder.compare(a.display_name, b.display_name));

  const byParty = new Map<string, { name: string; email: string | null; phone: string | null; address: string; units: string[]; shares: number; portal: boolean; sources: Set<string> }>();
  for (const o of sorted) {
    const entry = byParty.get(o.party_id) ?? {
      name: o.display_name,
      email: o.email,
      phone: o.phone,
      address: [o.street_address, [o.postal_code, o.city].filter(Boolean).join(" ")].filter(Boolean).join(", "),
      units: [],
      shares: 0,
      portal: o.has_portal,
      sources: new Set<string>(),
    };
    entry.units.push(`${o.unit_label}${o.share_numerator !== o.share_denominator ? ` (${formatFraction(o.share_numerator, o.share_denominator)})` : ""}`);
    entry.shares += (o.share_count * o.share_numerator) / o.share_denominator;
    entry.sources.add(o.source);
    byParty.set(o.party_id, entry);
  }
  const rows = [...byParty.entries()];
  const missingContact = rows.filter(([, r]) => !r.email && !r.address).length;

  return (
    <>
      <CompanyHeader company={company} active="osakkaat" />
      {company.htj_synced_at ? null : (
        <div className="mb-5">
          <Notice tone="warn" title="Omistajatiedot eivät ole HTJ:stä">
            Luettelo perustuu käsin tai Accessista tuotuihin tietoihin. Kun HTJ-yhteys on käytössä, omistajat ja osuudet haetaan HTJ:stä.
          </Notice>
        </div>
      )}
      {missingContact > 0 ? (
        <div className="mb-5">
          <Notice tone="alert" title={`${missingContact} osakkaalta puuttuu sekä sähköposti että postiosoite`}>
            Kokouskutsua ei voi toimittaa ilman yhteystietoja.
          </Notice>
        </div>
      ) : null}
      {rows.length === 0 ? (
        <EmptyState title="Ei osakkaita">Lisää omistajat huoneistojen kautta tai hae ne HTJ:stä.</EmptyState>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Osakas</Th>
              <Th>Huoneistot</Th>
              <Th numeric>Osakkeita</Th>
              <Th>Yhteystiedot</Th>
              <Th>Lähde</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([partyId, r]) => (
              <tr key={partyId}>
                <Td>
                  <span className="font-semibold">{r.name}</span>
                  {r.portal ? (
                    <span className="ml-2">
                      <Badge tone="info">Portaalissa</Badge>
                    </span>
                  ) : null}
                </Td>
                <Td>
                  {r.units.map((u, i) => (
                    <span key={u}>
                      {i > 0 ? ", " : ""}
                      <Link className="hover:text-sky" href={`/taloyhtiot/${id}/huoneistot/${owners.find((o) => o.party_id === partyId && u.startsWith(o.unit_label))?.share_group_id}`}>
                        {u}
                      </Link>
                    </span>
                  ))}
                </Td>
                <Td numeric>{formatNumber(r.shares)}</Td>
                <Td>
                  <span className="block">{r.email ?? <span className="text-ink/45">ei sähköpostia</span>}</span>
                  <span className="block text-xs text-ink/55">{[r.phone, r.address].filter(Boolean).join(" · ")}</span>
                </Td>
                <Td>{[...r.sources].map((s) => SOURCE[s]).join(", ")}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}
