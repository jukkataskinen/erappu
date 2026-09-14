/**
 * Kokousaika syötetään Helsingin aikana (päivä ja kellonaika), ja kantaan
 * tallennetaan hetki (timestamptz). Muunnos tehdään täällä eikä kannassa,
 * jotta se ei riipu kantapalvelimen aikavyöhyketiedoista.
 */

function helsinkiOffsetMinutes(instant: Date): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Helsinki", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
    }).formatToParts(instant).map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour) % 24, Number(parts.minute), Number(parts.second));
  return Math.round((asUtc - instant.getTime()) / 60000);
}

/** `2027-04-14` + `18:00` Helsingin aikaa → ISO-hetki. Palauttaa null, jos syöte ei kelpaa. */
export function helsinkiLocalToIso(date: string, time: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null;
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31 || hh > 23 || mm > 59) return null;
  const naive = Date.UTC(y, m - 1, d, hh, mm);
  // Kaksi kierrosta: kesäajan vaihtumispäivänä ensimmäinen arvio voi osua väärälle puolelle.
  let instant = naive - helsinkiOffsetMinutes(new Date(naive)) * 60000;
  instant = naive - helsinkiOffsetMinutes(new Date(instant)) * 60000;
  return new Date(instant).toISOString();
}

/** ISO-hetki → lomakkeen kentät Helsingin aikana. */
export function isoToHelsinkiLocal(iso: string | Date): { date: string; time: string } {
  const instant = typeof iso === "string" ? new Date(iso) : iso;
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Helsinki", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })
      .formatToParts(instant)
      .map((p) => [p.type, p.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${String(Number(parts.hour) % 24).padStart(2, "0")}:${parts.minute}` };
}
