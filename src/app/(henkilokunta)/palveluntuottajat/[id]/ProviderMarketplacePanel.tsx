import Link from "next/link";
import { Badge, Button, Field, Input, Panel, SectionTitle, Select } from "@/components/ui";
import { formatDate, formatDateTime } from "@/lib/format";
import type { ProviderMarketplaceInfo } from "@/lib/marketplace/queries";
import { revokeProviderMarketplaceLink, setHourlyRate, setMarketplaceApproval } from "../tori-actions";
import { MarketplaceLinkShare } from "./MarketplaceLinkShare";

/** Palveluntuottajan torikohta: tuntihinta, hyväksyntä organisaatiolle tai yhtiöille ja henkilökohtainen torilinkki. */
export function ProviderMarketplacePanel({
  providerId,
  info,
  companies,
  canWrite,
}: {
  providerId: string;
  info: ProviderMarketplaceInfo;
  companies: { id: string; name: string }[];
  canWrite: boolean;
}) {
  const approvedCompanies = companies.filter((c) => info.company_ids.includes(c.id));
  const otherCompanies = companies.filter((c) => !info.company_ids.includes(c.id));

  return (
    <Panel id="tori">
      <SectionTitle actions={info.org_wide || approvedCompanies.length ? <Badge tone="ok">Hyväksytty torille</Badge> : <Badge tone="neutral">Ei torilla</Badge>}>
        Tori
      </SectionTitle>
      <p className="mb-4 text-sm text-ink/65">
        Hyväksytty palveluntuottaja näkee torilinkistään vapaat työt ja voi varata niitä tuntihinnallaan. Yhtiön töitä näkyy vain, jos yhtiön hallitus on päättänyt torin
        käytöstä (yhtiön Huolto-välilehti).
      </p>

      <div className="grid gap-5">
        <form action={setHourlyRate} className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
          <input type="hidden" name="provider_id" value={providerId} />
          <Field label="Tuntihinta (€/h, sis. alv)" htmlFor="hourly_rate_eur" hint="Varauksen arvio lasketaan tuntiarvio × tuntihinta. Ilman tuntihintaa töitä ei voi varata.">
            <Input id="hourly_rate_eur" name="hourly_rate_eur" inputMode="decimal" defaultValue={info.hourly_rate_eur ?? ""} disabled={!canWrite} />
          </Field>
          {canWrite ? (
            <Button type="submit" variant="secondary">
              Tallenna
            </Button>
          ) : null}
        </form>

        <div className="grid gap-2">
          <p className="text-sm font-semibold">Hyväksyntä</p>
          <form action={setMarketplaceApproval} className="flex flex-wrap items-center gap-3">
            <input type="hidden" name="provider_id" value={providerId} />
            <input type="hidden" name="company_id" value="" />
            <input type="hidden" name="approved" value={info.org_wide ? "0" : "1"} />
            <span className="text-sm">{info.org_wide ? "Hyväksytty koko organisaatiolle: näkee kaikkien yhtiöiden torityöt." : "Ei hyväksytty koko organisaatiolle."}</span>
            {canWrite ? (
              <button className="text-sm font-semibold text-sky">{info.org_wide ? "Poista organisaation hyväksyntä" : "Hyväksy koko organisaatiolle"}</button>
            ) : null}
          </form>
          {approvedCompanies.length ? (
            <ul className="divide-y divide-line text-sm">
              {approvedCompanies.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-2 py-2">
                  <Link href={`/taloyhtiot/${c.id}/huolto`} className="hover:text-sky">
                    {c.name}
                  </Link>
                  {canWrite ? (
                    <form action={setMarketplaceApproval}>
                      <input type="hidden" name="provider_id" value={providerId} />
                      <input type="hidden" name="company_id" value={c.id} />
                      <input type="hidden" name="approved" value="0" />
                      <button className="text-xs text-coral">Poista</button>
                    </form>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
          {canWrite && otherCompanies.length && !info.org_wide ? (
            <form action={setMarketplaceApproval} className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
              <input type="hidden" name="provider_id" value={providerId} />
              <input type="hidden" name="approved" value="1" />
              <Field label="Hyväksy yhtiölle" htmlFor="tori_company_id">
                <Select id="tori_company_id" name="company_id" required defaultValue="">
                  <option value="" disabled>
                    Valitse yhtiö
                  </option>
                  {otherCompanies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Button type="submit" variant="secondary">
                Hyväksy
              </Button>
            </form>
          ) : null}
        </div>

        <div className="grid gap-2">
          <p className="text-sm font-semibold">Torilinkki</p>
          <p className="text-sm text-ink/65">
            {info.link_expires_at
              ? `Voimassa ${formatDate(info.link_expires_at)} asti${info.link_last_used_at ? `, avattu viimeksi ${formatDateTime(info.link_last_used_at)}` : ", ei vielä avattu"}.`
              : "Palveluntuottajalla ei ole voimassa olevaa torilinkkiä."}
          </p>
          {canWrite ? <MarketplaceLinkShare providerId={providerId} hasLink={!!info.link_expires_at} /> : null}
          {canWrite && info.link_expires_at ? (
            <form action={revokeProviderMarketplaceLink}>
              <input type="hidden" name="provider_id" value={providerId} />
              <button className="text-xs text-coral">Mitätöi torilinkki</button>
            </form>
          ) : null}
        </div>
      </div>
    </Panel>
  );
}
