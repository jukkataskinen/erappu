import { afterEach, describe, expect, it, vi } from "vitest";
import { fennoaEnvironment, getFennoaClient } from "@/lib/fennoa";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("Fennoa-asiakas", () => {
  it("testitila vie luonnoksen sales_api/add-rajapintaan", async () => {
    vi.stubEnv("FENNOA_MODE", "test");
    vi.stubEnv("FENNOA_TEST_API_USER", "api");
    vi.stubEnv("FENNOA_TEST_API_KEY", "avain");
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ status: "OK", id: 991 }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await getFennoaClient().addInvoice({ customer_no: "1042", "row[1][name]": "Tiedote" })).toEqual({ id: "991" });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://app.fennoa.com/api/sales_api/add");
    expect((init.headers as Record<string, string>).Authorization).toBe(`Basic ${Buffer.from("api:avain").toString("base64")}`);
    expect(new URLSearchParams(String(init.body)).get("customer_no")).toBe("1042");
  });

  it("virhe ja hylätyt tunnukset", async () => {
    vi.stubEnv("FENNOA_MODE", "test");
    vi.stubEnv("FENNOA_TEST_API_USER", "api");
    vi.stubEnv("FENNOA_TEST_API_KEY", "avain");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 401 })));
    await expect(getFennoaClient().addInvoice({})).rejects.toThrow(/hylkäsi tunnukset/);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ status: "ERROR", message: "customer_no not found" }), { status: 200 })));
    await expect(getFennoaClient().addInvoice({})).rejects.toThrow("Fennoa: customer_no not found");
  });

  it("tuotantoon ei viedä, eikä jäljitelmä kelpaa tuotannossa", () => {
    vi.stubEnv("FENNOA_MODE", "production");
    expect(() => getFennoaClient()).toThrow(/tuotantoon/);
    expect(fennoaEnvironment()).toBeNull();
    vi.stubEnv("FENNOA_MODE", "");
    expect(fennoaEnvironment()).toBe("mock");
    vi.stubEnv("NODE_ENV", "production");
    expect(fennoaEnvironment()).toBeNull();
    expect(() => getFennoaClient()).toThrow(/ei ole otettu käyttöön/);
  });
});
