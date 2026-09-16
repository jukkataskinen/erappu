import "server-only";
import type { Sql } from "@/lib/db";
import { audit } from "@/lib/audit";
import { formatDate } from "@/lib/format";
import { queueMessage } from "@/lib/messaging";
import { createAccessLink, revokeAccessLinks } from "@/lib/security/access-links";
import { CATEGORY_LABEL, type Category, type RequestStatus } from "@/lib/service-requests/labels";
import { appBaseUrl } from "@/lib/service-requests/messages";
import { orderFromProvider, RequestError } from "@/lib/service-requests/mutations";
import { FINISHED_STATUSES } from "@/lib/service-requests/status";
import { estimateEur, MARKETPLACE_LINK_DAYS, needsApproval, reservationExpiry, validateReservation, type ListingStatus } from "./rules";

/**
 * Torin kirjoitukset (0096). Henkilökunnan toiminnot ajetaan käyttäjän
 * RLS-transaktiossa, palveluntuottajan toiminnot torilinkin kautta palvelun
 * roolilla: silloin rajaus tehdään tässä (organisaatio, hyväksyntä, yhtiön
 * torisäännöt), koska RLS ei ole käytössä.
 *
 * Viesteihin ei kirjoiteta pyynnön vapaata kuvausta eikä ilmoittajan tietoja
 * (sama periaate kuin huoltopyyntöjen viesteissä).
 */

export class MarketplaceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MarketplaceError";
  }
}

const PROVIDER_ACTOR = { userId: null, providerActor: true } as const;

async function event(tx: Sql, requestId: string, body: string, visibility: "internal" | "reporter", actor: { userId: string | null; providerActor?: boolean }) {
  await tx.query(
    `insert into er_service_request_events (request_id, type, body, visibility, user_id, provider_actor) values ($1,'marketplace',$2,$3,$4,$5)`,
    [requestId, body, visibility, actor.userId, actor.providerActor ?? false],
  );
}

/** Yhtiön vastuuisännöitsijä tai, jos sitä ei ole, organisaation omistajat ja isännöitsijät. */
async function managerEmails(tx: Sql, companyId: string): Promise<string[]> {
  const rows = await tx.query<{ email: string }>(
    `select distinct u.email from er_users u
      where u.email is not null and u.id in (
        select c.manager_user_id from er_housing_companies c where c.id = $1 and c.manager_user_id is not null
        union
        select m.user_id from er_org_members m join er_housing_companies c on c.organization_id = m.organization_id
         where c.id = $1 and c.manager_user_id is null and m.role in ('owner', 'manager'))`,
    [companyId],
  );
  return rows.map((r) => r.email);
}

interface ListingRow {
  id: string;
  organization_id: string;
  company_id: string;
  request_id: string;
  status: ListingStatus;
  provider_id: string | null;
  estimated_on: string | null;
  estimated_hours: string | null;
  hourly_rate_eur: string | null;
}

async function lockListing(tx: Sql, id: string): Promise<ListingRow | null> {
  const [row] = await tx.query<ListingRow>(
    `select id, organization_id, company_id, request_id, status, provider_id, estimated_on::text, estimated_hours::text, hourly_rate_eur::text
       from er_marketplace_listings where id = $1 for update`,
    [id],
  );
  return row ?? null;
}

// ---------------------------------------------------------------------------
// Henkilökunta
// ---------------------------------------------------------------------------

