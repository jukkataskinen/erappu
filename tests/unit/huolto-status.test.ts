import { describe, expect, it } from "vitest";
import { STATUSES } from "@/lib/service-requests/labels";
import {
  canStaffTransition, isOpen, isOverdue, isReopen, notifyReporterOfStatus, providerTransition, reporterTransition, staffTransitions,
} from "@/lib/service-requests/status";

describe("henkilökunnan tilasiirtymät", () => {
  it("jokaisesta tilasta pääsee johonkin, eikä mikään siirtymä johda samaan tilaan", () => {
    for (const s of STATUSES) {
      expect(staffTransitions(s).length).toBeGreaterThan(0);
      expect(staffTransitions(s)).not.toContain(s);
    }
  });

  it("suljettu ja hylätty avataan vain uudelleenavauksella vastaanotetuksi", () => {
    expect(staffTransitions("closed")).toEqual(["received"]);
    expect(staffTransitions("rejected")).toEqual(["received"]);
    expect(canStaffTransition("closed", "done")).toBe(false);
    expect(canStaffTransition("closed", "in_progress")).toBe(false);
  });

  it("uusi pyyntö voidaan käsitellä suoraan valmiiksi tai hylätä", () => {
    expect(canStaffTransition("new", "done")).toBe(true);
    expect(canStaffTransition("new", "rejected")).toBe(true);
    expect(canStaffTransition("in_progress", "new")).toBe(false);
  });

  it("uudelleenavaus tunnistetaan samalla säännöllä kuin kannassa", () => {
    expect(isReopen("done", "in_progress")).toBe(true);
    expect(isReopen("closed", "received")).toBe(true);
    expect(isReopen("done", "closed")).toBe(false);
    expect(isReopen("received", "ordered")).toBe(false);
  });
});

describe("palveluntuottajan kuittaukset", () => {
  it("vastaanotto ei muuta tilaa, aloitus vie työn alle ja valmis valmiiksi", () => {
    expect(providerTransition("ordered", "acknowledge")).toBe("ordered");
    expect(providerTransition("ordered", "start")).toBe("in_progress");
    expect(providerTransition("in_progress", "complete")).toBe("done");
    expect(providerTransition("waiting", "complete")).toBe("done");
  });

  it("valmiiseen, suljettuun tai hylättyyn ei voi kuitata", () => {
    for (const s of ["done", "closed", "rejected", "new"] as const) {
      expect(providerTransition(s, "acknowledge")).toBeNull();
      expect(providerTransition(s, "start")).toBeNull();
      expect(providerTransition(s, "complete")).toBeNull();
    }
    expect(providerTransition("in_progress", "start")).toBeNull();
  });
});

describe("ilmoittajan toiminnot", () => {
  it("vain valmiin voi kuitata suljetuksi", () => {
    expect(reporterTransition("done", "close")).toBe("closed");
    expect(reporterTransition("in_progress", "close")).toBeNull();
    expect(reporterTransition("closed", "close")).toBeNull();
  });

  it("valmiin tai suljetun voi avata uudelleen, hylättyä ei", () => {
    expect(reporterTransition("done", "reopen")).toBe("received");
    expect(reporterTransition("closed", "reopen")).toBe("received");
    expect(reporterTransition("rejected", "reopen")).toBeNull();
    expect(reporterTransition("new", "reopen")).toBeNull();
  });

  it("omasta toiminnosta ei lähetetä ilmoitusta", () => {
    expect(notifyReporterOfStatus("done", false)).toBe(true);
    expect(notifyReporterOfStatus("closed", true)).toBe(false);
  });
});

describe("avoimuus ja myöhästyminen", () => {
  it("vain avoimet voivat olla myöhässä", () => {
    expect(isOpen("waiting")).toBe(true);
    expect(isOpen("done")).toBe(false);
    expect(isOverdue("2026-09-10", "in_progress", "2026-09-15")).toBe(true);
    expect(isOverdue("2026-09-15", "in_progress", "2026-09-15")).toBe(false);
    expect(isOverdue("2026-09-10", "done", "2026-09-15")).toBe(false);
    expect(isOverdue(null, "new", "2026-09-15")).toBe(false);
  });
});
