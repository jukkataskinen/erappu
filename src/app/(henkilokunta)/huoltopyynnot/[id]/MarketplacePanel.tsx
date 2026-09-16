import { Badge, Button, Notice, Panel, SectionTitle, Textarea } from "@/components/ui";
import { formatDate, formatDateTime, formatEur, formatNumber } from "@/lib/format";
import type { CompanyMarketplace, StaffListing } from "@/lib/marketplace/queries";
import { estimateEur, LISTING_STATUS_LABEL } from "@/lib/marketplace/rules";
import { cancelMarketplaceListing, listRequestOnMarketplace, rejectMarketplaceReservation } from "../tori-actions";
import { ApproveReservation } from "./ApproveReservation";

const MESSAGES: Record<string, string> = {
  listattu: "Pyyntö on torilla. Hyväksytyt palveluntuottajat näkevät sen torilinkistään.",
  poistettu: "Pyyntö poistettiin torilta.",
  hylatty: "Varaus hylättiin, ja pyyntö palasi torille.",
};

/**
 * Huoltopyynnön torikohta henkilökunnalle: vienti torille, varauksen tila,
 * rajan ylittävän varauksen hyväksyntä ja poisto torilta.
 */
export function MarketplacePanel({
  requestId,
  urgent,
  finished,
  company,
  listing,
  canWrite,
  message,
  categoryLabel,
}: {
  requestId: string;
  urgent: boolean;
  finished: boolean;
  company: CompanyMarketplace | null;
  listing: StaffListing | null;
  canWrite: boolean;
  message?: string;
  categoryLabel: string;
}) {
  const active = listing && ["open", "pending_approval", "reserved"].includes(listing.status);
  const estimate = listing?.estimated_hours && listing.hourly_rate_eur ? estimateEur(Number(listing.estimated_hours), Number(listing.hourly_rate_eur)) : null;

  return (
    <Panel id="tori">
      <SectionTitle actions={listing ? <Badge tone={listing.status === "pending_approval" ? "warn" : listing.status === "reserved" ? "ok" : "neutral"}>{LISTING_STATUS_LABEL[listing.status]}</Badge> : null}>
        Tori
      </SectionTitle>
      {message && MESSAGES[message] ? (
        <div className="mb-3">
          <Notice tone="ok" title={MESSAGES[message]} />
        </div>
      ) : null}

      {listing && active ? (
        <div className="grid gap-3 text-sm">
          <p className="whitespace-pre-wrap break-words">{listing.summary}</p>
          <p className="text-xs text-ink/60">Torilla {formatDateTime(listing.listed_at)} alkaen.</p>
          {listing.provider_name ? (
            <div className="rounded-xl border border-line bg-cloud/50 p-3">
              <p className="font-semibold">{listing.provider_name}</p>
              <p className="text-ink/70">
                Arvio {formatNumber(listing.estimated_hours, "h")} × {formatEur(listing.hourly_rate_eur)}/h = <span className="font-semibold">{formatEur(estimate)}</span>
                {listing.limit_eur ? ` (yhtiön raja ${formatEur(listing.limit_eur)})` : ""}
              </p>
              <p className="text-ink/70">Arvioitu toteutus {formatDate(listing.estimated_on)}</p>
              <p className="text-xs text-ink/55">Varaus voimassa {formatDateTime(listing.reserve_expires_at)} asti, jos työtä ei ole kuitattu valmiiksi.</p>
            </div>
          ) : null}
          {canWrite && listing.status === "pending_approval" ? (
            <div className="grid gap-2">
              <Notice tone="warn" title="Arvio ylittää yhtiön rajan">
                Hyväksy, jos työ tilataan tältä tekijältä tällä arviolla. Hylkäys palauttaa työn torille muille.
              </Notice>
              <ApproveReservation requestId={requestId} listingId={listing.id} />
              <form action={rejectMarketplaceReservation}>
                <input type="hidden" name="request_id" value={requestId} />
                <input type="hidden" name="listing_id" value={listing.id} />
                <Button type="submit" variant="ghost" className="px-0 text-sm text-coral">
                  Hylkää varaus
                </Button>
              </form>
            </div>
          ) : null}
          {canWrite ? (
            <form action={cancelMarketplaceListing}>
              <input type="hidden" name="request_id" value={requestId} />
              <input type="hidden" name="listing_id" value={listing.id} />
              <Button type="submit" variant="secondary">
                {listing.status === "open" ? "Poista torilta" : "Peru varaus ja poista torilta"}
              </Button>
            </form>
          ) : null}
        </div>
      ) : !canWrite ? (
        <p className="text-sm text-ink/65">Pyyntö ei ole torilla.</p>
      ) : !company?.marketplace_enabled ? (
        <p className="text-sm text-ink/65">
          Yhtiöllä ei ole hallituksen päätöstä torin käytöstä. Päätös ja euroraja kirjataan yhtiön Huolto-välilehdellä.
        </p>
      ) : urgent ? (
        <p className="text-sm text-ink/65">Kiireellistä vikaa ei viedä torille. Tilaa se suoraan päivystäjältä.</p>
      ) : finished ? (
        <p className="text-sm text-ink/65">Valmista tai suljettua pyyntöä ei viedä torille.</p>
      ) : (
        <form action={listRequestOnMarketplace} className="grid gap-3">
          <input type="hidden" name="request_id" value={requestId} />
          {listing ? <p className="text-xs text-ink/60">Aiemmin torilla: {LISTING_STATUS_LABEL[listing.status].toLowerCase()}.</p> : null}
          <label htmlFor="tori-summary" className="text-sm font-semibold">
            Kuvaus torille
          </label>
          <Textarea id="tori-summary" name="summary" required minLength={5} maxLength={300} rows={3} defaultValue={listing?.summary ?? `${categoryLabel}: `} />
          <p className="text-xs text-ink/55">
            Näkyy kaikille hyväksytyille palveluntuottajille ennen varausta. Älä kirjoita osoitetta, huoneistoa tai asukkaan tietoja; ne näkyvät vasta varaajalle.
            Yhtiön raja {formatEur(company.marketplace_limit_eur)}, päätös {formatDate(company.marketplace_decided_on)}.
          </p>
          <div>
            <Button type="submit">Vie torille</Button>
          </div>
        </form>
      )}
    </Panel>
  );
}
