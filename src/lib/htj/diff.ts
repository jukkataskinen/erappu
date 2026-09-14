import { formatRanges, type ShareRange } from "@/lib/registry/share-ranges";
import type { HtjCompany, HtjOwner, HtjShareGroup, HtjShareGroupKind } from "./types";

/**
 * Rekisterin ja HTJ:n vertailu.
 *
 * Puhdas funktio: saa paikallisen tilan ja HTJ:n tilan ja palauttaa erot.
 * Mitään ei kirjoiteta, ennen kuin isännöitsijä hyväksyy eron (`sync.ts`).
 *
 * Osakeryhmät yhdistetään järjestyksessä: HTJ-tunniste → huoneistotunnus →
 * samat osakevälit. Omistukset yhdistetään saman osakeryhmän sisällä:
 * omistusmerkinnän tunniste → omistajan HTJ-viite → nimi. Omistajanvaihdos
 * näkyy kahtena erona (vanha omistus päättyy, uusi alkaa), koska ne ovat
 * eri henkilöitä ja eri päätöksiä.
 *
 * Ensimmäisessä vertailussa myös täsmäävät rivit tulevat erona
 * (`linkOnly`), koska vasta hyväksyntä merkitsee rivin HTJ-peräiseksi.
 */

export interface LocalShareGroup {
  id: string;
  unitLabel: string;
  kind: string;
  areaM2: number | null;
  intendedUse: string | null;
  layout: string | null;
  floor: string | null;
  ranges: ShareRange[];
  htjId: string | null;
}

export interface LocalOwnership {
  id: string;
  shareGroupId: string;
  partyId: string;
  partyHtjId: string | null;
  name: string;
  numerator: number;
  denominator: number;
  startsOn: string | null;
  htjId: string | null;
}

export type DiffEntity = "share_group" | "ownership";
export type DiffAction = "add" | "update" | "remove";

export interface ShareGroupSnapshot {
  htjId: string | null;
  unitLabel: string;
  kind: string;
  areaM2: number | null;
  intendedUse: string | null;
  layout: string | null;
  floor: string | null;
  ranges: ShareRange[];
  localId?: string | null;
  linkOnly?: boolean;
}

export interface OwnershipSnapshot {
  htjId: string | null;
  ownerRef: string | null;
  shareGroupHtjId: string | null;
  localShareGroupId: string | null;
  unitLabel: string;
  kind: "person" | "company" | "estate";
  name: string;
  firstNames: string | null;
  lastName: string | null;
  companyName: string | null;
  businessId: string | null;
  numerator: number;
  denominator: number;
  startsOn: string | null;
  protected: boolean;
  contact: { streetAddress: string | null; postalCode: string | null; city: string | null } | null;
  partyId?: string | null;
  linkOnly?: boolean;
}

export interface DiffItem {
  entity: DiffEntity;
  action: DiffAction;
  localId: string | null;
  htjRef: string | null;
  label: string;
  before: ShareGroupSnapshot | OwnershipSnapshot | null;
  after: ShareGroupSnapshot | OwnershipSnapshot | null;
  /** Hyväksyttyjen erojen kirjoitusjärjestys (pienin ensin). */
  sortOrder: number;
}

export const SORT = {
  ownershipRemove: 10,
  shareGroupRemove: 20,
  shareGroupUpdate: 30,
  shareGroupAdd: 40,
  ownershipUpdate: 50,
  ownershipAdd: 60,
} as const;

export const normalizeLabel = (s: string) => s.replace(/\s+/g, "").toUpperCase();

