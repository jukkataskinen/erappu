/**
 * Äänimäärät yhtiökokouksessa.
 *
 * Jokainen osake tuottaa yhden äänen (`votesPerShare`), ellei yhtiöjärjestys
 * määrää toisin. AOYL 6:13 §:n äänileikkuri: kukaan ei saa kokouksessa
 * äänestää yli viidesosalla kokouksessa edustettujen osakkeiden
 * yhteenlasketusta äänimäärästä. Yhtiöjärjestys voi poiketa tästä, joten
 * raja on parametri (`capFraction`, `null` = ei leikkuria).
 *
 * Leikkuri lasketaan kerran edustettujen täysistä äänistä eikä toistuvasti
 * leikattujen äänien perusteella. Tulkinta on kirjattu DECISIONS.md:hen
 * Jukan tarkistettavaksi.
 */

export interface VoterInput {
  id: string;
  shares: number;
  /** Onko osakas läsnä tai edustettuna. Poissaolevat eivät kasvata leikkurin pohjaa. */
  present: boolean;
}

export interface VoterResult {
  id: string;
  shares: number;
  present: boolean;
  /** Äänet ennen leikkuria. */
  fullVotes: number;
  /** Äänet leikkurin jälkeen. Poissaolevalla 0. */
  votes: number;
  capped: boolean;
}

export interface VoteOptions {
  votesPerShare?: number;
  capFraction?: number | null;
}

export interface VoteSummary {
  voters: VoterResult[];
  /** Edustettujen osakkeiden täysi äänimäärä. */
  representedVotes: number;
  /** Suurin sallittu äänimäärä yhdelle äänestäjälle (kokonaisina ääninä). `null` = ei rajaa. */
  cap: number | null;
  /** Äänet leikkurin jälkeen yhteensä. */
  totalVotes: number;
  representedShares: number;
}

export const DEFAULT_CAP_FRACTION = 1 / 5;

export function computeVotes(voters: VoterInput[], options: VoteOptions = {}): VoteSummary {
  const votesPerShare = options.votesPerShare ?? 1;
  const capFraction = options.capFraction === undefined ? DEFAULT_CAP_FRACTION : options.capFraction;
  if (!(votesPerShare > 0)) throw new Error("votesPerShare on oltava positiivinen");
  if (capFraction !== null && !(capFraction > 0 && capFraction <= 1)) throw new Error("capFraction on välillä (0, 1]");

  const normalized = voters.map((v) => ({ ...v, shares: Math.max(0, Math.floor(v.shares)) }));
  const representedShares = normalized.filter((v) => v.present).reduce((s, v) => s + v.shares, 0);
  const representedVotes = representedShares * votesPerShare;
  // Ääniä ei jaeta osiin: raja pyöristetään alaspäin kokonaisiin ääniin.
  const cap = capFraction === null ? null : Math.floor(representedVotes * capFraction + 1e-9);

  const results = normalized.map<VoterResult>((v) => {
    const fullVotes = v.shares * votesPerShare;
    if (!v.present) return { id: v.id, shares: v.shares, present: false, fullVotes, votes: 0, capped: false };
    const capped = cap !== null && fullVotes > cap;
    return { id: v.id, shares: v.shares, present: true, fullVotes, votes: capped ? cap! : fullVotes, capped };
  });

  return {
    voters: results,
    representedVotes,
    cap,
    totalVotes: results.reduce((s, r) => s + r.votes, 0),
    representedShares,
  };
}

const pct = (part: number, whole: number) => `${(Math.round((part / whole) * 1000) / 10).toLocaleString("fi-FI", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`;
const int = (n: number) => n.toLocaleString("fi-FI").replace(/\u00a0/g, " ");

/**
 * Pöytäkirjan toteamus edustetuista osakkeista ja äänistä: määrät ja osuus
 * yhtiön kaikista osakkeista ja äänistä (osake = yksi ääni). Jos äänileikkuri
 * rajaa jonkun ääniä, mainitaan enimmäisäänimäärä ja käytettävissä olevat äänet.
 */
export function attendanceStatement(input: {
  presentCount: number;
  representedShares: number;
  representedVotes: number;
  votesAfterCap: number;
  cap: number | null;
  capped: boolean;
  totalShares: number | null;
}): string {
  const { presentCount, representedShares, representedVotes, totalShares } = input;
  if (presentCount === 0) return "Kokouksessa ei ole merkitty läsnä olevia tai edustettuja osakkaita.";
  const whole = totalShares && totalShares > 0 ? totalShares : null;
  const shares = whole ? `${int(representedShares)} osaketta eli ${pct(representedShares, whole)} yhtiön ${int(whole)} osakkeesta` : `${int(representedShares)} osaketta`;
  const votes = whole ? `${int(representedVotes)} ääntä eli ${pct(representedVotes, whole)} yhtiön kaikista äänistä` : `${int(representedVotes)} ääntä`;
  const who = presentCount === 1 ? "1 osakas, joka edusti" : `${int(presentCount)} osakasta, jotka edustivat`;
  const cap = input.capped && input.cap !== null
    ? ` Äänileikkurin (AOYL 6:13 §) mukaan yhden osakkaan äänimäärä on enintään ${int(input.cap)}, joten kokouksessa voidaan käyttää yhteensä ${int(input.votesAfterCap)} ääntä.`
    : "";
  return `Kokouksessa oli läsnä tai valtakirjalla edustettuna ${who} ${shares} ja ${votes}.${cap}`;
}
