import { afterEach, describe, expect, it, vi } from "vitest";
import { assertRealPostita, estimatePrice, getPostitaClient, isPostitaError, postitaMode, resetPostitaClientForTests, toUrlSafeBase64 } from "@/lib/postita";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  resetPostitaClientForTests();
});

function httpMode() {
  vi.stubEnv("POSTITA_MODE", "http");
  vi.stubEnv("POSTITA_USERNAME", "tunnus");
  vi.stubEnv("POSTITA_PASSWORD", "sälasana");
}

function stubFetch(status: number, body: unknown) {
  const fetchMock = vi.fn(async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("Postita-asiakas", () => {
  it("lataa PDF:n URL-turvallisena base64:nä vahvistamattomana ja jakaa sen kirjeiksi", async () => {
    httpMode();
    const fetchMock = stubFetch(200, [{ id: 70579, status: "NE", name: "Kokouskutsu", price: "4,68", total_pages: 4, recipient_count: 2 }]);
    const job = await getPostitaClient().upload({ jobName: "Kokouskutsu", pdf: new Uint8Array([0xfb, 0xff, 0xfe, 0x01]), pagesPerLetter: 2, letterCount: 2, postClass: 2 });
    expect(job).toEqual({ id: "70579", status: "NE", price: 4.68, recipientCount: 2, totalPages: 4 });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://postita.fi/api/send/");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    // Tunnukset UTF-8:na (ä).
    expect(headers.Authorization).toBe(`Basic ${Buffer.from("tunnus:sälasana", "utf8").toString("base64")}`);
    expect(headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    const form = Object.fromEntries(new URLSearchParams(String(init.body)));
    // +/ korvattu -_:llä ja täytemerkki säilyy.
    expect(form).toEqual({ job_name: "Kokouskutsu", pdf: "-__-AQ==", post_class: "2", pdf_splitter: "2", confirm: "false" });
  });

  it("URL-turvallinen base64 on palautettavissa alkuperäiseksi", () => {
    const bytes = new Uint8Array(Array.from({ length: 300 }, (_, i) => (i * 37) % 256));
    const encoded = toUrlSafeBase64(bytes);
    expect(encoded).not.toMatch(/[+/]/);
    expect(new Uint8Array(Buffer.from(encoded, "base64url"))).toEqual(bytes);
  });

  it("vahvistaa, hakee tiedot ja poistaa työn oikeista osoitteista", async () => {
    httpMode();
    const fetchMock = stubFetch(200, [{ id: 7, status: "CO", price: "2.34" }]);
    const client = getPostitaClient();
    expect(await client.confirm("7")).toMatchObject({ id: "7", status: "CO", price: 2.34 });
    await client.jobInfo("7");
    await client.cancel("7");
    const calls = fetchMock.mock.calls as unknown as [string, RequestInit][];
    expect(calls.map(([u, i]) => `${i.method} ${u}`)).toEqual([
      "POST https://postita.fi/api/confirm/7/",
      "GET https://postita.fi/api/job_info/7/",
      "POST https://postita.fi/api/delete/7/",
    ]);
  });

  it("vahvistus ilman tilaa vastauksessa tulkitaan vahvistetuksi", async () => {
    httpMode();
    stubFetch(200, "");
    expect((await getPostitaClient().confirm("9")).status).toBe("CO");
  });

  it("401 ja 409 antavat yleisen virheen, johon vastauksen sisältöä ei kopioida", async () => {
    httpMode();
    stubFetch(401, "Invalid credentials for Matti Meikäläinen");
    const e401 = await getPostitaClient().upload({ jobName: "x", pdf: new Uint8Array([1]), pagesPerLetter: 1, letterCount: 1, postClass: 1 }).catch((e) => e);
    expect(isPostitaError(e401) && e401.code).toBe("unauthorized");
    expect(String(e401.message)).not.toContain("Matti");

    resetPostitaClientForTests();
    stubFetch(409, "Saldo ei riitä: Mannerheimintie 1");
    const e409 = await getPostitaClient().confirm("1").catch((e) => e);
    expect(isPostitaError(e409) && e409.code).toBe("rejected");
    expect(String(e409.message)).toMatch(/saldo ei riitä/);
    expect(String(e409.message)).not.toContain("Mannerheimintie");
  });

  it("tuntematon tila hylätään", async () => {
    httpMode();
    stubFetch(200, [{ id: 1, status: "XX" }]);
    await expect(getPostitaClient().jobInfo("1")).rejects.toMatchObject({ code: "bad_response" });
  });

  it("ilman tunnuksia ei yritetä lähettää", () => {
    vi.stubEnv("POSTITA_MODE", "http");
    vi.stubEnv("POSTITA_USERNAME", "");
    expect(() => getPostitaClient()).toThrow(/tunnuksia ei ole määritetty/);
  });

  it("jäljitelmä on oletus, eikä se kelpaa tuotannossa", () => {
    vi.stubEnv("POSTITA_MODE", "");
    expect(postitaMode()).toBe("mock");
    expect(getPostitaClient().mode).toBe("mock");
    vi.stubEnv("NODE_ENV", "production");
    expect(() => assertRealPostita()).toThrow(/ei ole otettu käyttöön/);
    vi.stubEnv("POSTITA_MODE", " HTTP ");
    expect(() => assertRealPostita()).not.toThrow();
  });

  it("jäljitelmä: vahvistus vain vahvistamattomalle työlle", async () => {
    const client = getPostitaClient();
    const job = await client.upload({ jobName: "x", pdf: new Uint8Array([1]), pagesPerLetter: 2, letterCount: 3, postClass: 2 });
    expect(job).toMatchObject({ status: "NE", recipientCount: 3, totalPages: 6 });
    expect((await client.confirm(job.id)).status).toBe("CO");
    await expect(client.confirm(job.id)).rejects.toMatchObject({ code: "rejected" });
  });

  it("hinta-arvio: perushinta ja lisäsivut", () => {
    expect(estimatePrice(10, 1, 2)).toBe(23.4);
    expect(estimatePrice(10, 3, 1)).toBe(35.9);
  });
});