/** Vie huoltopyynnön torille. Kiireellisiä ei viedä, eikä yhtiöön, jolla ei ole hallituksen päätöstä. */
export async function listOnMarketplace(tx: Sql, opts: { requestId: string; summary: string; userId: string }): Promise<string> {
  const summary = opts.summary.trim();
  if (summary.length < 5 || summary.length > 300) throw new MarketplaceError("Kirjoita torille lyhyt kuvaus (5–300 merkkiä).");
  const [r] = await tx.query<{
    id: string; organization_id: string; company_id: string; status: RequestStatus; urgency: string; ordered_at: string | null;
    marketplace_enabled: boolean;
  }>(
    `select r.id, r.organization_id, r.company_id, r.status, r.urgency, r.ordered_at::text, c.marketplace_enabled
       from er_service_requests r join er_housing_companies c on c.id = r.company_id
      where r.id = $1 for update of r`,
    [opts.requestId],
  );
  if (!r) throw new MarketplaceError("Huoltopyyntöä ei löytynyt.");
  if (!r.marketplace_enabled) throw new MarketplaceError("Yhtiöllä ei ole hallituksen päätöstä torin käytöstä.");
  if (r.urgency === "urgent") throw new MarketplaceError("Kiireellistä vikaa ei viedä torille. Tilaa se suoraan päivystäjältä.");
  if (FINISHED_STATUSES.includes(r.status)) throw new MarketplaceError("Valmista tai suljettua pyyntöä ei voi viedä torille.");
  if (r.status === "in_progress") throw new MarketplaceError("Työ on jo käynnissä.");

  const [existing] = await tx.query<{ id: string; status: ListingStatus }>("select id, status from er_marketplace_listings where request_id = $1 for update", [r.id]);
  if (existing && ["open", "pending_approval", "reserved"].includes(existing.status)) throw new MarketplaceError("Pyyntö on jo torilla.");

  // Aiempi tilaus ja tehtävälinkki eivät jää voimaan torin rinnalle.
  await revokeAccessLinks(tx, "er_service_requests", r.id, "provider_task");
  await tx.query("update er_service_requests set provider_id = null, ordered_at = null, provider_acknowledged_at = null where id = $1", [r.id]);

  let id: string;
  if (existing) {
    await tx.query(
      `update er_marketplace_listings set status = 'open', summary = $2, listed_by = $3, listed_at = now(), provider_id = null, reserved_at = null,
              reserve_expires_at = null, estimated_on = null, estimated_hours = null, hourly_rate_eur = null, approved_at = null, approved_by = null,
              closed_at = null, updated_at = now()
        where id = $1`,
      [existing.id, summary, opts.userId],
    );
    id = existing.id;
  } else {
    const rows = await tx.query<{ id: string }>(
      "insert into er_marketplace_listings (organization_id, company_id, request_id, summary, listed_by) values ($1,$2,$3,$4,$5) returning id",
      [r.organization_id, r.company_id, r.id, summary, opts.userId],
    );
    if (rows.length === 0) throw new MarketplaceError("Roolillasi ei voi viedä pyyntöjä torille.");
    id = rows[0].id;
  }
  await event(tx, r.id, `Viety torille: ${summary}`, "internal", { userId: opts.userId });
  await audit(tx, { organizationId: r.organization_id, userId: opts.userId, action: "list", entity: "marketplace_listing", entityId: id, details: { request_id: r.id } });
  return id;
}

/** Poistaa torilta. Varattu työ perutaan ja tehtävälinkki mitätöidään. */
export async function cancelListing(tx: Sql, opts: { listingId: string; userId: string }): Promise<void> {
  const l = await lockListing(tx, opts.listingId);
  if (!l) throw new MarketplaceError("Torilistausta ei löytynyt.");
  if (!["open", "pending_approval", "reserved"].includes(l.status)) throw new MarketplaceError("Listaus ei ole enää torilla.");
  const rows = await tx.query("update er_marketplace_listings set status = 'cancelled', closed_at = now(), updated_at = now() where id = $1 returning id", [l.id]);
  if (rows.length === 0) throw new MarketplaceError("Roolillasi ei voi muuttaa toria.");
  if (l.provider_id) {
    await revokeAccessLinks(tx, "er_service_requests", l.request_id, "provider_task");
    await tx.query("update er_service_requests set provider_id = null, ordered_at = null, provider_acknowledged_at = null where id = $1 and provider_id = $2", [l.request_id, l.provider_id]);
    await notifyProvider(tx, l, "Torivaraus peruttu", "Isännöinti perui torilta varaamasi työn. Tehtävälinkki ei ole enää voimassa.");
  }
  await event(tx, l.request_id, "Poistettu torilta.", "internal", { userId: opts.userId });
  await audit(tx, { organizationId: l.organization_id, userId: opts.userId, action: "cancel", entity: "marketplace_listing", entityId: l.id });
}

/**
 * Hyväksyy rajan ylittävän varauksen: työ tilataan varaajalta ja varauksen
 * viikko alkaa hyväksynnästä. Palauttaa tehtävälinkin ja viestin, jotka
 * isännöitsijä voi jakaa (sähköposti lähtee lisäksi, jos osoite on kirjattu).
 */
