import { describe, expect, it } from "vitest";
import { z } from "zod";
import { emptyToNull, formObject } from "@/lib/forms";

/**
 * Sama osapuoliskeema palvelee useaa lomaketta, joilla on eri kentät
 * (hallituksen lisäys ei kysy puhelinta eikä osoitetta). Puuttuva kenttä
 * ei saa kaataa tallennusta.
 */
const optText = z.preprocess(emptyToNull, z.string().max(500).nullable());
const partyLike = z.object({
  last_name: optText,
  phone: optText,
  postal_code: z.preprocess(emptyToNull, z.string().nullable()),
});

describe("lomakkeiden apurit", () => {
  it("puuttuva ja tyhjä kenttä ovat null", () => {
    expect(emptyToNull(undefined)).toBeNull();
    expect(emptyToNull("   ")).toBeNull();
    expect(emptyToNull("Heiska")).toBe("Heiska");
  });

  it("skeema hyväksyy lomakkeen, jolta puuttuu valinnaisia kenttiä", () => {
    const r = partyLike.safeParse({ last_name: "Heiska" });
    expect(r.success).toBe(true);
    expect(r.success && r.data).toEqual({ last_name: "Heiska", phone: null, postal_code: null });
  });

  it("formObject siistii arvot ja jättää palvelintoiminnon kentät pois", () => {
    const fd = new FormData();
    fd.set("last_name", "  Heiska  ");
    fd.set("$ACTION_ID_x", "1");
    expect(formObject(fd)).toEqual({ last_name: "Heiska" });
  });
});
