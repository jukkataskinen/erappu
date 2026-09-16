import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  approveReservation, cancelListing, createMarketplaceLink, listOnMarketplace, maintainMarketplace, MarketplaceError, openReservedTask, rejectReservation,
  reserveListing, setApproval, type MarketplaceProvider,
} from "@/lib/marketplace/mutations";
import { getListingForRequest, listOpenForProvider, listPendingApprovals, listProviderReservations, resolveMarketplaceProvider } from "@/lib/marketplace/queries";
import type { Database } from "@/lib/db/types";
import { changeStatus, createRequest, type NewRequest } from "@/lib/service-requests/mutations";
import { resolveProviderTask } from "@/lib/service-requests/links";
import { freshDb, one, seedTwoOrgs, type Fixture } from "../helpers/db";

/**
 * Huoltopyyntöjen tori (0096): näkyvyys hyväksynnän ja yhtiön torisääntöjen
 * mukaan, tietojen minimointi, varaus lukituksella, euro-raja, hyväksyntä ja
 * viikon voimassaolo.
 */

let db: Database;
let f: Fixture;
let companyA2: string;
let orgWide: MarketplaceProvider;
let companyOnly: MarketplaceProvider;
let notApproved: MarketplaceProvider;
let noRate: MarketplaceProvider;
const TODAY = new Date().toISOString().slice(0, 10);
const inDays = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

const request = (companyId: string, extra: Partial<NewRequest> = {}): NewRequest => ({
  companyId, shareGroupId: null, unitText: "A 5", title: "Matti Meikäläinen, hana vuotaa", description: "Soita 040 123 4567, asukas Matti", category: "plumbing",
  urgency: "normal", mayUseMasterKey: false, hasPets: false, source: "staff", reporterUserId: null, reporterName: null, reporterPhone: null,
  reporterEmail: "asukas@example.test", ...extra,
});

async function provider(name: string, rate: number | null): Promise<MarketplaceProvider> {
  const row = await db.asService((tx) =>
    one<{ id: string }>(tx, "insert into er_service_providers (organization_id, name, email, phone, hourly_rate_eur) values ($1,$2,$3,'040 555 0000',$4) returning id", [
      f.orgA, name, `${name.toLowerCase().replace(/\s/g, "")}@example.test`, rate,
    ]),
  );
  return { id: row.id, organizationId: f.orgA, name, hourlyRateEur: rate };
}

async function newListing(companyId = f.companyA, extra: Partial<NewRequest> = {}) {
  const r = await db.asUser(f.managerA.sub, (tx) => createRequest(tx, request(companyId, extra)));
  const listingId = await db.asUser(f.managerA.sub, (tx) => listOnMarketplace(tx, { requestId: r.id, summary: "Keittiön hanan vuoto, vaihto tai tiivisteet", userId: f.managerA.id }));
  return { requestId: r.id, listingId };
}

beforeAll(async () => {
  db = await freshDb();
  f = await seedTwoOrgs(db);
  await db.asService(async (tx) => {
    companyA2 = (await one<{ id: string }>(tx, "insert into er_housing_companies (organization_id, name, business_id, city) values ($1,'As Oy Testi A2','1111111-1','Jyväskylä') returning id", [f.orgA])).id;
    await tx.query("update er_housing_companies set city = 'Toivakka', street_address = 'Salainen katu 1', manager_user_id = $2 where id = $1", [f.companyA, f.managerA.id]);
  });
  orgWide = await provider("Koko Org Huolto", 60);
  companyOnly = await provider("Yhtio Putki", 80);
  notApproved = await provider("Ei Hyvaksytty", 50);
  noRate = await provider("Ilman Hintaa", null);
  await db.asUser(f.managerA.sub, async (tx) => {
    await setApproval(tx, { providerId: orgWide.id, organizationId: f.orgA, companyId: null, approved: true, userId: f.managerA.id });
    await setApproval(tx, { providerId: companyOnly.id, organizationId: f.orgA, companyId: companyA2, approved: true, userId: f.managerA.id });
    await setApproval(tx, { providerId: noRate.id, organizationId: f.orgA, companyId: null, approved: true, userId: f.managerA.id });
  });
});
afterAll(async () => db.close());

