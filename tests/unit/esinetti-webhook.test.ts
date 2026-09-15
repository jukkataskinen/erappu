import { describe, expect, it } from "vitest";
import {
  buildExternalRef,
  buildWebhookSignatureHeader,
  parseExternalRef,
  parseWebhookPayload,
  verifyWebhookSignature,
} from "@/lib/esinetti/webhook";

const secret = "whsec_testi";
const body = JSON.stringify({
  id: "evt_1",
  event: "round.completed",
  created_at: "2026-09-15T10:00:00Z",
  data: {
    round_id: "r1",
    external_ref: "erappu:meeting:11111111-2222-4333-8444-555555555555",
    status: "completed",
    signers: [{ id: "s1", name: "Pj", email: "pj@example.test", status: "signed", signed_at: "2026-09-15T09:59:00Z" }],
    documents: [{ id: "d1", name: "poytakirja.pdf", sealed_sha256: "abc", download_url: null }],
  },
});

describe("eSinetti-webhookin allekirjoitus", () => {
  const now = 1_790_000_000;

  it("hyväksyy oikean allekirjoituksen (sama algoritmi kuin eSinetin signature.ts)", () => {
    const header = buildWebhookSignatureHeader(secret, now, body);
    expect(header).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
    expect(verifyWebhookSignature(secret, header, body, now)).toBe(true);
  });

  it("hylkää väärän salaisuuden, muutetun rungon, vanhan aikaleiman ja väärän muodon", () => {
    const header = buildWebhookSignatureHeader(secret, now, body);
    expect(verifyWebhookSignature("toinen", header, body, now)).toBe(false);
    expect(verifyWebhookSignature(secret, header, body + " ", now)).toBe(false);
    expect(verifyWebhookSignature(secret, header, body, now + 301)).toBe(false);
    expect(verifyWebhookSignature(secret, "v1=abc", body, now)).toBe(false);
    expect(verifyWebhookSignature(secret, null, body, now)).toBe(false);
    expect(verifyWebhookSignature("", header, body, now)).toBe(false);
  });

  it("jäsentää payloadin ja kohteen tunnisteen", () => {
    const event = parseWebhookPayload(body);
    expect(event).toMatchObject({ id: "evt_1", event: "round.completed", roundId: "r1" });
    expect(event?.documents[0].id).toBe("d1");
    expect(parseExternalRef(event!.externalRef)).toEqual({ kind: "meeting", id: "11111111-2222-4333-8444-555555555555" });
    expect(parseWebhookPayload("{")).toBeNull();
    expect(parseWebhookPayload(JSON.stringify({ id: "x" }))).toBeNull();
  });

  it("tuntematon kohdetunniste ei kelpaa", () => {
    expect(parseExternalRef("tenancy:11111111-2222-4333-8444-555555555555:alku")).toBeNull();
    expect(parseExternalRef("erappu:meeting:ei-uuid")).toBeNull();
    expect(parseExternalRef(null)).toBeNull();
    expect(buildExternalRef("meeting", "abc")).toBe("erappu:meeting:abc");
  });

  it("sopimuksen kohdetunniste", () => {
    expect(parseExternalRef("erappu:contract:11111111-2222-4333-8444-555555555555")).toEqual({ kind: "contract", id: "11111111-2222-4333-8444-555555555555" });
    expect(buildExternalRef("contract", "abc")).toBe("erappu:contract:abc");
    expect(parseExternalRef("erappu:invoice:11111111-2222-4333-8444-555555555555")).toBeNull();
    expect(parseExternalRef("erappu:contract:ei-uuid")).toBeNull();
  });
});