/** Nimen vertailu: kirjainkoko, välilyönnit ja nimien järjestys eivät ratkaise. */
export const normalizeName = (s: string) =>
  s
    .toLocaleLowerCase("fi")
    .replace(/[,.]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(" ");

const rangesKey = (r: ShareRange[]) => formatRanges(r);

const sameFraction = (a: { numerator: number; denominator: number }, b: { numerator: number; denominator: number }) =>
  a.numerator * b.denominator === b.numerator * a.denominator;

const KINDS: HtjShareGroupKind[] = ["apartment", "commercial", "parking", "garage", "storage", "other"];

function localSnapshot(g: LocalShareGroup): ShareGroupSnapshot {
  return { htjId: g.htjId, unitLabel: g.unitLabel, kind: g.kind, areaM2: g.areaM2, intendedUse: g.intendedUse, layout: g.layout, floor: g.floor, ranges: g.ranges, localId: g.id };
}

function htjSnapshot(g: HtjShareGroup, local: LocalShareGroup | null): ShareGroupSnapshot {
  return {
    htjId: g.htjId,
    unitLabel: g.unitLabel,
    kind: KINDS.includes(g.kind) ? g.kind : "other",
    areaM2: g.areaM2,
    intendedUse: g.intendedUse,
    // HTJ ei välttämättä palauta huoneistotyyppiä tai kerrosta; silloin säilytetään oma tieto.
    layout: g.layout ?? local?.layout ?? null,
    floor: g.floor ?? local?.floor ?? null,
    ranges: [...g.ranges].sort((a, b) => a.first - b.first),
    localId: local?.id ?? null,
  };
}

/** Kentät, joissa HTJ:n tieto poikkeaa rekisteristä. */
export function shareGroupChanges(before: ShareGroupSnapshot, after: ShareGroupSnapshot): string[] {
  const changed: string[] = [];
  if (before.unitLabel !== after.unitLabel) changed.push("unitLabel");
  if (before.kind !== after.kind) changed.push("kind");
  if (after.areaM2 !== null && (before.areaM2 === null || Math.abs(Number(before.areaM2) - Number(after.areaM2)) > 0.05)) changed.push("areaM2");
  if (after.intendedUse !== null && (before.intendedUse ?? "") !== after.intendedUse) changed.push("intendedUse");
  if ((before.layout ?? "") !== (after.layout ?? "")) changed.push("layout");
  if ((before.floor ?? "") !== (after.floor ?? "")) changed.push("floor");
  if (rangesKey(before.ranges) !== rangesKey(after.ranges)) changed.push("ranges");
  return changed;
}

function ownershipLocalSnapshot(o: LocalOwnership, unitLabel: string): OwnershipSnapshot {
  return {
    htjId: o.htjId, ownerRef: o.partyHtjId, shareGroupHtjId: null, localShareGroupId: o.shareGroupId, unitLabel, kind: "person", name: o.name,
    firstNames: null, lastName: null, companyName: null, businessId: null, numerator: o.numerator, denominator: o.denominator, startsOn: o.startsOn,
    protected: false, contact: null, partyId: o.partyId,
  };
}

function ownershipHtjSnapshot(o: HtjOwner, unitLabel: string, localShareGroupId: string | null, partyId: string | null): OwnershipSnapshot {
  const isProtected = o.protected === true;
  return {
    htjId: o.htjId,
    ownerRef: o.ownerRef,
    shareGroupHtjId: o.shareGroupHtjId,
    localShareGroupId,
    unitLabel,
    kind: o.kind,
    name: o.name,
    firstNames: o.firstNames,
    lastName: o.lastName,
    companyName: o.companyName,
    businessId: o.businessId,
    numerator: o.shareFraction.numerator,
    denominator: o.shareFraction.denominator,
    startsOn: o.startsOn,
    protected: isProtected,
    // Turvakiellon alaisen henkilön osoitetta ei tallenneta edes eroihin.
    contact: isProtected || !o.contact ? null : { streetAddress: o.contact.streetAddress, postalCode: o.contact.postalCode, city: o.contact.city },
    partyId,
    // Syntymäaikaa ja henkilötunnusta ei kopioida tarkoituksella.
  };
}

const fraction = (n: number, d: number) => (n === d ? "koko" : `${n}/${d}`);

export interface HtjState {
  shareGroups: HtjShareGroup[];
  owners: HtjOwner[];
}

export interface LocalState {
  shareGroups: LocalShareGroup[];
  ownerships: LocalOwnership[];
}

export function diffRegistry(local: LocalState, htj: HtjState): DiffItem[] {
  const out: DiffItem[] = [];
  const unmatchedLocal = new Set(local.shareGroups.map((g) => g.id));
  const pairs: { local: LocalShareGroup | null; htj: HtjShareGroup }[] = [];

  const takeLocal = (pred: (g: LocalShareGroup) => boolean) => {
    const g = local.shareGroups.find((x) => unmatchedLocal.has(x.id) && pred(x));
    if (g) unmatchedLocal.delete(g.id);
    return g ?? null;
  };

  // Kolme kierrosta, jotta tunnisteella yhdistetty ei varaa toisen nimeä.
  const pending = [...htj.shareGroups];
  const matched = new Map<string, LocalShareGroup>();
  for (const h of pending) {
    const g = takeLocal((x) => x.htjId !== null && x.htjId === h.htjId);
    if (g) matched.set(h.htjId, g);
  }
  for (const h of pending) {
    if (matched.has(h.htjId)) continue;
    const g = takeLocal((x) => x.htjId === null && normalizeLabel(x.unitLabel) === normalizeLabel(h.unitLabel));
    if (g) matched.set(h.htjId, g);
  }
  for (const h of pending) {
    if (matched.has(h.htjId) || h.ranges.length === 0) continue;
    const g = takeLocal((x) => x.htjId === null && x.ranges.length > 0 && rangesKey(x.ranges) === rangesKey(h.ranges));
    if (g) matched.set(h.htjId, g);
  }
  for (const h of pending) pairs.push({ local: matched.get(h.htjId) ?? null, htj: h });

  for (const { local: l, htj: h } of pairs) {
    const after = htjSnapshot(h, l);
    if (!l) {
      out.push({ entity: "share_group", action: "add", localId: null, htjRef: h.htjId, label: `${h.unitLabel}: uusi osakeryhmä (osakkeet ${formatRanges(h.ranges)})`, before: null, after, sortOrder: SORT.shareGroupAdd });
    } else {
      const before = localSnapshot(l);
      const changes = shareGroupChanges(before, after);
      const linkOnly = changes.length === 0;
      if (!linkOnly || l.htjId !== h.htjId) {
        out.push({
          entity: "share_group", action: "update", localId: l.id, htjRef: h.htjId,
          label: linkOnly ? `${h.unitLabel}: tiedot täsmäävät, merkitään HTJ-peräiseksi` : `${h.unitLabel}: tiedot muuttuvat HTJ:n mukaan`,
          before, after: { ...after, linkOnly }, sortOrder: SORT.shareGroupUpdate,
        });
      }
    }
  }

  // Rekisterin osakeryhmät, joita HTJ:ssä ei ole.
  for (const l of local.shareGroups.filter((g) => unmatchedLocal.has(g.id))) {
    for (const o of local.ownerships.filter((x) => x.shareGroupId === l.id)) {
      out.push({ entity: "ownership", action: "remove", localId: o.id, htjRef: null, label: `${l.unitLabel}: omistus ${o.name} päättyy (osakeryhmää ei ole HTJ:ssä)`, before: ownershipLocalSnapshot(o, l.unitLabel), after: null, sortOrder: SORT.ownershipRemove });
    }
    out.push({ entity: "share_group", action: "remove", localId: l.id, htjRef: null, label: `${l.unitLabel}: osakeryhmää ei ole HTJ:ssä`, before: localSnapshot(l), after: null, sortOrder: SORT.shareGroupRemove });
  }

  // Omistukset osakeryhmittäin.
  for (const { local: l, htj: h } of pairs) {
    const htjOwners = htj.owners.filter((o) => o.shareGroupHtjId === h.htjId);
    const localOwners = l ? local.ownerships.filter((o) => o.shareGroupId === l.id) : [];
    const free = new Set(localOwners.map((o) => o.id));
    const take = (pred: (o: LocalOwnership) => boolean) => {
      const o = localOwners.find((x) => free.has(x.id) && pred(x));
      if (o) free.delete(o.id);
      return o ?? null;
    };
    const ownerMatch = new Map<string, LocalOwnership>();
    for (const o of htjOwners) {
      const m = take((x) => x.htjId !== null && x.htjId === o.htjId);
      if (m) ownerMatch.set(o.htjId, m);
    }
    for (const o of htjOwners) {
      if (ownerMatch.has(o.htjId)) continue;
      const m = take((x) => x.partyHtjId !== null && x.partyHtjId === o.ownerRef);
      if (m) ownerMatch.set(o.htjId, m);
    }
    for (const o of htjOwners) {
      if (ownerMatch.has(o.htjId)) continue;
      const m = take((x) => normalizeName(x.name) === normalizeName(o.name));
      if (m) ownerMatch.set(o.htjId, m);
    }

    for (const o of htjOwners) {
      const m = ownerMatch.get(o.htjId);
      const after = ownershipHtjSnapshot(o, h.unitLabel, l?.id ?? null, m?.partyId ?? null);
      if (!m) {
        out.push({
          entity: "ownership", action: "add", localId: null, htjRef: o.htjId,
          label: `${h.unitLabel}: uusi omistaja ${o.name} (${fraction(o.shareFraction.numerator, o.shareFraction.denominator)})`,
          before: null, after, sortOrder: SORT.ownershipAdd,
        });
        continue;
      }
      const fractionChanged = !sameFraction(m, o.shareFraction);
      if (fractionChanged || m.htjId !== o.htjId || m.partyHtjId !== o.ownerRef) {
        out.push({
          entity: "ownership", action: "update", localId: m.id, htjRef: o.htjId,
          label: fractionChanged
            ? `${h.unitLabel}: omistajan ${o.name} osuus ${fraction(m.numerator, m.denominator)} → ${fraction(o.shareFraction.numerator, o.shareFraction.denominator)}`
            : `${h.unitLabel}: omistus ${o.name} täsmää, merkitään HTJ-peräiseksi`,
          before: ownershipLocalSnapshot(m, h.unitLabel), after: { ...after, linkOnly: !fractionChanged }, sortOrder: SORT.ownershipUpdate,
        });
      }
    }
    for (const o of localOwners.filter((x) => free.has(x.id))) {
      out.push({
        entity: "ownership", action: "remove", localId: o.id, htjRef: null, label: `${h.unitLabel}: omistus ${o.name} päättyy (ei HTJ:ssä)`,
        before: ownershipLocalSnapshot(o, h.unitLabel), after: null, sortOrder: SORT.ownershipRemove,
      });
    }
  }

  return out.sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label, "fi", { numeric: true }));
}

/** Yhtiötason huomiot, joita ei kirjoiteta automaattisesti (yhtiön tiedot ovat eRapun omia). */
export function companyWarnings(local: { name: string; total_shares: number | null }, htj: HtjCompany): string[] {
  const w: string[] = [];
  if (!htj.shareRegisterTransferred) w.push("Osakeluetteloa ei ole siirretty HTJ:hin.");
  if (normalizeName(local.name) !== normalizeName(htj.name)) w.push(`Yhtiön nimi HTJ:ssä on ${htj.name}.`);
  if (htj.totalShares !== null && local.total_shares !== htj.totalShares) {
    w.push(`Osakkeiden kokonaismäärä HTJ:ssä on ${htj.totalShares}, rekisterissä ${local.total_shares ?? "ei merkitty"}.`);
  }
  return w;
}