export async function approveReservation(tx: Sql, opts: { listingId: string; userId: string }): Promise<{ link: string; shareText: string; emailed: boolean }> {
  const l = await lockListing(tx, opts.listingId);
  if (!l || l.status !== "pending_approval" || !l.provider_id) throw new MarketplaceError("Hyväksyttävää varausta ei löytynyt.");
  const now = new Date();
  const rows = await tx.query(
    "update er_marketplace_listings set status = 'reserved', approved_at = now(), approved_by = $2, reserve_expires_at = $3, updated_at = now() where id = $1 returning id",
    [l.id, opts.userId, reservationExpiry(now).toISOString()],
  );
  if (rows.length === 0) throw new MarketplaceError("Roolillasi ei voi hyväksyä varauksia.");
  const [p] = await tx.query<{ email: string | null }>("select email from er_service_providers where id = $1", [l.provider_id]);
  await tx.query("update er_service_requests set provider_id = $2 where id = $1", [l.request_id, l.provider_id]);
  const order = await orderFromProvider(tx, { requestId: l.request_id, actor: { userId: opts.userId }, channel: p?.email ? "email" : "marketplace" });
  await announceReservation(tx, l.id, { userId: opts.userId });
  await audit(tx, { organizationId: l.organization_id, userId: opts.userId, action: "approve", entity: "marketplace_listing", entityId: l.id });
  return { link: order.link, shareText: order.shareText, emailed: !!p?.email };
}

/** Hylkää rajan ylittävän varauksen: pyyntö palaa torille muille. */
export async function rejectReservation(tx: Sql, opts: { listingId: string; userId: string }): Promise<void> {
  const l = await lockListing(tx, opts.listingId);
  if (!l || l.status !== "pending_approval") throw new MarketplaceError("Hyväksyttävää varausta ei löytynyt.");
  await reopen(tx, l);
  await notifyProvider(tx, l, "Torivarausta ei hyväksytty", "Isännöinti ei hyväksynyt varaustasi, koska arvio ylitti yhtiön rajan. Työ palasi torille.");
  await event(tx, l.request_id, "Rajan ylittävää varausta ei hyväksytty. Pyyntö palasi torille.", "internal", { userId: opts.userId });
  await audit(tx, { organizationId: l.organization_id, userId: opts.userId, action: "reject", entity: "marketplace_listing", entityId: l.id });
}

async function reopen(tx: Sql, l: ListingRow) {
  await tx.query(
    `update er_marketplace_listings set status = 'open', provider_id = null, reserved_at = null, reserve_expires_at = null, estimated_on = null,
            estimated_hours = null, hourly_rate_eur = null, approved_at = null, approved_by = null, updated_at = now()
      where id = $1`,
    [l.id],
  );
}

async function notifyProvider(tx: Sql, l: ListingRow, subject: string, body: string) {
  if (!l.provider_id) return;
  const [p] = await tx.query<{ email: string | null }>("select email from er_service_providers where id = $1", [l.provider_id]);
  if (!p?.email) return;
  await queueMessage(tx, { organizationId: l.organization_id, recipient: p.email, subject, body: `${body}\n\nTämä on automaattinen viesti isännöinnistä.`, subjectTable: "er_marketplace_listings", subjectId: l.id });
}

/** Tieto varauksesta ilmoittajalle (tapahtuma portaaliin ja viesti) ja isännöitsijälle. */
async function announceReservation(tx: Sql, listingId: string, actor: { userId: string | null; providerActor?: boolean }) {
  const [x] = await tx.query<{
    request_id: string; organization_id: string; company_id: string; number: number; category: Category; company_name: string; provider_name: string;
    estimated_on: string; reporter_email: string | null; reporter_user_id: string | null;
  }>(
    `select l.request_id, l.organization_id, l.company_id, r.number, r.category, c.name as company_name, p.name as provider_name, l.estimated_on::text,
            r.reporter_email, r.reporter_user_id
       from er_marketplace_listings l
       join er_service_requests r on r.id = l.request_id
       join er_housing_companies c on c.id = l.company_id
       join er_service_providers p on p.id = l.provider_id
      where l.id = $1`,
    [listingId],
  );
  const when = formatDate(x.estimated_on);
  await event(tx, x.request_id, `Työn on varannut ${x.provider_name}. Arvioitu toteutus ${when}.`, "reporter", actor);
  if (x.reporter_email) {
    const portal = x.reporter_user_id ? `\n\nNäet pyynnön tiedot portaalissa: ${appBaseUrl()}/portaali/huoltopyynnot/${x.request_id}` : "";
    await queueMessage(tx, {
      organizationId: x.organization_id, recipient: x.reporter_email,
      subject: `Huoltopyyntö #${x.number}: työ on varattu`,
      body: `Huoltopyyntösi (${CATEGORY_LABEL[x.category].toLowerCase()}, ${x.company_name}) työn on varannut ${x.provider_name}.\nArvioitu toteutus: ${when}.${portal}`,
      subjectTable: "er_service_requests", subjectId: x.request_id,
    });
  }
}

