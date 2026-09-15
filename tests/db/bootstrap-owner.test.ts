import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createUser, freshDb, one } from "../helpers/db";
import type { Database } from "@/lib/db/types";
import { BOOTSTRAP_ORGANIZATION, bootstrapOwner } from "@/lib/deploy/bootstrap-owner";
import { acceptInvitation } from "@/lib/invitations";
import { sha256Hex } from "@/lib/security/crypto";

/*
  Tuotannon kanta on tyhjä. Ensimmäinen pääkäyttäjä syntyy kutsulla, jotta
  Auth0-kirjautuminen luo er_users-rivin itse ja kytkeytyy siihen. Nämä testit
  todistavat, että skriptin jälki kulkee saman hyväksynnän läpi kuin sovelluksen.
*/
let db: Database;
const BASE = "https://www.erappu.fi";

beforeAll(async () => {
  db = await freshDb();
});
afterAll(async () => db.close());

describe("bootstrapOwner", () => {
  it("luo organisaation ja pääkäyttäjän kutsun, jonka vain oikea sähköposti voi hyväksyä", async () => {
    const res = await db.asService((tx) => bootstrapOwner(tx, { email: " Jukka.Taskinen@Adepta.fi ", baseUrl: `${BASE}/` }));
    expect(res.organizationCreated).toBe(true);
    expect(res.owner.status).toBe("invited");
    if (res.owner.status !== "invited") return;
    expect(res.owner.url).toBe(`${BASE}/kutsu/${res.owner.token}`);

    const org = await db.asService((tx) => one<{ name: string; business_id: string }>(tx, "select name, business_id from er_organizations where id = $1", [res.organizationId]));
    expect(org).toEqual({ name: BOOTSTRAP_ORGANIZATION.name, business_id: "2237131-2" });

    const inv = await db.asService((tx) =>
      one<{ email: string; kind: string; role: string; token_hash: string; created_by: string | null }>(tx, "select email, kind, role, token_hash, created_by from er_invitations where id = $1", [res.owner.status === "invited" ? res.owner.invitationId : ""]),
    );
    expect(inv).toMatchObject({ email: "jukka.taskinen@adepta.fi", kind: "staff", role: "owner", created_by: null });
    expect(inv.token_hash).toBe(sha256Hex(res.owner.token));

    // Ensimmäinen Auth0-kirjautuminen luo er_users-rivin (getCurrentUser); väärä osoite ei kelpaa.
    const vieras = await createUser(db, "vieras@example.test");
    const kielto = await db.asService((tx) => acceptInvitation(tx, res.owner.status === "invited" ? res.owner.token : "", { id: vieras.id, email: "vieras@example.test" }));
    expect(kielto).toEqual({ ok: false, reason: "email_mismatch" });

    const jukka = await createUser(db, "jukka.taskinen@adepta.fi");
    const hyvaksynta = await db.asService((tx) => acceptInvitation(tx, res.owner.status === "invited" ? res.owner.token : "", { id: jukka.id, email: "JUKKA.TASKINEN@adepta.fi" }));
    expect(hyvaksynta).toEqual({ ok: true, kind: "staff", organizationId: res.organizationId });

    // Pääkäyttäjä näkee organisaationsa RLS:n läpi.
    const nakyy = await db.asUser(jukka.sub, (tx) => tx.query<{ id: string }>("select id from er_organizations"));
    expect(nakyy.map((r) => r.id)).toEqual([res.organizationId]);
  });

  it("toinen ajo on idempotentti: organisaatiota ei luoda uudelleen eikä jo pääkäyttäjää kutsuta", async () => {
    const res = await db.asService((tx) => bootstrapOwner(tx, { email: "jukka.taskinen@adepta.fi", baseUrl: BASE }));
    expect(res.organizationCreated).toBe(false);
    expect(res.owner).toEqual({ status: "already_owner" });
    const count = await db.asService((tx) => one<{ n: number }>(tx, "select count(*)::int as n from er_organizations where business_id = '2237131-2'"));
    expect(count.n).toBe(1);
  });

  it("jo kirjautunut käyttäjä liitetään suoraan, ja uusi kutsu perii vanhan", async () => {
    const org = { name: "Testi-isännöinti", businessId: "1111111-1" };
    const kutsu1 = await db.asService((tx) => bootstrapOwner(tx, { email: "uusi@example.test", baseUrl: BASE, organization: org }));
    const kutsu2 = await db.asService((tx) => bootstrapOwner(tx, { email: "uusi@example.test", baseUrl: BASE, organization: org }));
    expect(kutsu1.owner.status).toBe("invited");
    expect(kutsu2.owner.status).toBe("invited");
    const avoimet = await db.asService((tx) => tx.query("select 1 from er_invitations where organization_id = $1 and revoked_at is null", [kutsu2.organizationId]));
    expect(avoimet).toHaveLength(1);

    // Henkilökunnan tietokantayhteyden tunniste (auth0|...), kuten Auth0:n ensimmäinen kirjautuminen luo.
    const kayttaja = await db.asService((tx) =>
      one<{ id: string }>(tx, "insert into er_users (auth_sub, email) values ('auth0|abc123', 'kirjautunut@example.test') returning id"),
    );
    const liitetty = await db.asService((tx) => bootstrapOwner(tx, { email: "kirjautunut@example.test", baseUrl: BASE, organization: org }));
    expect(liitetty.owner).toEqual({ status: "member_added", userId: kayttaja.id });
    const rooli = await db.asService((tx) => one<{ role: string }>(tx, "select role from er_org_members where organization_id = $1 and user_id = $2", [liitetty.organizationId, kayttaja.id]));
    expect(rooli.role).toBe("owner");
  });

  /* Sähköpostikoodilla syntynyt tunnus ohittaisi henkilökunnan MFA:n. */
  it("ei anna pääkäyttäjän roolia portaalin sähköpostikooditunnukselle", async () => {
    const org = { name: "Kolmas", businessId: "3333333-3" };
    await db.asService((tx) => tx.query("insert into er_users (auth_sub, email) values ('email|xyz', 'asukas@example.test')"));
    const res = await db.asService((tx) => bootstrapOwner(tx, { email: "asukas@example.test", baseUrl: BASE, organization: org }));
    expect(res.owner).toEqual({ status: "not_staff_login" });
    const jasenet = await db.asService((tx) => tx.query("select 1 from er_org_members where organization_id = $1", [res.organizationId]));
    expect(jasenet).toHaveLength(0);
  });

  it("ei muuta olemassa olevaa roolia eikä hyväksy virheellistä sähköpostia", async () => {
    const org = { name: "Toinen", businessId: "2222222-2" };
    const kayttaja = await createUser(db, "isannoitsija@example.test");
    const { organizationId } = await db.asService((tx) => bootstrapOwner(tx, { email: "joku@example.test", baseUrl: BASE, organization: org }));
    await db.asService((tx) => tx.query("insert into er_org_members (organization_id, user_id, role) values ($1, $2, 'manager')", [organizationId, kayttaja.id]));

    const res = await db.asService((tx) => bootstrapOwner(tx, { email: "isannoitsija@example.test", baseUrl: BASE, organization: org }));
    expect(res.owner).toEqual({ status: "other_role", role: "manager" });
    await expect(db.asService((tx) => bootstrapOwner(tx, { email: "ei-osoite", baseUrl: BASE }))).rejects.toThrow(/virheellinen/);
  });

  it("kirjaa tapahtumat lokiin ilman sähköpostia", async () => {
    const logs = await db.asService((tx) => tx.query<{ details: unknown }>("select details from er_audit_log where action = 'bootstrap'"));
    expect(logs.length).toBeGreaterThan(0);
    expect(JSON.stringify(logs)).not.toContain("@");
  });
});