describe("torisäännöt", () => {
  it("ilman hallituksen päätöstä yhtiön pyyntöä ei voi viedä torille, eikä päätöstä voi merkitä ilman rajaa", async () => {
    const r = await db.asUser(f.managerA.sub, (tx) => createRequest(tx, request(f.companyA)));
    await expect(db.asUser(f.managerA.sub, (tx) => listOnMarketplace(tx, { requestId: r.id, summary: "Hanan vuoto", userId: f.managerA.id }))).rejects.toBeInstanceOf(MarketplaceError);
    await expect(db.asUser(f.managerA.sub, (tx) => tx.query("update er_housing_companies set marketplace_enabled = true where id = $1", [f.companyA]))).rejects.toThrow();

    await db.asUser(f.managerA.sub, (tx) =>
      tx.query("update er_housing_companies set marketplace_enabled = true, marketplace_limit_eur = 500, marketplace_decided_on = '2026-09-01' where id = any($1::uuid[])", [[f.companyA, companyA2]]),
    );
    const urgent = await db.asUser(f.managerA.sub, (tx) => createRequest(tx, request(f.companyA, { urgency: "urgent" })));
    await expect(db.asUser(f.managerA.sub, (tx) => listOnMarketplace(tx, { requestId: urgent.id, summary: "Vuoto", userId: f.managerA.id }))).rejects.toThrow(/Kiireellistä/);
  });

  it("toisen organisaation henkilökunta ei voi hyväksyä tai lukea", async () => {
    await expect(
      db.asUser(f.managerB.sub, (tx) => setApproval(tx, { providerId: notApproved.id, organizationId: f.orgA, companyId: null, approved: true, userId: f.managerB.id })),
    ).rejects.toThrow();
    const rows = await db.asUser(f.managerB.sub, (tx) => tx.query("select id from er_marketplace_approvals"));
    expect(rows).toHaveLength(0);
  });
});

describe("näkyvyys ja tietojen minimointi", () => {
  it("organisaatiolle hyväksytty näkee kaikki, yhtiölle hyväksytty vain oman yhtiön, hyväksymätön ei mitään", async () => {
    const a = await newListing(f.companyA);
    const b = await newListing(companyA2);
    const org = await db.asService((tx) => listOpenForProvider(tx, orgWide));
    expect(org.map((l) => l.id)).toEqual(expect.arrayContaining([a.listingId, b.listingId]));
    const company = await db.asService((tx) => listOpenForProvider(tx, companyOnly));
    expect(company.map((l) => l.id)).toEqual([b.listingId]);
    expect(await db.asService((tx) => listOpenForProvider(tx, notApproved))).toHaveLength(0);

    // Torilla ei näy osoitetta, pyynnön otsikkoa, kuvausta eikä ilmoittajan tietoja.
    const json = JSON.stringify(org);
    expect(json).not.toContain("Salainen katu");
    expect(json).not.toContain("Matti");
    expect(json).not.toContain("040 123");
    expect(json).not.toContain("A 5");
    expect(org.find((l) => l.id === a.listingId)?.city).toBe("Toivakka");

    await expect(
      db.asService((tx) => reserveListing(tx, { provider: notApproved, listingId: a.listingId, estimatedOn: inDays(2), estimatedHours: 2, today: TODAY })),
    ).rejects.toThrow(/ei löytynyt/);
    await db.asUser(f.managerA.sub, (tx) => cancelListing(tx, { listingId: a.listingId, userId: f.managerA.id }));
    await db.asUser(f.managerA.sub, (tx) => cancelListing(tx, { listingId: b.listingId, userId: f.managerA.id }));
  });
});

