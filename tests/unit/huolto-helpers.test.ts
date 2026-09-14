import { describe, expect, it } from "vitest";
import { stripJpegMetadata, stripPngMetadata } from "@/lib/service-requests/image-metadata";
import { providerOrderMessage, statusChangeMessage } from "@/lib/service-requests/messages";
import { clientIp, clientKey, windowStart } from "@/lib/service-requests/rate-limit";
import { optEur, publicRequestSchema, titleFromDescription } from "@/lib/service-requests/schemas";

const seg = (marker: number, payload: string) => {
  const body = Buffer.from(payload, "latin1");
  const head = Buffer.from([0xff, marker, 0, 0]);
  head.writeUInt16BE(body.length + 2, 2);
  return Buffer.concat([head, body]);
};

describe("kuvien metatiedot", () => {
  it("JPEG:stä poistuu EXIF (APP1) ja kommentti, JFIF ja kuvadata säilyvät", () => {
    const jpeg = Buffer.concat([
      Buffer.from([0xff, 0xd8]),
      seg(0xe0, "JFIF\0"),
      seg(0xe1, "Exif\0\0GPS 62.1 25.7"),
      seg(0xfe, "kommentti"),
      seg(0xdb, "taulukko"),
      Buffer.from([0xff, 0xda, 0x00, 0x04, 0x01, 0x02, 0xaa, 0xbb, 0xff, 0xd9]),
    ]);
    const out = stripJpegMetadata(jpeg)!;
    expect(out).not.toBeNull();
    expect(out.toString("latin1")).not.toContain("GPS");
    expect(out.toString("latin1")).not.toContain("kommentti");
    expect(out.toString("latin1")).toContain("JFIF");
    expect(out.subarray(-4)).toEqual(Buffer.from([0xaa, 0xbb, 0xff, 0xd9]));
  });

  it("rikkinäinen JPEG hylätään", () => {
    expect(stripJpegMetadata(Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff]))).toBeNull();
    expect(stripJpegMetadata(Buffer.from("ei kuva"))).toBeNull();
  });

  it("PNG:stä poistuu eXIf- ja tekstilohko", () => {
    const chunk = (type: string, data: string) => {
      const d = Buffer.from(data, "latin1");
      const len = Buffer.alloc(4);
      len.writeUInt32BE(d.length);
      return Buffer.concat([len, Buffer.from(type, "latin1"), d, Buffer.alloc(4)]);
    };
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("IHDR", "0123456789abc"),
      chunk("eXIf", "GPS"),
      chunk("tEXt", "Author\0Olli"),
      chunk("IDAT", "data"),
      chunk("IEND", ""),
    ]);
    const out = stripPngMetadata(png)!.toString("latin1");
    expect(out).toContain("IHDR");
    expect(out).toContain("IDAT");
    expect(out).not.toContain("GPS");
    expect(out).not.toContain("Olli");
  });
});

describe("ilmoitusten tekstit", () => {
  it("tilamuutosviestissä ei ole kuvausta eikä henkilötietoja, portaalilinkki vain portaalin ilmoittajalle", () => {
    const m = statusChangeMessage({ number: 12, category: "plumbing", companyName: "As Oy Testi", status: "done", portalRequestId: "abc", baseUrl: "https://erappu.test" });
    expect(m.subject).toBe("Huoltopyyntö #12: Valmis");
    expect(m.body).toContain("https://erappu.test/portaali/huoltopyynnot/abc");
    const anon = statusChangeMessage({ number: 12, category: "plumbing", companyName: "As Oy Testi", status: "in_progress", baseUrl: "https://erappu.test" });
    expect(anon.body).not.toContain("/portaali/");
  });

  it("tilausviestissä on tehtävälinkki ja voimassaolo", () => {
    const m = providerOrderMessage({ number: 3, category: "electrical", companyName: "As Oy Testi", address: "Testitie 1", urgent: true, token: "t0k3n", baseUrl: "https://erappu.test" });
    expect(m.subject).toContain("KIIREELLINEN");
    expect(m.body).toContain("https://erappu.test/tehtava/t0k3n");
    expect(m.body).toContain("30 päivää");
  });
});

describe("kutsurajoitin", () => {
  it("ikkuna alkaa tasatunnilta epookista laskettuna", () => {
    expect(windowStart(new Date("2026-09-15T10:59:59Z"), 60).toISOString()).toBe("2026-09-15T10:00:00.000Z");
    expect(windowStart(new Date("2026-09-15T11:45:00Z"), 120).toISOString()).toBe("2026-09-15T10:00:00.000Z");
  });

  it("IP-osoitteesta tallennetaan vain tiiviste; ensimmäinen välitetty osoite ratkaisee", () => {
    expect(clientIp("203.0.113.5, 10.0.0.1", null)).toBe("203.0.113.5");
    expect(clientIp(null, " 198.51.100.7 ")).toBe("198.51.100.7");
    const key = clientKey("203.0.113.5");
    expect(key).toMatch(/^[0-9a-f]{32}$/);
    expect(key).not.toContain("203");
    expect(clientKey("203.0.113.5")).toBe(key);
  });
});

describe("lomakkeet", () => {
  it("euromäärä hyväksyy pilkun ja välilyönnit", () => {
    expect(optEur.parse("1 234,50")).toBe(1234.5);
    expect(optEur.parse("")).toBeNull();
    expect(optEur.safeParse("-1").success).toBe(false);
  });

  it("otsikko muodostetaan kuvauksen ensimmäisestä rivistä", () => {
    expect(titleFromDescription("Hana vuotaa\nKeittiössä", "Muu")).toBe("Hana vuotaa");
    expect(titleFromDescription("   ", "Vesi ja viemäri")).toBe("Vesi ja viemäri");
    expect(titleFromDescription("x".repeat(120), "Muu")).toHaveLength(80);
  });

  it("julkisen lomakkeen roskapostiansa hylkää täytetyn piilokentän", () => {
    const valid = { token: "a".repeat(30), reporter_name: "Testi", unit_text: "B 1", category: "plumbing", description: "Hana vuotaa" };
    expect(publicRequestSchema.safeParse(valid).success).toBe(true);
    expect(publicRequestSchema.safeParse({ ...valid, website: "http://spam" }).success).toBe(false);
  });
});