// ---------------------------------------------------------------------------
// Palveluntuottaja (torilinkki, palvelun rooli)
// ---------------------------------------------------------------------------

export interface MarketplaceProvider {
  id: string;
  organizationId: string;
  name: string;
  hourlyRateEur: number | null;
}

/**
 * Varaa työn. Lukitsee listauksen, joten kaksi samanaikaista varaajaa ei voi
 * saada samaa työtä. Palauttaa tehtävälinkin, jos varaus tilattiin heti, tai
 * tiedon, että varaus odottaa isännöitsijän hyväksyntää.
 */
export async function reserveListing(
  tx: Sql,
  opts: { provider: MarketplaceProvider; listingId: string; estimatedOn: string; estimatedHours: number; today: string },
): Promise<{ status: "reserved"; link: string } | { status: "pending_approval"; estimateEur: number; limitEur: number }> {
  const invalid = validateReservation({ estimatedOn: opts.estimatedOn, estimatedHours: opts.estimatedHours }, opts.today);
  if (invalid) throw new MarketplaceError(invalid);
  if (!opts.provider.hourlyRateEur) throw new MarketplaceError("Tuntihintaasi ei ole kirjattu. Ilmoita tuntihinta isännöintiin ennen varaamista.");

  const [l] = await tx.query<ListingRow & { limit_eur: string | null; urgency: string }>(
    `select l.id, l.organization_id, l.company_id, l.request_id, l.status, l.provider_id, c.marketplace_limit_eur::text as limit_eur, r.urgency
       from er_marketplace_listings l
       join er_housing_companies c on c.id = l.company_id
       join er_service_requests r on r.id = l.request_id
      where l.id = $1 and l.organization_id = $2 and c.marketplace_enabled and c.management_ended_on is null
        and exists (select 1 from er_marketplace_approvals a
                     where a.provider_id = $3 and a.organization_id = l.organization_id and (a.company_id is null or a.company_id = l.company_id))
      for update of l`,
    [opts.listingId, opts.provider.organizationId, opts.provider.id],
  );
  if (!l) throw new MarketplaceError("Työtä ei löytynyt torilta.");
  if (l.status !== "open") throw new MarketplaceError("Joku ehti varata työn ensin.");

  const estimate = estimateEur(opts.estimatedHours, opts.provider.hourlyRateEur);
  const limit = Number(l.limit_eur);
  const pending = needsApproval(estimate, limit);
  const now = new Date();
  await tx.query(
    `update er_marketplace_listings set status = $2, provider_id = $3, reserved_at = $4, reserve_expires_at = $5, estimated_on = $6, estimated_hours = $7,
            hourly_rate_eur = $8, updated_at = now()
      where id = $1`,
    [l.id, pending ? "pending_approval" : "reserved", opts.provider.id, now.toISOString(), reservationExpiry(now).toISOString(), opts.estimatedOn,
      opts.estimatedHours, opts.provider.hourlyRateEur],
  );
  const details = { provider_id: opts.provider.id, estimated_on: opts.estimatedOn, estimated_hours: opts.estimatedHours, estimate_eur: estimate };

  if (pending) {
    await event(tx, l.request_id, `${opts.provider.name} varasi työn: arvio ${opts.estimatedHours} h × ${opts.provider.hourlyRateEur} €/h = ${estimate} €, ylittää yhtiön rajan ${limit} €. Odottaa hyväksyntää.`, "internal", PROVIDER_ACTOR);
    for (const email of await managerEmails(tx, l.company_id)) {
      await queueMessage(tx, {
        organizationId: l.organization_id, recipient: email, subject: "Torivaraus odottaa hyväksyntää",
        body: `${opts.provider.name} varasi torilta työn, jonka arvio (${estimate} €) ylittää yhtiön rajan (${limit} €). Hyväksy tai hylkää varaus eRapun huoltopyynnössä.`,
        subjectTable: "er_marketplace_listings", subjectId: l.id,
      });
    }
    await audit(tx, { organizationId: l.organization_id, userId: null, action: "reserve_pending", entity: "marketplace_listing", entityId: l.id, details });
    return { status: "pending_approval", estimateEur: estimate, limitEur: limit };
  }

  await tx.query("update er_service_requests set provider_id = $2 where id = $1", [l.request_id, opts.provider.id]);
  const order = await orderFromProvider(tx, { requestId: l.request_id, actor: PROVIDER_ACTOR, channel: "marketplace" });
  await announceReservation(tx, l.id, PROVIDER_ACTOR);
  for (const email of await managerEmails(tx, l.company_id)) {
    await queueMessage(tx, {
      organizationId: l.organization_id, recipient: email, subject: "Työ varattu torilta",
      body: `${opts.provider.name} varasi torilta työn. Arvio ${estimate} €, arvioitu toteutus ${formatDate(opts.estimatedOn)}.`,
      subjectTable: "er_marketplace_listings", subjectId: l.id,
    });
  }
  await audit(tx, { organizationId: l.organization_id, userId: null, action: "reserve", entity: "marketplace_listing", entityId: l.id, details });
  return { status: "reserved", link: order.link };
}