describe("varaus", () => {
  it("rajan alittava varaus tilataan heti: tehtävälinkki toimii, muut eivät voi varata, asukas saa tiedon", async () => {
    const { requestId, listingId } = await newListing();
    const res = await db.asService((tx) => reserveListing(tx, { provider: orgWide, listingId, estimatedOn: inDays(3), estimatedHours: 4, today: TODAY }));
    expect(res.status).toBe("reserved");
    const token = res.status === "reserved" ? res.link.split("/tehtava/")[1] : "";
    const task = await db.asService((tx) => resolveProviderTask(tx, token));
    expect(task?.status).toBe("ordered");
    expect(task?.providerName).toBe("Koko Org Huolto");

    await expect(
      db.asService((tx) => reserveListing(tx, { provider: noRate, listingId, estimatedOn: inDays(3), estimatedHours: 1, today: TODAY })),
    ).rejects.toThrow();
    expect(await db.asService((tx) => listOpenForProvider(tx, orgWide))).toHaveLength(0);

    const reporterEvents = await db.asService((tx) =>
      tx.query<{ body: string }>("select body from er_service_request_events where request_id = $1 and type = 'marketplace' and visibility = 'reporter'", [requestId]),
    );
    expect(reporterEvents[0].body).toContain("Työn on varannut Koko Org Huolto");
    const mails = await db.asService((tx) => tx.query<{ recipient: string; subject: string; body: string }>("select recipient, subject, body from er_outbound_messages where subject_id = $1", [requestId]));
    const toReporter = mails.find((m) => m.recipient === "asukas@example.test" && m.subject.includes("varattu"));
    expect(toReporter?.body).toContain("Arvioitu toteutus");
    expect(toReporter?.body).not.toContain("Matti");

    const mine = await db.asService((tx) => listProviderReservations(tx, orgWide));
    expect(mine.find((m) => m.id === listingId)?.status).toBe("reserved");
    const reopened = await db.asService((tx) => openReservedTask(tx, { provider: orgWide, listingId }));
    expect(await db.asService((tx) => resolveProviderTask(tx, token))).toBeNull();
    expect(await db.asService((tx) => resolveProviderTask(tx, reopened))).not.toBeNull();
    await expect(db.asService((tx) => openReservedTask(tx, { provider: companyOnly, listingId }))).rejects.toBeInstanceOf(MarketplaceError);
  });

  it("ilman tuntihintaa ei voi varata, ja arvio tarkistetaan", async () => {
    const { listingId } = await newListing();
    await expect(db.asService((tx) => reserveListing(tx, { provider: noRate, listingId, estimatedOn: inDays(1), estimatedHours: 2, today: TODAY }))).rejects.toThrow(/Tuntihinta/);
    await expect(db.asService((tx) => reserveListing(tx, { provider: orgWide, listingId, estimatedOn: "2020-01-01", estimatedHours: 2, today: TODAY }))).rejects.toThrow(/menneisyydessä/);
    await expect(db.asService((tx) => reserveListing(tx, { provider: orgWide, listingId, estimatedOn: inDays(1), estimatedHours: 0, today: TODAY }))).rejects.toThrow(/tuntiarvio/i);
    await db.asUser(f.managerA.sub, (tx) => cancelListing(tx, { listingId, userId: f.managerA.id }));
  });

  it("rajan ylittävä varaus odottaa hyväksyntää; hylkäys palauttaa torille, hyväksyntä tilaa työn", async () => {
    const { requestId, listingId } = await newListing(companyA2);
    const res = await db.asService((tx) => reserveListing(tx, { provider: companyOnly, listingId, estimatedOn: inDays(5), estimatedHours: 8, today: TODAY }));
    expect(res).toEqual({ status: "pending_approval", estimateEur: 640, limitEur: 500 });
    expect((await db.asUser(f.managerA.sub, (tx) => listPendingApprovals(tx, f.orgA))).map((p) => p.id)).toEqual([listingId]);
    const req = await db.asService((tx) => one<{ provider_id: string | null; status: string }>(tx, "select provider_id, status from er_service_requests where id = $1", [requestId]));
    expect(req.provider_id).toBeNull();

    await db.asUser(f.managerA.sub, (tx) => rejectReservation(tx, { listingId, userId: f.managerA.id }));
    expect((await db.asUser(f.managerA.sub, (tx) => getListingForRequest(tx, requestId)))?.status).toBe("open");

    await db.asService((tx) => reserveListing(tx, { provider: companyOnly, listingId, estimatedOn: inDays(5), estimatedHours: 8, today: TODAY }));
    const approved = await db.asUser(f.managerA.sub, (tx) => approveReservation(tx, { listingId, userId: f.managerA.id }));
    expect(approved.link).toContain("/tehtava/");
    const after = await db.asUser(f.managerA.sub, (tx) => getListingForRequest(tx, requestId));
    expect(after?.status).toBe("reserved");
    expect(after?.provider_name).toBe("Yhtio Putki");
  });
});

