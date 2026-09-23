import "server-only";
import type { Sql } from "@/lib/db";
import { audit } from "@/lib/audit";
import { formatDate } from "@/lib/format";
import { queueMessage } from "@/lib/messaging";
import { createAccessLink, revokeAccessLinks } from "@/lib/security/access-links";
import type { Category, CostResponsibility, EventVisibility, RequestStatus, Urgency } from "./labels";
import { PROVIDER_LINK_DAYS, providerOrderMessage, providerPromiseMessage, providerShareText, receivedConfirmationMessage, statusChangeMessage } from "./messages";
import { canStaffTransition, isOpen, notifyReporterOfStatus } from "./status";

/**
 * Huoltopyynnön muutokset. Jokainen muutos, sen tapahtuma ja siihen liittyvä
 * ilmoitus kirjoitetaan samassa transaktiossa (CLAUDE.md 0.1 kohta 6).
 * Funktiot toimivat sekä käyttäjän RLS-transaktiossa että palvelun roolilla
 * (tehtävälinkki, julkinen lomake); kutsuja vastaa rajauksesta.
 */

export class RequestError extends Error {}

export interface Actor {
  userId: string | null;
  providerActor?: boolean;
}

interface LockedRequest {
  id: string;
  organization_id: string;
  company_id: string;
  company_name: string;
  company_address: string | null;
  number: number;
  status: RequestStatus;
  category: Category;
  urgency: Urgency;
  source: string;
  reporter_user_id: string | null;
  reporter_email: string | null;
  provider_id: string | null;
  provider_name: string | null;
  provider_email: string | null;
  assignee_user_id: string | null;
  due_on: string | null;
  share_group_id: string | null;
  cost_responsibility: CostResponsibility;
  cost_eur: string | null;
  provider_acknowledged_at: string | Date | null;
  provider_promised_on: string | null;
}

export async function lockRequest(tx: Sql, id: string): Promise<LockedRequest> {
  const [row] = await tx.query<LockedRequest>(
    `select r.id, r.organization_id, r.company_id, c.name as company_name,
            nullif(concat_ws(', ', c.street_address, nullif(concat_ws(' ', c.postal_code, c.city), '')), '') as company_address,
            r.number, r.status, r.category, r.urgency, r.source, r.reporter_user_id, r.reporter_email,
            r.provider_id, p.name as provider_name, p.email as provider_email, r.assignee_user_id, r.due_on::text as due_on,
            r.share_group_id, r.cost_responsibility, r.cost_eur, r.provider_acknowledged_at, r.provider_promised_on::text as provider_promised_on
       from er_service_requests r
       join er_housing_companies c on c.id = r.company_id
       left join er_service_providers p on p.id = r.provider_id
      where r.id = $1
      for update of r`,
    [id],
  );
  if (!row) throw new RequestError("Huoltopyyntöä ei löytynyt.");
  return row;
}

