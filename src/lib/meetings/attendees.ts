/**
 * Ääniluettelon esitäyttö osakasluettelosta.
 *
 * Yhteisomistuksessa oleva osakeryhmä äänestää yhtenä (yhteisomistajat
 * käyttävät oikeuttaan yhteisen edustajan kautta), joten esitäytössä
 * osakeryhmät ryhmitellään omistajajoukon mukaan: sama henkilö tai sama
 * yhteisomistajien joukko saa yhden rivin, johon lasketaan kaikki sen
 * osakeryhmien osakkeet.
 */

export interface OwnershipInput {
  party_id: string;
  display_name: string;
  share_group_id: string;
  unit_label: string;
  share_count: number;
}

export interface AttendeeDraft {
  partyId: string;
  displayName: string;
  shareGroupIds: string[];
  unitLabels: string[];
  shares: number;
}

export function groupOwnersForVoting(rows: OwnershipInput[]): AttendeeDraft[] {
  const byGroup = new Map<string, { parties: Map<string, string>; unitLabel: string; shares: number }>();
  for (const r of rows) {
    const g = byGroup.get(r.share_group_id) ?? { parties: new Map(), unitLabel: r.unit_label, shares: Number(r.share_count) || 0 };
    g.parties.set(r.party_id, r.display_name);
    byGroup.set(r.share_group_id, g);
  }

  const bySet = new Map<string, AttendeeDraft>();
  for (const [groupId, g] of byGroup) {
    const parties = [...g.parties.entries()].sort((a, b) => a[1].localeCompare(b[1], "fi") || a[0].localeCompare(b[0]));
    const key = parties.map(([id]) => id).join("+");
    const draft = bySet.get(key) ?? {
      partyId: parties[0][0],
      displayName: parties.map(([, name]) => name).join(" ja "),
      shareGroupIds: [],
      unitLabels: [],
      shares: 0,
    };
    draft.shareGroupIds.push(groupId);
    draft.unitLabels.push(g.unitLabel);
    draft.shares += g.shares;
    bySet.set(key, draft);
  }

  return [...bySet.values()]
    .map((d) => ({ ...d, unitLabels: [...d.unitLabels].sort((a, b) => a.localeCompare(b, "fi", { numeric: true })) }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName, "fi"));
}