/** Uusi tehtävälinkki omaan varaukseen torilta (edellinen mitätöityy). */
export async function openReservedTask(tx: Sql, opts: { provider: MarketplaceProvider; listingId: string }): Promise<string> {
  const [l] = await tx.query<{ request_id: string; organization_id: string }>(
    `select l.request_id, l.organization_id from er_marketplace_listings l
       join er_service_requests r on r.id = l.request_id and r.provider_id = l.provider_id
      where l.id = $1 and l.organization_id = $2 and l.provider_id = $3 and l.status = 'reserved'`,
    [opts.listingId, opts.provider.organizationId, opts.provider.id],
  );
  if (!l) throw new MarketplaceError("Varausta ei löytynyt tai se ei ole enää voimassa.");
  await revokeAccessLinks(tx, "er_service_requests", l.request_id, "provider_task");
  const token = await createAccessLink(tx, {
    organizationId: l.organization_id, purpose: "provider_task", subjectTable: "er_service_requests", subjectId: l.request_id, expiresInDays: 30,
  });
  return token;
}

// ---------------------------------------------------------------------------
// Ajastettu ylläpito (palvelun rooli)
// ---------------------------------------------------------------------------

/**
 * Merkitsee tehdyt varaukset valmiiksi ja palauttaa torille varaukset, joiden
 * viikko on kulunut ilman, että työ on kuitattu tehdyksi. Idempotentti.
 */