async function addEvent(
  tx: Sql,
  e: { requestId: string; type: string; body?: string | null; oldStatus?: string | null; newStatus?: string | null; visibility: EventVisibility; actor: Actor },
) {
  await tx.query(
    `insert into er_service_request_events (request_id, type, body, old_status, new_status, visibility, user_id, provider_actor)
     values ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [e.requestId, e.type, e.body ?? null, e.oldStatus ?? null, e.newStatus ?? null, e.visibility, e.actor.userId, e.actor.providerActor ?? false],
  );
}

export async function addComment(tx: Sql, opts: { requestId: string; body: string; visibility: EventVisibility; actor: Actor }) {
  await addEvent(tx, { requestId: opts.requestId, type: "comment", body: opts.body, visibility: opts.visibility, actor: opts.actor });
}

export interface NewRequest {
  companyId: string;
  shareGroupId: string | null;
  unitText: string | null;
  title: string;
  description: string;
  category: Category;
  urgency: Urgency;
  mayUseMasterKey: boolean;
  hasPets: boolean;
  source: "staff" | "portal" | "public_form";
  reporterUserId: string | null;
  reporterName: string | null;
  reporterPhone: string | null;
  reporterEmail: string | null;
  assigneeUserId?: string | null;
  providerId?: string | null;
  dueOn?: string | null;
}

export async function createRequest(tx: Sql, r: NewRequest): Promise<{ id: string; number: number; organizationId: string }> {
  const [row] = await tx.query<{ id: string; number: number; organization_id: string }>(
    `insert into er_service_requests (organization_id, company_id, share_group_id, unit_text, title, description, category, urgency,
        may_use_master_key, has_pets, source, reporter_user_id, reporter_name, reporter_phone, reporter_email,
        assignee_user_id, provider_id, due_on, status)
     select c.organization_id, c.id, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, 'new'
       from er_housing_companies c where c.id = $1
     returning id, number, organization_id`,
    [r.companyId, r.shareGroupId, r.unitText, r.title, r.description, r.category, r.urgency, r.mayUseMasterKey, r.hasPets, r.source,
      r.reporterUserId, r.reporterName, r.reporterPhone, r.reporterEmail, r.assigneeUserId ?? null, r.providerId ?? null, r.dueOn ?? null],
  );
  if (!row) throw new RequestError("Yhtiötä ei löytynyt.");
  // Luontitapahtuma kirjataan kannan triggerissä.
  return { id: row.id, number: row.number, organizationId: row.organization_id };
}

/** Vahvistus julkisen lomakkeen ilmoittajalle (vain jos sähköposti annettu). */
export async function queueReceivedConfirmation(tx: Sql, opts: { requestId: string; email: string | null }) {
  if (!opts.email) return;
  const r = await lockRequest(tx, opts.requestId);
  const msg = receivedConfirmationMessage({ number: r.number, category: r.category, companyName: r.company_name });
  await queueMessage(tx, { organizationId: r.organization_id, recipient: opts.email, subject: msg.subject, body: msg.body, subjectTable: "er_service_requests", subjectId: r.id });
  await addEvent(tx, { requestId: r.id, type: "notification", body: "Vastaanottovahvistus jonossa ilmoittajalle.", visibility: "internal", actor: { userId: null } });
}

/**
 * Tilamuutos. `mode` kertoo, kenen säännöillä siirtymä tarkistetaan:
 * henkilökunta käyttää staffTransitions-taulukkoa, palveluntuottajan
 * siirtymä on tarkistettu jo kutsujassa.
 */
export async function changeStatus(
  tx: Sql,
  opts: { requestId: string; to: RequestStatus; actor: Actor; mode: "staff" | "provider"; comment?: string | null; commentVisibility?: EventVisibility },
): Promise<{ changed: boolean }> {
  const r = await lockRequest(tx, opts.requestId);
  if (r.status === opts.to) {
    if (opts.comment) await addComment(tx, { requestId: r.id, body: opts.comment, visibility: opts.commentVisibility ?? "internal", actor: opts.actor });
    return { changed: false };
  }
  if (opts.mode === "staff" && !canStaffTransition(r.status, opts.to)) {
    throw new RequestError("Tilaa ei voi vaihtaa suoraan valittuun tilaan.");
  }
  const rows = await tx.query("update er_service_requests set status = $2 where id = $1 returning id", [r.id, opts.to]);
  if (rows.length === 0) throw new RequestError("Roolillasi ei voi muuttaa pyynnön tilaa.");
  await addEvent(tx, { requestId: r.id, type: "status_change", oldStatus: r.status, newStatus: opts.to, visibility: "reporter", actor: opts.actor });
  if (opts.comment) await addComment(tx, { requestId: r.id, body: opts.comment, visibility: opts.commentVisibility ?? "internal", actor: opts.actor });

  const byReporter = !!opts.actor.userId && opts.actor.userId === r.reporter_user_id;
  if (r.reporter_email && notifyReporterOfStatus(opts.to, byReporter)) {
    const msg = statusChangeMessage({
      number: r.number, category: r.category, companyName: r.company_name, status: opts.to,
      portalRequestId: r.reporter_user_id ? r.id : null,
    });
    await queueMessage(tx, { organizationId: r.organization_id, recipient: r.reporter_email, subject: msg.subject, body: msg.body, subjectTable: "er_service_requests", subjectId: r.id });
    await addEvent(tx, { requestId: r.id, type: "notification", body: "Ilmoitus tilamuutoksesta jonossa ilmoittajalle.", visibility: "internal", actor: opts.actor });
  }
  return { changed: true };
}

/**
 * Palveluntuottajan kuittaus tehtävälinkistä: vastaanotto ja lupaus siitä,
 * mihin päivään mennessä työ on viimeistään tehty. Päivä on pakollinen, koska
 * ilmoittajan tärkein kysymys on "milloin tämä korjataan" (Jukka 23.9.2026).
 * Merkintä kirjataan ilmoittajalle näkyvänä, jotta kaikki osapuolet lukevat
 * saman ajankohdan, ja ilmoittajalle lähtee viesti uudesta ajankohdasta.
 * Aikataulun voi päivittää myöhemmin antamalla uuden päivän.
 */
export async function promiseCompletion(
  tx: Sql,
  opts: { requestId: string; promisedOn: string; note?: string | null; actor: Actor },
): Promise<{ first: boolean }> {
  const r = await lockRequest(tx, opts.requestId);
  if (!isOpen(r.status)) throw new RequestError("Valmista tai suljettua tehtävää ei voi kuitata.");
  const rows = await tx.query(
    `update er_service_requests set provider_acknowledged_at = coalesce(provider_acknowledged_at, now()), provider_promised_on = $2
      where id = $1 returning id`,
    [r.id, opts.promisedOn],
  );
  if (rows.length === 0) throw new RequestError("Kuittausta ei voitu kirjata.");

  const first = !r.provider_acknowledged_at;
  const pvm = formatDate(opts.promisedOn);
  const note = opts.note?.trim() || null;
  const body = [first ? `Tilaus vastaanotettu. Työ tehdään viimeistään ${pvm}.` : `Uusi arvio: työ tehdään viimeistään ${pvm}.`, note]
    .filter(Boolean)
    .join(" ");
  await addComment(tx, { requestId: r.id, body, visibility: "reporter", actor: opts.actor });

  if (r.reporter_email) {
    const msg = providerPromiseMessage({
      number: r.number, category: r.category, companyName: r.company_name, promisedOn: pvm,
      portalRequestId: r.reporter_user_id ? r.id : null,
    });
    await queueMessage(tx, { organizationId: r.organization_id, recipient: r.reporter_email, subject: msg.subject, body: msg.body, subjectTable: "er_service_requests", subjectId: r.id });
    // Merkintä isännöinnille, ei palveluntuottajan tehtävälinkkiin.
    await addEvent(tx, { requestId: r.id, type: "notification", body: "Ilmoitus työn ajankohdasta jonossa ilmoittajalle.", visibility: "internal", actor: { userId: null } });
  }
  return { first };
}

export async function updateAssignment(
  tx: Sql,
  opts: { requestId: string; assigneeUserId: string | null; providerId: string | null; dueOn: string | null; urgency: Urgency; category: Category; shareGroupId: string | null; actor: Actor },
) {
  const r = await lockRequest(tx, opts.requestId);
  const rows = await tx.query(
    `update er_service_requests set assignee_user_id = $2, provider_id = $3, due_on = $4, urgency = $5, category = $6, share_group_id = $7
      where id = $1 returning id`,
    [r.id, opts.assigneeUserId, opts.providerId, opts.dueOn, opts.urgency, opts.category, opts.shareGroupId],
  );
  if (rows.length === 0) throw new RequestError("Roolillasi ei voi muuttaa pyynnön käsittelytietoja.");

  const changes: string[] = [];
  if (r.assignee_user_id !== opts.assigneeUserId) changes.push(opts.assigneeUserId ? "vastuuhenkilö vaihdettu" : "vastuuhenkilö poistettu");
  if (r.provider_id !== opts.providerId) changes.push(opts.providerId ? "palveluntuottaja vaihdettu" : "palveluntuottaja poistettu");
  if ((r.due_on ?? null) !== opts.dueOn) changes.push(opts.dueOn ? `määräaika ${opts.dueOn.split("-").reverse().join(".")}` : "määräaika poistettu");
  if (r.urgency !== opts.urgency) changes.push("kiireellisyys muutettu");
  if (r.category !== opts.category) changes.push("aihe muutettu");
  if (r.share_group_id !== opts.shareGroupId) changes.push("huoneisto muutettu");
  if (r.provider_id && r.provider_id !== opts.providerId) {
    // Edellisen palveluntuottajan tehtävälinkki ei saa enää avata pyyntöä.
    await revokeAccessLinks(tx, "er_service_requests", r.id, "provider_task");
    changes.push("aiempi tehtävälinkki mitätöity");
  }
  if (changes.length) {
    const body = changes.join(", ");
    await addEvent(tx, { requestId: r.id, type: "assignment", body: body.charAt(0).toUpperCase() + body.slice(1) + ".", visibility: "internal", actor: opts.actor });
  }
}

export async function updateCost(
  tx: Sql,
  opts: { requestId: string; responsibility: CostResponsibility; costEur: number | null; actor: Actor; visibility?: EventVisibility },
) {
  const r = await lockRequest(tx, opts.requestId);
  const rows = await tx.query("update er_service_requests set cost_responsibility = $2, cost_eur = $3 where id = $1 returning id", [
    r.id, opts.responsibility, opts.costEur,
  ]);
  if (rows.length === 0) throw new RequestError("Roolillasi ei voi kirjata kustannusta.");
  const same = r.cost_responsibility === opts.responsibility && (r.cost_eur === null ? null : Number(r.cost_eur)) === opts.costEur;
  if (!same) {
    const eur = opts.costEur === null ? "ei summaa" : `${opts.costEur.toFixed(2).replace(".", ",")} €`;
    await addEvent(tx, { requestId: r.id, type: "cost", body: `Kustannus: ${eur}.`, visibility: opts.visibility ?? "internal", actor: opts.actor });
  }
}

/**
 * Tilaus palveluntuottajalle: uusi tehtävälinkki (vanhat mitätöidään) ja tila
 * "Tilattu", jos pyyntö ei ole jo työn alla. Kanava `email` lisää viestin
 * jonoon; `share` palauttaa linkin ja lyhyen viestitekstin, jonka isännöitsijä
 * jakaa itse (WhatsApp, tekstiviesti). Linkkiä ei tallenneta, vain tiiviste.
 */
export async function orderFromProvider(
  tx: Sql,
  opts: { requestId: string; actor: Actor; channel?: "email" | "share" | "marketplace" },
): Promise<{ link: string; shareText: string }> {
  const channel = opts.channel ?? "email";
  const r = await lockRequest(tx, opts.requestId);
  if (!r.provider_id) throw new RequestError("Valitse ensin palveluntuottaja.");
  if (channel === "email" && !r.provider_email) throw new RequestError("Palveluntuottajalta puuttuu sähköpostiosoite.");
  if (["done", "closed", "rejected"].includes(r.status)) throw new RequestError("Valmista tai suljettua pyyntöä ei voi tilata. Avaa pyyntö ensin uudelleen.");

  await revokeAccessLinks(tx, "er_service_requests", r.id, "provider_task");
  const token = await createAccessLink(tx, {
    organizationId: r.organization_id, purpose: "provider_task", subjectTable: "er_service_requests", subjectId: r.id,
    expiresInDays: PROVIDER_LINK_DAYS, createdBy: opts.actor.userId,
  });
  const share = providerShareText({ number: r.number, category: r.category, companyName: r.company_name, urgent: r.urgency === "urgent", token });
  if (channel === "email") {
    const msg = providerOrderMessage({
      number: r.number, category: r.category, companyName: r.company_name, address: r.company_address, urgent: r.urgency === "urgent", token,
    });
    await queueMessage(tx, { organizationId: r.organization_id, recipient: r.provider_email!, subject: msg.subject, body: msg.body, subjectTable: "er_service_requests", subjectId: r.id });
  }
  await tx.query("update er_service_requests set ordered_at = now(), provider_acknowledged_at = null, provider_promised_on = null where id = $1", [r.id]);
  const via = channel === "email" ? "sähköpostilla" : channel === "marketplace" ? "torilta" : "jakolinkkinä (esim. WhatsApp)";
  await addEvent(tx, { requestId: r.id, type: "notification", body: `Tilaus ${via}: ${r.provider_name ?? "palveluntuottaja"}.`, visibility: "internal", actor: opts.actor });
  if (["new", "received", "waiting"].includes(r.status)) {
    await changeStatus(tx, { requestId: r.id, to: "ordered", actor: opts.actor, mode: "staff" });
  }
  await audit(tx, { organizationId: r.organization_id, userId: opts.actor.userId, action: "order", entity: "service_request", entityId: r.id, details: { provider_id: r.provider_id, channel } });
  return { link: share.link, shareText: share.text };
}
