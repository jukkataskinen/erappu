/**
 * Yhtiön perusdokumentit ja niiden puuttumisen päättely. Puhdasta logiikkaa,
 * jotta säännöt voi testata ilman kantaa.
 */

export interface BasicDocInput {
  category: string;
  year: number | null;
}

export interface MissingBasicDoc {
  category: "articles" | "financial_statement" | "energy_certificate";
  label: string;
  reason: string;
}

/**
 * Viimeisin tilikausi, jonka tilinpäätöksen pitäisi jo olla: yhtiökokous
 * pidetään kuuden kuukauden kuluessa tilikauden päättymisestä, joten
 * heinäkuusta alkaen edellisen vuoden tilinpäätös odotetaan, sitä ennen
 * toissavuoden. Oletus: tilikausi = kalenterivuosi.
 */
export function expectedFinancialStatementYear(today: Date): number {
  const y = today.getFullYear();
  return today.getMonth() >= 6 ? y - 1 : y - 2;
}

/** Energiatodistus on voimassa kymmenen vuotta. */
export const ENERGY_CERTIFICATE_VALID_YEARS = 10;

export function missingBasicDocuments(docs: BasicDocInput[], today = new Date()): MissingBasicDoc[] {
  const out: MissingBasicDoc[] = [];
  const of = (c: string) => docs.filter((d) => d.category === c);

  if (of("articles").length === 0) {
    out.push({ category: "articles", label: "Yhtiöjärjestys", reason: "Yhtiöjärjestystä ei ole tallennettu." });
  }

  const expected = expectedFinancialStatementYear(today);
  const statements = of("financial_statement");
  const latest = Math.max(...statements.map((d) => d.year ?? 0), 0);
  if (statements.length === 0) {
    out.push({ category: "financial_statement", label: "Tilinpäätös", reason: "Tilinpäätöksiä ei ole tallennettu." });
  } else if (latest < expected) {
    out.push({ category: "financial_statement", label: "Tilinpäätös", reason: `Tilinpäätös ${expected} puuttuu.` });
  }

  const certs = of("energy_certificate");
  if (certs.length === 0) {
    out.push({ category: "energy_certificate", label: "Energiatodistus", reason: "Energiatodistusta ei ole tallennettu." });
  } else {
    const newest = Math.max(...certs.map((d) => d.year ?? 0));
    // Vuodeton todistus hyväksytään, koska vanhoista todistuksista vuosi puuttuu usein.
    if (certs.every((d) => d.year !== null) && newest + ENERGY_CERTIFICATE_VALID_YEARS < today.getFullYear()) {
      out.push({ category: "energy_certificate", label: "Energiatodistus", reason: `Energiatodistus (${newest}) on vanhentunut.` });
    }
  }
  return out;
}
