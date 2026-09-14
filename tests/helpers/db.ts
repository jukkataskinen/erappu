import { createPgliteDatabase } from "@/lib/db/pglite";
import { migrateLocal } from "@/lib/db/migrate";
import type { Database, Sql } from "@/lib/db/types";

/** Tuore muistikanta, johon on ajettu kaikki migraatiot. */
export async function freshDb(): Promise<Database> {
  const db = await createPgliteDatabase();
  await migrateLocal(db);
  return db;
}

export interface Fixture {
  orgA: string;
  orgB: string;
  managerA: { id: string; sub: string };
  accountantA: { id: string; sub: string };
  managerB: { id: string; sub: string };
  companyA: string;
  companyB: string;
}

let counter = 0;
const uniq = () => `${Date.now().toString(36)}${(counter++).toString(36)}`;

export async function one<T>(tx: Sql, text: string, params: unknown[] = []): Promise<T> {
  const rows = await tx.query<T>(text, params);
  if (rows.length !== 1) throw new Error(`odotettiin 1 rivi, saatiin ${rows.length}: ${text}`);
  return rows[0];
}

export async function createUser(db: Database, email?: string) {
  const sub = `test|${uniq()}`;
  const row = await db.asService((tx) =>
    one<{ id: string }>(tx, "insert into er_users (auth_sub, email) values ($1, $2) returning id", [
      sub,
      email ?? `${sub.replace("|", "-")}@example.test`,
    ]),
  );
  return { id: row.id, sub };
}

/** Kaksi organisaatiota, kummassakin taloyhtiö ja henkilökuntaa. */
export async function seedTwoOrgs(db: Database): Promise<Fixture> {
  const managerA = await createUser(db);
  const accountantA = await createUser(db);
  const managerB = await createUser(db);
  return db.asService(async (tx) => {
    const orgA = (await one<{ id: string }>(tx, "insert into er_organizations (name) values ('Isännöinti A') returning id")).id;
    const orgB = (await one<{ id: string }>(tx, "insert into er_organizations (name) values ('Isännöinti B') returning id")).id;
    await tx.query("insert into er_org_members (organization_id, user_id, role) values ($1,$2,'manager'),($1,$3,'accountant'),($4,$5,'manager')", [
      orgA, managerA.id, accountantA.id, orgB, managerB.id,
    ]);
    const companyA = (await one<{ id: string }>(tx,
      "insert into er_housing_companies (organization_id, name, business_id) values ($1, 'As Oy Testi A', '1234567-1') returning id", [orgA])).id;
    const companyB = (await one<{ id: string }>(tx,
      "insert into er_housing_companies (organization_id, name, business_id) values ($1, 'As Oy Testi B', '7654321-2') returning id", [orgB])).id;
    return { orgA, orgB, managerA, accountantA, managerB, companyA, companyB };
  });
}
