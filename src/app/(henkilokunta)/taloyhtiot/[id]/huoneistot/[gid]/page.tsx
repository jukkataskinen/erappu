import { notFound } from "next/navigation";
import { CompanyHeader, loadCompany } from "@/components/CompanyHeader";
import { FormError } from "@/components/FormError";
import { Badge, Button, Field, Input, Notice, Panel, SectionTitle, Select } from "@/components/ui";
import { requireStaff } from "@/lib/auth/current-user";
import { formatDate, formatFraction } from "@/lib/format";
import { listBuildings } from "@/lib/registry/queries";
import { SOURCE } from "@/lib/registry/labels";
import { CATEGORY_LABEL, VISIBILITY_LABEL, VISIBILITY_TONE, type DocumentCategory } from "@/lib/documents/labels";
import type { ShareRange } from "@/lib/registry/share-ranges";
import { InvitePartyButton } from "@/components/invitations/InvitePartyButton";
import { ShareGroupForm } from "../ShareGroupForm";
import { addPartyToShareGroup, endRelation } from "../../../actions";

export const metadata = { title: "Huoneisto" };

interface Relation {
  id: string;
  party_id: string;
  display_name: string;
  email: string | null;
  phone: string | null;
  starts_on: string | null;
  source?: string;
  share_numerator?: number;
  share_denominator?: number;
  role?: string;
  has_portal: boolean;
}

const RESIDENT_ROLE: Record<string, string> = { owner: "Omistaja-asukas", tenant: "Vuokralainen", other: "Muu asukas" };

