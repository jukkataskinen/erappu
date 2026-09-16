/** @jsxRuntime automatic */
/** @jsxImportSource react */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ResponsibilityChart } from "@/components/responsibility/ResponsibilityChart";
import { ROOM_ART } from "@/components/responsibility/rooms";
import { findItem, ITEMS, itemsForRoom, RESPONSIBILITIES, ROOMS, VIEW_BOX } from "@/lib/responsibility/content";
import { mergeExceptions, orphanExceptions, type ResponsibilityException } from "@/lib/responsibility/merge";

describe("vastuunjako: sisällön eheys", () => {
  it("avaimet ovat uniikkeja ja migraation sallimaa muotoa", () => {
    const keys = ITEMS.map((i) => i.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of keys) expect(k).toMatch(/^[a-z0-9-]{1,80}$/);
    const roomKeys = ROOMS.map((r) => r.key);
    expect(new Set(roomKeys).size).toBe(roomKeys.length);
  });

  it("jokaisella tilalla on kuva ja kohteita, ja jokainen kohde kuuluu tunnettuun tilaan", () => {
    for (const room of ROOMS) {
      expect(ROOM_ART[room.key], room.key).toBeTypeOf("function");
      expect(itemsForRoom(room.key).length, room.key).toBeGreaterThanOrEqual(5);
      expect(room.intro.length).toBeGreaterThan(20);
    }
    for (const item of ITEMS) expect(ROOMS.map((r) => r.key)).toContain(item.room);
  });

  it("jokaisella kohteella on teksti, lakiviite ja sallittu vastuu", () => {
    for (const item of ITEMS) {
      expect(item.label.trim(), item.key).not.toBe("");
      expect(item.text.length, item.key).toBeGreaterThan(40);
      expect(item.law, item.key).toMatch(/^AOYL \d+:\d+/);
      expect(RESPONSIBILITIES, item.key).toContain(item.responsibility);
      if (item.note !== undefined) expect(item.note.trim(), item.key).not.toBe("");
    }
  });

  it("lakiviitteet osoittavat vain 1, 4 ja 5 lukuun, joista tulkinnat on kirjoitettu", () => {
    for (const item of ITEMS) {
      const refs = [...`${item.law} ${item.text} ${item.note ?? ""}`.matchAll(/AOYL (\d+):(\d+)/g)];
      for (const [, chapter, section] of refs) {
        expect(["1", "4", "5"], item.key).toContain(chapter);
        if (chapter === "4") expect(Number(section), item.key).toBeLessThanOrEqual(10);
        if (chapter === "1") expect(section, item.key).toBe("3");
      }
    }
  });

  it("pisteet ovat viewBoxin sisällä niin, ettei piste leikkaudu reunasta", () => {
    for (const item of ITEMS) {
      expect(item.x, item.key).toBeGreaterThanOrEqual(40);
      expect(item.x, item.key).toBeLessThanOrEqual(VIEW_BOX.width - 40);
      expect(item.y, item.key).toBeGreaterThanOrEqual(40);
      expect(item.y, item.key).toBeLessThanOrEqual(VIEW_BOX.height - 40);
    }
  });

  it("saman tilan pisteet eivät ole päällekkäin", () => {
    // 90 viewBox-yksikköä on 400 px leveällä näytöllä noin 36 px, eli pisteet eivät peitä toisiaan.
    for (const room of ROOMS) {
      const items = itemsForRoom(room.key);
      for (let a = 0; a < items.length; a++) {
        for (let b = a + 1; b < items.length; b++) {
          const d = Math.hypot(items[a].x - items[b].x, items[a].y - items[b].y);
          expect(d, `${items[a].key} – ${items[b].key}`).toBeGreaterThanOrEqual(90);
        }
      }
    }
  });

  it("toimeksiannon vähimmäiskohteet ovat mukana", () => {
    const required = [
      "keittio-hana", "keittio-viemari", "keittio-tiskikone", "keittio-liesi", "keittio-liesituuletin", "keittio-iv-venttiili", "keittio-kaapistot", "keittio-pistorasiat", "keittio-runkoputki",
      "kylpyhuone-vedeneristys", "kylpyhuone-lattiakaivo", "kylpyhuone-laatoitus", "kylpyhuone-wc", "kylpyhuone-pesuallas", "kylpyhuone-suihku", "kylpyhuone-pyykinpesukone", "kylpyhuone-lattialammitys", "kylpyhuone-iv-venttiili", "kylpyhuone-peilikaappi",
      "ovet-ulko-ovi", "ovet-lukko", "ovet-ovisilma", "ovet-sisaovet", "ovet-ovensulkija", "ovet-tiivisteet",
      "ikkunat-karmit", "ikkunat-ulkopinnat", "ikkunat-sisapinnat", "ikkunat-helat", "ikkunat-tiivisteet", "ikkunat-lasit", "ikkunat-salekaihtimet",
      "sauna-kiuas", "sauna-lauteet", "sauna-lattiakaivo", "sauna-valaisin", "sauna-sahkoliitanta",
      "olohuone-pinnat", "olohuone-pistorasiat", "olohuone-antennirasia", "olohuone-sahkokeskus", "olohuone-poistoventtiili", "olohuone-patteri",
      "parveke-laatta", "parveke-lasit", "parveke-pinnat", "parveke-valaisin", "parveke-lumi",
      "piha-alue", "piha-istutukset", "piha-aidat", "piha-ulkovarasto", "piha-valaisin", "piha-sadevesi",
    ];
    for (const key of required) expect(findItem(key), key).toBeDefined();
  });

  it("lain nimenomainen allasrajaus näkyy: altaat eivät ole yhtiön", () => {
    expect(findItem("keittio-allas")?.responsibility).toBe("shareholder");
    expect(findItem("kylpyhuone-pesuallas")?.responsibility).not.toBe("company");
  });
});

