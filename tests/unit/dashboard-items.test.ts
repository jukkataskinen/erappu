import { describe, expect, it } from "vitest";
import { buildAgenda, collapseGroups, dueLabel, inScope, scopeHealth, type DashboardItem } from "@/lib/dashboard/items";

const TODAY = "2026-09-19"; // lauantai

const item = (id: string, dueOn: string | null, extra: Partial<DashboardItem> = {}): DashboardItem => ({
  id, category: "vuosikello", title: id, companyId: "c1", companyName: "As Oy A", href: `/${id}`, action: "Avaa", dueOn, ...extra,
});

describe("työpöydän tehtävälista", () => {
  it("myöhässä ensin, sitten odottavat vanhin ensin, sitten päivämäärän mukaan; kokoukset vain aikajanalle", () => {
    const a = buildAgenda(
      [
        item("ensi-viikko", "2026-09-25"),
        item("viesti-uusi", null, { waiting: true, since: "2026-09-18" }),
        item("myohassa", "2026-09-10"),
        item("viesti-vanha", null, { waiting: true, since: "2026-09-12" }),
        item("tanaan", "2026-09-19"),
        item("kokous", "2026-10-20", { event: true }),
        item("kaukana", "2026-10-30"),
        item("liian-kaukana", "2026-12-30"),
      ],
      TODAY,
    );
    expect(a.tasks.map((i) => i.id)).toEqual(["myohassa", "viesti-vanha", "viesti-uusi", "tanaan", "ensi-viikko"]);
    expect(a.upcoming.map((i) => i.id)).toEqual(["kokous", "kaukana"]);
    expect(a).toMatchObject({ waiting: 2, overdue: 1, thisWeek: 1 });
  });

  it("päivämäärämerkinnät", () => {
    expect(dueLabel(item("x", "2026-09-16"), TODAY)).toEqual({ text: "myöhässä 3 pv", tone: "alert" });
    expect(dueLabel(item("x", TODAY), TODAY).text).toBe("tänään");
    expect(dueLabel(item("x", "2026-09-20"), TODAY).text).toBe("huomenna");
    expect(dueLabel(item("x", "2026-10-06"), TODAY).text).toBe("6.10.");
    expect(dueLabel(item("x", null, { since: "2026-09-14" }), TODAY)).toEqual({ text: "odottanut 5 pv", tone: "warn" });
    expect(dueLabel(item("x", null, { since: TODAY }), TODAY).text).toBe("uusi");
  });

  it("omat yhtiöt: yhtiöön kuulumattomat rivit näkyvät aina", () => {
    const rows = [item("a", null), item("b", null, { companyId: "c2" }), item("toimisto", null, { companyId: null })];
    expect(inScope(rows, new Set(["c1"])).map((r) => r.id)).toEqual(["a", "toimisto"]);
    expect(inScope(rows, null)).toHaveLength(3);
    const health = scopeHealth([{ key: "k", label: "L", companies: [{ id: "c2", name: "B" }], href: "/", tone: "neutral" }], new Set(["c1"]));
    expect(health).toEqual([]);
  });

  it("vastikeajot yhdistetään yhdeksi riviksi, yksittäinen jää ennalleen", () => {
    const g = { key: "ajo-9/2026", href: "/talous" };
    const rows = collapseGroups([
      item("a1", "2026-09-25", { group: g, companyName: "As Oy A" }),
      item("a2", "2026-09-20", { group: g, companyName: "As Oy B", companyId: "c2" }),
      item("muu", null),
    ]);
    const merged = rows.find((r) => r.id === "ajo-9/2026")!;
    expect(merged).toMatchObject({ dueOn: "2026-09-20", companyId: null, href: "/talous", context: "2 yhtiötä: As Oy A, As Oy B" });
    expect(collapseGroups([item("yksi", null, { group: g })]).map((r) => r.id)).toEqual(["yksi"]);
  });
});
