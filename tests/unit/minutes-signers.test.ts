import { describe, expect, it } from "vitest";
import { planMinutesSigners } from "@/lib/meetings/minutes-signers";

/** Hallituksen pöytäkirjan allekirjoittajat yhtiöjärjestyksen mukaan (0113). */

const base = {
  kind: "board",
  chair_name: "Olavi Jouttijärvi",
  chair_email: "pj@example.test",
  minutes_checkers: [{ name: "Martti Heinonen", email: "mh@example.test" }],
  board_minutes_signers: null as string | null,
};

describe("pöytäkirjan allekirjoittajat", () => {
  it("lain mukaan: puheenjohtaja ja valittu jäsen", () => {
    const plan = planMinutesSigners(base, []);
    expect(plan.rule).toBe("law");
    expect(plan.problems).toEqual([]);
    expect(plan.signers.map((s) => [s.name, s.role])).toEqual([
      ["Olavi Jouttijärvi", "Puheenjohtaja"],
      ["Martti Heinonen", "Hallituksen valitsema jäsen"],
    ]);
  });

  it("kaikki läsnä olleet: puheenjohtaja tunnistetaan nimestä käänteisessäkin järjestyksessä", () => {
    const plan = planMinutesSigners({ ...base, board_minutes_signers: "all_present" }, [
      { display_name: "Jouttijärvi Olavi", email: null },
      { display_name: "Heinonen Martti", email: "mh@example.test" },
      { display_name: "Eila Hokkanen", email: "eh@example.test" },
    ]);
    expect(plan.problems).toEqual([]);
    expect(plan.signers.map((s) => s.email)).toEqual(["pj@example.test", "mh@example.test", "eh@example.test"]);
    expect(plan.ruleLabel).toBe("Kaikki kokouksessa läsnä olleet");
  });

  it("kaikki läsnä olleet: puuttuva sähköposti estää lähetyksen", () => {
    const plan = planMinutesSigners({ ...base, board_minutes_signers: "all_present" }, [
      { display_name: "Olavi Jouttijärvi", email: "pj@example.test" },
      { display_name: "Eila Hokkanen", email: null },
    ]);
    expect(plan.problems[0]).toMatch(/Sähköposti puuttuu: Eila Hokkanen/);
  });

  // Isännöitsijä lisätään läsnäolijaksi käsin, joten hänellä ei ole rekisterin
  // henkilöä; sähköposti tulee läsnäolijan riviltä (Jukka 24.9.2026).
  it("käsin lisätty läsnäolija allekirjoittaa omalla sähköpostillaan", () => {
    const plan = planMinutesSigners({ ...base, board_minutes_signers: "all_present" }, [
      { display_name: "Olavi Jouttijärvi", email: "pj@example.test", party_id: "p1" },
      { display_name: "Eila Hokkanen", email: "eh@example.test", party_id: "p2" },
      { display_name: "Jukka Taskinen, isännöitsijä", email: "jukka.taskinen@adepta.fi", party_id: null },
    ]);
    expect(plan.problems).toEqual([]);
    expect(plan.signers.map((s) => [s.name, s.role])).toEqual([
      ["Olavi Jouttijärvi", "Puheenjohtaja"],
      ["Eila Hokkanen", "Hallituksen jäsen"],
      ["Jukka Taskinen, isännöitsijä", "Läsnä ollut"],
    ]);
  });

  it("kaikki läsnä olleet vaatii läsnäolomerkinnät", () => {
    expect(planMinutesSigners({ ...base, board_minutes_signers: "all_present" }, []).problems[0]).toMatch(/läsnä olleet/);
  });

  it("yhtiökokouksessa sääntöä ei käytetä", () => {
    const plan = planMinutesSigners({ ...base, kind: "annual_general", board_minutes_signers: "all_present" }, []);
    expect(plan.rule).toBeNull();
    expect(plan.signers.map((s) => s.role)).toEqual(["Puheenjohtaja", "Pöytäkirjantarkastaja"]);
  });
});

describe("ennen kokousta", () => {
  it("puheenjohtaja rekisteristä, kun kokoukselle ei ole kirjattu puheenjohtajaa", () => {
    const plan = planMinutesSigners(
      { ...base, chair_name: null, chair_email: null, board_minutes_signers: "all_present" },
      [
        { display_name: "Jouttijärvi Olavi", email: "pj@example.test" },
        { display_name: "Eila Hokkanen", email: "eh@example.test" },
      ],
      { registryChair: { name: "Jouttijärvi Olavi", email: "pj@example.test" }, preview: true },
    );
    expect(plan.problems).toEqual([]);
    expect(plan.chairFromRegistry).toBe(true);
    expect(plan.preview).toBe(true);
    expect(plan.signers.map((s) => [s.name, s.role])).toEqual([
      ["Jouttijärvi Olavi", "Puheenjohtaja"],
      ["Eila Hokkanen", "Hallituksen jäsen"],
    ]);
  });
});

describe("allekirjoittajien muutosloki", () => {
  it("kirjaa muutoksen vain, kun puheenjohtaja tai tarkastajat muuttuvat", async () => {
    const { minutesSignerChange } = await import("@/lib/meetings/minutes-signers");
    const before = { chair_name: "Olavi Jouttijärvi", chair_email: "pj@example.test", minutes_checkers: [{ name: "Martti Heinonen", email: "mh@example.test" }] };
    expect(minutesSignerChange(before, { ...before })).toBeNull();
    const change = minutesSignerChange(before, { ...before, minutes_checkers: [{ name: "Eila Hokkanen", email: "eh@example.test" }] });
    expect(change?.before.checkers).toEqual(["Martti Heinonen <mh@example.test>"]);
    expect(change?.after.checkers).toEqual(["Eila Hokkanen <eh@example.test>"]);
  });
});
