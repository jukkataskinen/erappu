/** Access-tuonnin muunnokset. Puhtaita funktioita, testattu tests/unit/access-mapping.test.ts. */

export function toFraction(value: number | null): { numerator: number; denominator: number; guessed: boolean } {
  if (value === null || !Number.isFinite(value) || value <= 0 || value > 1) return { numerator: 1, denominator: 1, guessed: true };
  // Yleiset osuudet kuolinpesissä ja yhteisomistuksessa. Esim. 0,66 = 2/3, mutta 0,54 on 54/100 eikä 6/11.
  for (const d of [1, 2, 3, 4, 5, 6, 8, 10, 12]) {
    const num = Math.round(value * d);
    if (num > 0 && Math.abs(num / d - value) < 0.007) return { numerator: num, denominator: d, guessed: false };
  }
  return { numerator: Math.round(value * 100), denominator: 100, guessed: false };
}

export function mapUnitKind(use: string | null): "apartment" | "commercial" | "parking" | "garage" | "storage" | "other" {
  const u = (use ?? "").toLowerCase();
  if (u.includes("asuin/toimisto") || u.includes("asuinhuoneisto") || u === "asunto") return "apartment";
  if (u.includes("autokatos") || u.includes("autopaikka")) return "parking";
  if (u.includes("autotalli")) return "garage";
  if (u.includes("varasto")) return "storage";
  if (u.includes("liike") || u.includes("toimisto") || u.includes("kahvio")) return "commercial";
  return use ? "other" : "apartment";
}

/** Poimii kiinteistötunnuksen tekstistä, esim. "Aamurusko II 850-405-0005-0563-X" → "850-405-5-563". */
export function parsePropertyCode(text: string | null): string | null {
  if (!text) return null;
  const m = /(\d{1,3})-(\d{1,3})-(\d{1,4})-(\d{1,4})/.exec(text);
  if (!m) return null;
  return m.slice(1, 5).map((p) => String(Number(p))).join("-");
}

export function splitPostal(text: string | null): { postal: string | null; city: string | null } {
  if (!text) return { postal: null, city: null };
  const m = /^(\d{5})\s+(.+)$/.exec(text.trim());
  return m ? { postal: m[1], city: m[2] } : { postal: null, city: text.trim() };
}

export function repairWorkType(target: string | null): string {
  const t = (target ?? "").toLowerCase();
  if (t.includes("lvi")) return "LVI (tarkennettava)";
  if (t.includes("katto")) return "Vesikatto";
  if (t.includes("ovet") || t.includes("ikkuna")) return "Ikkunat ja ovet";
  return "Muu";
}

export function isCompanyName(name: string): boolean {
  return /\b(oy|oyj|ab|ky|ay|tmi|ry|rs|kunta|kaupunki|säätiö|seurakunta|osuuskunta)\b/i.test(name);
}
