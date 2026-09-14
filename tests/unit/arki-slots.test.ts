import { describe, expect, it } from "vitest";
import { daySlots, findSlot, helsinkiLocalToUtc, helsinkiOffsetMinutes, parseOpenHours, slotState, utcToHelsinki, weekSlots, weeklySlots } from "@/lib/bookings/slots";

const ALL_DAY = { mon: [["00:00", "24:00"]], tue: [["00:00", "24:00"]], wed: [["00:00", "24:00"]], thu: [["00:00", "24:00"]], fri: [["00:00", "24:00"]], sat: [["00:00", "24:00"]], sun: [["00:00", "24:00"]] } as const;
const hours = parseOpenHours(ALL_DAY);

describe("Helsingin aika", () => {
  it("talvi- ja kesäaika", () => {
    expect(helsinkiOffsetMinutes(Date.parse("2026-01-15T12:00:00Z"))).toBe(120);
    expect(helsinkiOffsetMinutes(Date.parse("2026-07-15T12:00:00Z"))).toBe(180);
    expect(new Date(helsinkiLocalToUtc("2026-07-15", 18 * 60)!).toISOString()).toBe("2026-07-15T15:00:00.000Z");
    expect(utcToHelsinki("2026-01-15T22:30:00Z")).toEqual({ date: "2026-01-16", time: "00:30" });
  });

  it("kevään siirrossa 03:00–03:59 ei ole olemassa", () => {
    expect(helsinkiLocalToUtc("2026-03-29", 3 * 60)).toBeNull();
    expect(new Date(helsinkiLocalToUtc("2026-03-29", 4 * 60)!).toISOString()).toBe("2026-03-29T01:00:00.000Z");
  });

  it("syksyn siirrossa kahdesti esiintyvä 03:00 tulkitaan kesäajaksi", () => {
    expect(new Date(helsinkiLocalToUtc("2026-10-25", 3 * 60)!).toISOString()).toBe("2026-10-25T00:00:00.000Z");
  });
});

describe("vuorot", () => {
  it("aukioloaika ja vuoron pituus", () => {
    const h = parseOpenHours({ mon: [["18:00", "22:00"]], wed: [["06:00", "08:00"], ["18:00", "21:00"]] });
    const week = weekSlots("2026-09-16", h, 60);
    expect(week[0].date).toBe("2026-09-14");
    expect(week[0].slots.map((s) => s.startLocal)).toEqual(["18:00", "19:00", "20:00", "21:00"]);
    expect(week[1].slots).toEqual([]);
    expect(week[2].slots.map((s) => `${s.startLocal}-${s.endLocal}`)).toEqual(["06:00-07:00", "07:00-08:00", "18:00-19:00", "19:00-20:00", "20:00-21:00"]);
    expect(week[0].slots[0].startsAt).toBe("2026-09-14T15:00:00.000Z");
  });

  it("vajaa viimeinen vuoro jätetään pois", () => {
    const h = parseOpenHours({ mon: [["18:00", "21:30"]] });
    expect(daySlots("2026-09-14", h, 60).map((s) => s.startLocal)).toEqual(["18:00", "19:00", "20:00"]);
  });

  it("kevään siirtopäivänä ei vuoroa 03:00 eivätkä vuorot mene päällekkäin", () => {
    const slots = daySlots("2026-03-29", hours, 60).slice(0, 5);
    expect(slots.map((s) => s.startLocal)).toEqual(["00:00", "01:00", "02:00", "04:00", "05:00"]);
    expect(slots.map((s) => s.startsAt)).toEqual([
      "2026-03-28T22:00:00.000Z", "2026-03-28T23:00:00.000Z", "2026-03-29T00:00:00.000Z", "2026-03-29T01:00:00.000Z", "2026-03-29T02:00:00.000Z",
    ]);
    expect(slots[2].endsAt).toBe("2026-03-29T01:00:00.000Z");
    expect(daySlots("2026-03-29", hours, 60)).toHaveLength(23);
  });

  it("syksyn siirtopäivänä vuorot jatkuvat ilman päällekkäisyyttä, vaihteen vuoro on 2 h", () => {
    const slots = daySlots("2026-10-25", hours, 60);
    expect(slots).toHaveLength(24);
    for (let i = 1; i < slots.length; i++) expect(slots[i].startsAt).toBe(slots[i - 1].endsAt);
    const s3 = slots.find((s) => s.startLocal === "03:00")!;
    expect(s3.startsAt).toBe("2026-10-25T00:00:00.000Z");
    expect(s3.endsAt).toBe("2026-10-25T02:00:00.000Z");
  });

  it("vakiovuoro säilyttää seinäkelloajan kesäajan päättyessä", () => {
    const h = parseOpenHours({ thu: [["18:00", "22:00"]] });
    const first = daySlots("2026-10-15", h, 60)[0];
    const series = weeklySlots(first, 3, h, 60);
    expect(series.map((s) => s.startsAt)).toEqual(["2026-10-15T15:00:00.000Z", "2026-10-22T15:00:00.000Z", "2026-10-29T16:00:00.000Z"]);
  });

  it("vain aukioloaikojen mukainen alkuhetki kelpaa", () => {
    const h = parseOpenHours({ mon: [["18:00", "22:00"]] });
    expect(findSlot("2026-09-14T15:00:00.000Z", h, 60)?.startLocal).toBe("18:00");
    expect(findSlot("2026-09-14T15:30:00.000Z", h, 60)).toBeNull();
    expect(findSlot("2026-09-15T15:00:00.000Z", h, 60)).toBeNull();
  });

  it("vuoron tila: vapaa, varattu, oma, mennyt", () => {
    const h = parseOpenHours({ mon: [["18:00", "20:00"]] });
    const [a, b] = daySlots("2026-09-14", h, 60);
    const busy = [{ starts_at: a.startsAt, ends_at: a.endsAt, mine: false, own_booking_id: null }];
    const now = new Date("2026-09-01T00:00:00Z");
    expect(slotState(a, busy, now).state).toBe("busy");
    expect(slotState(b, busy, now).state).toBe("free");
    expect(slotState(b, [{ starts_at: b.startsAt, ends_at: b.endsAt, mine: true, own_booking_id: "x" }], now)).toEqual({ state: "mine", bookingId: "x" });
    expect(slotState(b, [], new Date("2026-09-15T00:00:00Z")).state).toBe("past");
  });

  it("virheelliset aukioloajat hylätään", () => {
    expect(parseOpenHours({ mon: [["22:00", "18:00"]] })).toEqual({});
    expect(parseOpenHours({ mon: [["25:00", "26:00"]] })).toEqual({});
    expect(parseOpenHours("rikki" as unknown)).toEqual({});
  });
});