export default async function ShareGroupPage({ params, searchParams }: { params: Promise<{ id: string; gid: string }>; searchParams: Promise<{ virhe?: string }> }) {
  const ctx = await requireStaff();
  const { id, gid } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(gid)) notFound();
  const company = await loadCompany(ctx, id);
  const { virhe } = await searchParams;

  const data = await ctx.run(async (tx) => {
    const [group] = await tx.query<{
      id: string; unit_label: string; kind: string; layout: string | null; floor: string | null; area_m2: string | null;
      intended_use: string | null; building_id: string | null; is_rented: boolean; share_count: number; source: string; ranges: ShareRange[];
    }>(
      `select g.*, coalesce((select json_agg(json_build_object('first', r.first_share, 'last', r.last_share) order by r.first_share)
                               from er_share_ranges r where r.share_group_id = g.id), '[]'::json) as ranges
         from er_share_groups g where g.id = $1 and g.company_id = $2`,
      [gid, id],
    );
    if (!group) return null;
    const owners = await tx.query<Relation>(
      `select o.id, p.id as party_id, p.display_name, p.email, p.phone, o.starts_on, o.source, o.share_numerator, o.share_denominator, (p.user_id is not null) as has_portal
         from er_ownerships o join er_parties p on p.id = o.party_id
        where o.share_group_id = $1 and (o.ends_on is null or o.ends_on >= current_date) order by p.display_name`,
      [gid],
    );
    const residents = await tx.query<Relation>(
      `select r.id, p.id as party_id, p.display_name, p.email, p.phone, r.starts_on, r.role, (p.user_id is not null) as has_portal
         from er_residencies r join er_parties p on p.id = r.party_id
        where r.share_group_id = $1 and (r.ends_on is null or r.ends_on >= current_date) order by p.display_name`,
      [gid],
    );
    const buildings = await listBuildings(tx, id);
    const documents = await tx.query<{ id: string; category: string; title: string; file_name: string; mime_type: string; visibility: string }>(
      `select id, category, title, file_name, mime_type, visibility from er_documents
        where share_group_id = $1 order by case when category = 'floor_plan' then 0 else 1 end, created_at desc`,
      [gid],
    );
    return { group, owners, residents, buildings, documents };
  });
  if (!data) notFound();
  const { group, owners, residents, buildings, documents } = data;
  const canWrite = ctx.can("owner", "manager", "assistant");
  const canInvite = ctx.can("owner", "manager");
  const shareSum = owners.reduce((s, o) => s + (o.share_numerator ?? 1) / (o.share_denominator ?? 1), 0);

  return (
    <>
      <CompanyHeader company={company} active="huoneistot" />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h2 className="text-xl">Huoneisto {group.unit_label}</h2>
        <Badge tone={group.source === "htj" ? "ok" : "neutral"}>{SOURCE[group.source]}</Badge>
      </div>
      <FormError message={virhe} />
      {group.source === "htj" ? (
        <div className="mb-4">
          <Notice tone="info" title="Tiedot tulevat HTJ:stä">
            Osakeryhmän tiedot ja omistajat päivittyvät Maanmittauslaitoksen huoneistotietojärjestelmästä. Muutokset tehdään HTJ:ssä.
          </Notice>
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-2">
        <ShareGroupForm companyId={id} values={group} buildings={buildings} readOnly={!canWrite || group.source === "htj"} />

        <div className="grid content-start gap-6">
          <Panel>
            <SectionTitle>Omistajat</SectionTitle>
            {owners.length === 0 ? <p className="text-sm text-ink/65">Omistajia ei ole kirjattu.</p> : null}
            {owners.length > 0 && Math.abs(shareSum - 1) > 0.001 ? (
              <div className="mb-3">
                <Notice tone="alert" title={`Omistusosuudet ovat yhteensä ${Math.round(shareSum * 100)} %`} />
              </div>
            ) : null}
            <ul className="divide-y divide-line">
              {owners.map((o) => (
                <li key={o.id} className="flex items-start justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="font-semibold">{o.display_name}</p>
                    <p className="text-sm text-ink/60">
                      Osuus {formatFraction(o.share_numerator ?? 1, o.share_denominator ?? 1)} · alkaen {formatDate(o.starts_on)} · {SOURCE[o.source ?? "manual"]}
                    </p>
                    <p className="text-sm text-ink/60">{[o.email, o.phone].filter(Boolean).join(" · ") || "Ei yhteystietoja"}</p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    {o.has_portal ? <Badge tone="info">Portaalissa</Badge> : null}
                    {canInvite ? <InvitePartyButton partyId={o.party_id} companyId={id} role="owner" hasEmail={!!o.email} hasPortal={o.has_portal} /> : null}
                    {canWrite && o.source !== "htj" ? (
                      <form action={endRelation}>
                        <input type="hidden" name="company_id" value={id} />
                        <input type="hidden" name="share_group_id" value={gid} />
                        <input type="hidden" name="relation" value="ownership" />
                        <input type="hidden" name="id" value={o.id} />
                        <button className="text-xs text-coral">Päätä omistus</button>
                      </form>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel>
            <SectionTitle>Asukkaat</SectionTitle>
            {residents.length === 0 ? <p className="text-sm text-ink/65">Asukkaita ei ole kirjattu.</p> : null}
            <ul className="divide-y divide-line">
              {residents.map((r) => (
                <li key={r.id} className="flex items-start justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="font-semibold">{r.display_name}</p>
                    <p className="text-sm text-ink/60">
                      {RESIDENT_ROLE[r.role ?? "other"]} · alkaen {formatDate(r.starts_on)}
                    </p>
                    <p className="text-sm text-ink/60">{[r.email, r.phone].filter(Boolean).join(" · ") || "Ei yhteystietoja"}</p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    {r.has_portal ? <Badge tone="info">Portaalissa</Badge> : null}
                    {canInvite ? <InvitePartyButton partyId={r.party_id} companyId={id} role="resident" hasEmail={!!r.email} hasPortal={r.has_portal} /> : null}
                    {canWrite ? (
                      <form action={endRelation}>
                        <input type="hidden" name="company_id" value={id} />
                        <input type="hidden" name="share_group_id" value={gid} />
                        <input type="hidden" name="relation" value="residency" />
                        <input type="hidden" name="id" value={r.id} />
                        <button className="text-xs text-coral">Päätä asuminen</button>
                      </form>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel>
            <SectionTitle>Pohjapiirustus ja liitteet</SectionTitle>
            {documents.length === 0 ? <p className="text-sm text-ink/65">Huoneistolle ei ole tallennettu liitteitä.</p> : null}
            <ul className="grid gap-4">
              {documents.map((d) => (
                <li key={d.id} className="grid gap-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <a href={`/api/dokumentit/${d.id}`} target="_blank" rel="noopener" className="font-semibold hover:text-sky">
                      {d.title}
                    </a>
                    <span className="flex items-center gap-2">
                      <span className="text-xs text-ink/55">{CATEGORY_LABEL[d.category as DocumentCategory] ?? d.category}</span>
                      <Badge tone={VISIBILITY_TONE[d.visibility] ?? "neutral"}>{VISIBILITY_LABEL[d.visibility] ?? d.visibility}</Badge>
                      <a href={`/api/dokumentit/${d.id}?lataa=1`} className="text-sm text-sky">
                        Lataa
                      </a>
                    </span>
                  </div>
                  {d.mime_type.startsWith("image/") ? (
                    <a href={`/api/dokumentit/${d.id}`} target="_blank" rel="noopener" className="block overflow-hidden rounded-xl border border-line bg-white">
                      {/* eslint-disable-next-line @next/next/no-img-element -- suojattu reitti, ei next/image-optimointia */}
                      <img src={`/api/dokumentit/${d.id}`} alt={d.title} width={1200} height={900} className="h-auto w-full" />
                    </a>
                  ) : null}
                </li>
              ))}
            </ul>
          </Panel>

          {canWrite ? (
            <Panel>
              <SectionTitle>Lisää omistaja tai asukas</SectionTitle>
              <form action={addPartyToShareGroup} className="grid gap-4 sm:grid-cols-2">
                <input type="hidden" name="company_id" value={id} />
                <input type="hidden" name="share_group_id" value={gid} />
                <Field label="Lisätään" htmlFor="relation">
                  <Select id="relation" name="relation" defaultValue="residency">
                    <option value="ownership">Omistajaksi</option>
                    <option value="residency">Asukkaaksi</option>
                  </Select>
                </Field>
                <Field label="Rooli" htmlFor="role" hint="Omistajalle: asuuko itse huoneistossa">
                  <Select id="role" name="role" defaultValue="tenant">
                    <option value="owner">Asuu itse / omistaja-asukas</option>
                    <option value="tenant">Vuokralainen</option>
                    <option value="other">Muu</option>
                  </Select>
                </Field>
                <Field label="Etunimet" htmlFor="first_names">
                  <Input id="first_names" name="first_names" />
                </Field>
                <Field label="Sukunimi" htmlFor="last_name">
                  <Input id="last_name" name="last_name" required />
                </Field>
                <Field label="Sähköposti" htmlFor="email">
                  <Input id="email" name="email" type="email" />
                </Field>
                <Field label="Puhelin" htmlFor="phone">
                  <Input id="phone" name="phone" type="tel" />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Osuus" htmlFor="share_numerator">
                    <Input id="share_numerator" name="share_numerator" inputMode="numeric" defaultValue="1" />
                  </Field>
                  <Field label="/" htmlFor="share_denominator">
                    <Input id="share_denominator" name="share_denominator" inputMode="numeric" defaultValue="1" />
                  </Field>
                </div>
                <Field label="Alkaen" htmlFor="starts_on">
                  <Input id="starts_on" name="starts_on" type="date" />
                </Field>
                <div className="sm:col-span-2">
                  <Button variant="secondary">Lisää</Button>
                </div>
              </form>
            </Panel>
          ) : null}
        </div>
      </div>
    </>
  );
}
