import { describe, expect, it } from "vitest";
import { serialize } from "@/lib/db/serial";

describe("transaktion kyselyjono", () => {
  it("ajaa rinnakkaiset kutsut yksi kerrallaan kutsujärjestyksessä", async () => {
    let running = 0;
    let maxRunning = 0;
    const order: number[] = [];
    const run = serialize(async (n: number, ms: number) => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      await new Promise((r) => setTimeout(r, ms));
      order.push(n);
      running--;
      return n;
    });
    const results = await Promise.all([run(1, 20), run(2, 1), run(3, 5)]);
    expect(results).toEqual([1, 2, 3]);
    expect(order).toEqual([1, 2, 3]);
    expect(maxRunning).toBe(1);
  });

  it("epäonnistunut kysely ei pysäytä jonoa", async () => {
    const run = serialize(async (fail: boolean) => {
      if (fail) throw new Error("virhe");
      return "ok";
    });
    const [a, b] = await Promise.allSettled([run(true), run(false)]);
    expect(a.status).toBe("rejected");
    expect(b).toEqual({ status: "fulfilled", value: "ok" });
  });
});