describe("vastuunjako: poikkeusten yhdistäminen", () => {
  const exception: ResponsibilityException = {
    item_key: "parveke-lasit",
    responsibility: "shareholder",
    basis: "articles",
    note: "Yhtiöjärjestyksen 4 §",
    decided_on: "2025-05-20",
  };

  it("ilman poikkeuksia voimassa on yleinen tulkinta", () => {
    const merged = mergeExceptions([]);
    expect(merged).toHaveLength(ITEMS.length);
    for (const m of merged) {
      expect(m.effective).toBe(m.responsibility);
      expect(m.exception).toBeNull();
    }
  });

  it("poikkeus muuttaa voimassa olevan vastuun mutta säilyttää yleisen tulkinnan vertailuun", () => {
    const merged = mergeExceptions([exception]);
    const lasit = merged.find((m) => m.key === "parveke-lasit")!;
    expect(lasit.responsibility).toBe("shared");
    expect(lasit.effective).toBe("shareholder");
    expect(lasit.exception).toEqual(exception);
    expect(merged.filter((m) => m.exception)).toHaveLength(1);
  });

  it("tuntematon avain ei tule taulukkoon, vaan erotellaan poistettavaksi", () => {
    const orphan = { ...exception, item_key: "poistettu-kohde" };
    const merged = mergeExceptions([exception, orphan]);
    expect(merged).toHaveLength(ITEMS.length);
    expect(merged.some((m) => m.key === "poistettu-kohde")).toBe(false);
    expect(orphanExceptions([exception, orphan]).map((o) => o.item_key)).toEqual(["poistettu-kohde"]);
  });
});

describe("vastuunjako: selainkomponentti", () => {
  it("jokainen piste on nimetty painike ja kaikki kohteet ovat luettelossa ilman valintaa", () => {
    const html = renderToStaticMarkup(<ResponsibilityChart items={mergeExceptions([])} initialRoom="keittio" />);
    const kitchen = itemsForRoom("keittio");
    expect(html.match(/aria-pressed="false"/g)).toHaveLength(kitchen.length);
    for (const item of kitchen) {
      expect(html).toContain(`aria-label="${item.label}: `);
      expect(html).toContain(item.law);
    }
    expect(html.match(/role="tab"/g)).toHaveLength(ROOMS.length);
    expect(html).toContain('aria-selected="true"');
  });

  it("poikkeus näkyy korostettuna perusteineen", () => {
    const items = mergeExceptions([{ item_key: "parveke-lasit", responsibility: "shareholder", basis: "meeting", note: "Päätös 2025", decided_on: null }]);
    const html = renderToStaticMarkup(<ResponsibilityChart items={items} initialRoom="parveke" />);
    expect(html).toContain("Parvekelasit: Osakas, yhtiökohtainen poikkeus");
    expect(html).toContain("Yhtiökokouksen päätös");
    expect(html).toContain("Päätös 2025");
  });
});
