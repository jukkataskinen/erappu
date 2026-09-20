import { describe, expect, it } from "vitest";
import { buildExternalRef, createRoundOnce, type CreateRoundInput, type EsinettiClient, type Round } from "@/lib/esinetti";
import { EsinettiMockClient, resetMockEsinetti } from "@/lib/esinetti/mock";

/**
 * eSinetissä ei ole Idempotency-Key-tukea: jos luonti onnistuu siellä mutta
 * vastaus ei ehdi meille, uusi yritys tekisi toisen kierroksen ja samat
 * ihmiset saisivat kaksi allekirjoituspyyntöä. `createRoundOnce` estää sen
 * ulkoisen viitteen avulla.
 */

const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]);

const input = (externalRef: string): CreateRoundInput & { externalRef: string } => ({
  title: "As Oy Testi: pöytäkirja",
  documents: [{ name: "poytakirja.pdf", pdfBytes: pdf }],
  signers: [{ name: "Paula Puheenjohtaja", email: "paula@example.test", roleLabel: "Puheenjohtaja", authLevel: "strong" }],
  externalRef,
  expiresInDays: 30,
  send: true,
});

describe("createRoundOnce", () => {
  it("luo kierroksen kerran ja palauttaa saman uudelleenyrityksessä", async () => {
    resetMockEsinetti();
    const client = new EsinettiMockClient();
    const ref = buildExternalRef("meeting", "11111111-2222-3333-4444-555555555555");
    const first = await createRoundOnce(client, input(ref));
    const second = await createRoundOnce(client, input(ref));
    expect(second.id).toBe(first.id);
    expect(await client.findRoundByExternalRef(ref)).toMatchObject({ id: first.id, externalRef: ref });
  });

  it("eri viite on eri kierros, ja tuntematon viite on null", async () => {
    resetMockEsinetti();
    const client = new EsinettiMockClient();
    const a = await createRoundOnce(client, input(buildExternalRef("meeting", "11111111-2222-3333-4444-555555555555")));
    const b = await createRoundOnce(client, input(buildExternalRef("contract", "66666666-7777-8888-9999-000000000000")));
    expect(b.id).not.toBe(a.id);
    expect(await client.findRoundByExternalRef("erappu:meeting:puuttuu")).toBeNull();
  });

  it("peruttua kierrosta ei käytetä uudelleen", async () => {
    resetMockEsinetti();
    const client = new EsinettiMockClient();
    const ref = buildExternalRef("meeting", "22222222-3333-4444-5555-666666666666");
    const first = await createRoundOnce(client, input(ref));
    await client.cancelRound(first.id);
    expect(await client.findRoundByExternalRef(ref)).toBeNull();
    expect((await createRoundOnce(client, input(ref))).id).not.toBe(first.id);
  });

  it("ei kutsu luontia, jos haku löytää kierroksen", async () => {
    const existing = { id: "olemassa", status: "sent" } as unknown as Round;
    let created = 0;
    const client = {
      findRoundByExternalRef: async () => existing,
      createRound: async () => {
        created += 1;
        return existing;
      },
    } as unknown as EsinettiClient;
    expect(await createRoundOnce(client, input("erappu:meeting:x"))).toBe(existing);
    expect(created).toBe(0);
  });
});