export async function maintainMarketplace(tx: Sql, now = new Date()): Promise<{ completed: number; expired: number }> {
  const completed = await tx.query(
    `update er_marketplace_listings l set status = 'completed', closed_at = now(), updated_at = now()
       from er_service_requests r
      where r.id = l.request_id and l.status = 'reserved' and r.status in ('done', 'closed')
      returning l.id`,
  );
  const due = await tx.query<ListingRow & { request_status: RequestStatus; provider_name: string | null }>(
    `select l.id, l.organization_id, l.company_id, l.request_id, l.status, l.provider_id, l.estimated_on::text, l.estimated_hours::text, l.hourly_rate_eur::text,
            r.status as request_status, p.name as provider_name
       from er_marketplace_listings l
       join er_service_requests r on r.id = l.request_id
       left join er_service_providers p on p.id = l.provider_id
      where l.status in ('reserved', 'pending_approval') and l.reserve_expires_at < $1
        and r.status not in ('done', 'closed', 'rejected')
      for update of l`,
    [now.toISOString()],
  );
  for (const l of due) {
    await reopen(tx, l);
    if (l.status === "reserved") {
      await revokeAccessLinks(tx, "er_service_requests", l.request_id, "provider_task");
      await tx.query(
        "update er_service_requests set provider_id = null, ordered_at = null, provider_acknowledged_at = null, status = case when status in ('ordered', 'in_progress', 'waiting') then 'received' else status end where id = $1",
        [l.request_id],
      );
      await event(tx, l.request_id, "Varaus raukesi, koska työtä ei kuitattu tehdyksi viikon kuluessa. Työ palautettiin torille.", "reporter", PROVIDER_ACTOR);
    } else {
      await event(tx, l.request_id, "Hyväksyntää odottanut varaus raukesi viikon jälkeen. Pyyntö palasi torille.", "internal", PROVIDER_ACTOR);
    }
    await notifyProvider(tx, l, "Torivaraus raukesi", "Varaamaasi työtä ei kuitattu tehdyksi viikon kuluessa, joten varaus raukesi ja työ palasi torille. Tehtävälinkki ei ole enää voimassa.");
    for (const email of await managerEmails(tx, l.company_id)) {
      await queueMessage(tx, {
        organizationId: l.organization_id, recipient: email, subject: "Torivaraus raukesi",
        body: `${l.provider_name ?? "Palveluntuottajan"} varaus raukesi viikon jälkeen, ja työ palasi torille.`,
        subjectTable: "er_marketplace_listings", subjectId: l.id,
      });
    }
    await audit(tx, { organizationId: l.organization_id, userId: null, action: "expire", entity: "marketplace_listing", entityId: l.id });
  }
  return { completed: completed.length, expired: due.length };
}

// ---------------------------------------------------------------------------
// Torilinkki ja hyväksynnät (henkilökunta)
// ---------------------------------------------------------------------------

/** Uusi torilinkki palveluntuottajalle. Edellinen linkki mitätöityy. */
export async function createMarketplaceLink(tx: Sql, opts: { providerId: string; organizationId: string; userId: string }): Promise<string> {
  const [p] = await tx.query<{ id: string }>("select id from er_service_providers where id = $1 and organization_id = $2", [opts.providerId, opts.organizationId]);
  if (!p) throw new MarketplaceError("Palveluntuottajaa ei löytynyt.");
  await revokeAccessLinks(tx, "er_service_providers", p.id, "provider_marketplace");
  const token = await createAccessLink(tx, {
    organizationId: opts.organizationId, purpose: "provider_marketplace", subjectTable: "er_service_providers", subjectId: p.id,
    expiresInDays: MARKETPLACE_LINK_DAYS, createdBy: opts.userId,
  });
  await audit(tx, { organizationId: opts.organizationId, userId: opts.userId, action: "create", entity: "marketplace_link", entityId: p.id });
  return `${appBaseUrl()}/tori/${token}`;
}

export async function revokeMarketplaceLinks(tx: Sql, opts: { providerId: string; organizationId: string; userId: string }): Promise<void> {
  await revokeAccessLinks(tx, "er_service_providers", opts.providerId, "provider_marketplace");
  await audit(tx, { organizationId: opts.organizationId, userId: opts.userId, action: "revoke", entity: "marketplace_link", entityId: opts.providerId });
}

export async function setApproval(tx: Sql, opts: { providerId: string; organizationId: string; companyId: string | null; approved: boolean; userId: string }): Promise<void> {
  if (opts.approved) {
    const exists = await tx.query(
      "select 1 from er_marketplace_approvals where provider_id = $1 and company_id is not distinct from $2",
      [opts.providerId, opts.companyId],
    );
    if (exists.length === 0) {
      const rows = await tx.query(
        "insert into er_marketplace_approvals (organization_id, provider_id, company_id, created_by) values ($1,$2,$3,$4) returning id",
        [opts.organizationId, opts.providerId, opts.companyId, opts.userId],
      );
      if (rows.length === 0) throw new MarketplaceError("Roolillasi ei voi hyväksyä palveluntuottajia torille.");
    }
  } else {
    await tx.query("delete from er_marketplace_approvals where provider_id = $1 and company_id is not distinct from $2", [opts.providerId, opts.companyId]);
  }
  await audit(tx, {
    organizationId: opts.organizationId, userId: opts.userId, action: opts.approved ? "approve" : "unapprove", entity: "marketplace_approval", entityId: opts.providerId,
    details: { company_id: opts.companyId },
  });
}

export { RequestError };