describe("viikon voimassaolo", () => {
  it("tehty työ merkitään valmiiksi; kuittaamaton varaus raukeaa viikon jälkeen ja palaa torille", async () => {
    const done = await newListing();
    await db.asService((tx) => reserveListing(tx, { provider: orgWide, listingId: done.listingId, estimatedOn: inDays(1), estimatedHours: 1, today: TODAY }));
    await db.asService((tx) => changeStatus(tx, { requestId: done.requestId, to: "done", actor: { userId: null, providerActor: true }, mode: "provider" }));

    const late = await newListing();
    const res = await db.asService((tx) => reserveListing(tx, { provider: orgWide, listingId: late.listingId, estimatedOn: inDays(1), estimatedHours: 1, today: TODAY }));
    const token = res.status === "reserved" ? res.link.split("/tehtava/")[1] : "";

    // Ennen viikkoa mikään ei raukea.
    const early = await db.asService((tx) => maintainMarketplace(tx, new Date(Date.now() + 6 * 86400000)));
    expect(early.expired).toBe(0);
    expect(early.completed).toBeGreaterThanOrEqual(1);

    const result = await db.asService((tx) => maintainMarketplace(tx, new Date(Date.now() + 8 * 86400000)));
    expect(result.expired).toBeGreaterThanOrEqual(1);
    const lateListing = await db.asUser(f.managerA.sub, (tx) => getListingForRequest(tx, late.requestId));
    expect(lateListing?.status).toBe("open");
    expect(lateListing?.provider_id).toBeNull();
    expect(await db.asService((tx) => resolveProviderTask(tx, token))).toBeNull();
    const req = await db.asService((tx) => one<{ provider_id: string | null; status: string }>(tx, "select provider_id, status from er_service_requests where id = $1", [late.requestId]));
    expect(req).toEqual({ provider_id: null, status: "received" });
    expect((await db.asUser(f.managerA.sub, (tx) => getListingForRequest(tx, done.requestId)))?.status).toBe("completed");
  });
});

describe("torilinkki", () => {
  it("linkki tunnistaa palveluntuottajan, uusi linkki mitätöi vanhan", async () => {
    const first = await db.asUser(f.managerA.sub, (tx) => createMarketplaceLink(tx, { providerId: orgWide.id, organizationId: f.orgA, userId: f.managerA.id }));
    const token1 = first.split("/tori/")[1];
    const resolved = await db.asService((tx) => resolveMarketplaceProvider(tx, token1));
    expect(resolved).toEqual({ id: orgWide.id, organizationId: f.orgA, name: "Koko Org Huolto", hourlyRateEur: 60 });
    const second = await db.asUser(f.managerA.sub, (tx) => createMarketplaceLink(tx, { providerId: orgWide.id, organizationId: f.orgA, userId: f.managerA.id }));
    expect(await db.asService((tx) => resolveMarketplaceProvider(tx, token1))).toBeNull();
    expect(await db.asService((tx) => resolveMarketplaceProvider(tx, second.split("/tori/")[1]))).not.toBeNull();
    // Tehtävälinkki ei kelpaa torilinkiksi.
    const { listingId } = await newListing();
    const res = await db.asService((tx) => reserveListing(tx, { provider: orgWide, listingId, estimatedOn: inDays(1), estimatedHours: 1, today: TODAY }));
    if (res.status === "reserved") expect(await db.asService((tx) => resolveMarketplaceProvider(tx, res.link.split("/tehtava/")[1]))).toBeNull();
  });
});
