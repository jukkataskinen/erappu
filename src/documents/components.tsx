/** @jsxRuntime automatic */
/** @jsxImportSource react */
/**
 * Asiakirjojen yhteiset palikat. Pohja Reilusopparista, merkki ja sävy eRapun.
 *
 * Yksittäinen asiakirja kokoaa näistä oman sisältönsä eikä määrittele omia
 * värejään tai välejään, jotta kokouskutsu, pöytäkirja ja
 * isännöitsijäntodistus pysyvät samaa asiakirjasarjaa.
 *
 * (JSX-pragma tiedoston alussa: Vitest ei käytä Nextin kääntäjää, ja
 * tsconfigin `jsx: preserve` jättäisi sen muuten klassiseen muunnokseen.)
 */

import { Document, Path, Rect, StyleSheet, Svg, Text, View } from "@react-pdf/renderer";
import type { Style } from "@react-pdf/stylesheet";
import type { ReactNode } from "react";
import { A4_HEIGHT, FONT_FAMILY, colors, radius, spacing, type as typeScale, weight } from "./theme";

const s = StyleSheet.create({
  page: {
    fontFamily: FONT_FAMILY,
    fontSize: typeScale.body,
    color: colors.ink,
    paddingTop: spacing.page,
    paddingBottom: spacing.page + 18,
    paddingHorizontal: spacing.page,
    lineHeight: 1.45,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 22,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  brand: { flexDirection: "row", alignItems: "center" },
  brandName: { fontSize: 12, fontWeight: weight.bold, marginLeft: 6 },
  headerRight: { fontSize: typeScale.small, color: colors.inkSoft, textAlign: "right", maxWidth: 300 },
  title: { fontSize: typeScale.title, fontWeight: weight.bold, lineHeight: 1.2 },
  subtitle: { fontSize: typeScale.subtitle, color: colors.inkSoft, marginTop: 4, lineHeight: 1.4 },
  panel: { backgroundColor: colors.panel, borderRadius: radius.panel, padding: spacing.panel },
  heading: { fontSize: typeScale.heading, fontWeight: weight.bold, marginBottom: 6, marginTop: spacing.block },
  label: { fontSize: typeScale.label, color: colors.inkFaint },
  value: { fontSize: typeScale.body, fontWeight: weight.medium, marginTop: 1 },
  footer: {
    position: "absolute",
    // `top` eikä `bottom`: Reilusopparissa `bottom`-sijoitettu alatunniste jäi
    // hiljaa piirtymättä (ks. Reilusopparin components.tsx).
    top: A4_HEIGHT - 34,
    left: spacing.page,
    right: spacing.page,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  footerText: { fontSize: typeScale.label, color: colors.inkFaint },
  th: { fontSize: typeScale.label, color: colors.inkSoft, fontWeight: weight.bold, paddingVertical: 4, paddingHorizontal: 4 },
  td: { fontSize: typeScale.small, paddingVertical: 4, paddingHorizontal: 4 },
});

export const pageStyle = s.page;

/** eRapun merkki: talon ääriviiva, nouseva porras ja coral-ovi (sama kuin `src/components/Brand.tsx`). */
export function LogoMark({ size = 16 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Path d="M12 44 L50 14 L88 44 L88 86 L12 86 Z" stroke={colors.ink} strokeWidth={7} strokeLinejoin="round" fill="none" />
      <Rect x={24} y={68} width={16} height={12} rx={2.5} fill={colors.sky} />
      <Rect x={40} y={56} width={16} height={24} rx={2.5} fill={colors.sky} />
      <Rect x={56} y={44} width={16} height={36} rx={2.5} fill={colors.sky} />
      <Rect x={60} y={30} width={8} height={8} rx={2} fill={colors.coral} />
    </Svg>
  );
}

/**
 * Asiakirjan juuri. Aikaleimat asiakirjan omasta päiväyksestä, jotta sama
 * sisältö tuottaa samat tavut (ks. `render.ts`).
 */
export function DocumentRoot({ title, subject, date, children }: { title: string; subject: string; date: string; children: ReactNode }) {
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : "2000-01-01";
  const timestamp = new Date(iso + "T00:00:00.000Z");
  return (
    <Document title={title} subject={subject} author="eRappu" creator="eRappu" producer="eRappu" language="fi" creationDate={timestamp} modificationDate={timestamp}>
      {children}
    </Document>
  );
}

export function DocumentHeader({ right }: { right?: string }) {
  return (
    <View style={s.header} fixed>
      <View style={s.brand}>
        <LogoMark />
        <Text style={s.brandName}>
          <Text style={{ color: colors.sky }}>e</Text>Rappu
        </Text>
      </View>
      {right ? <Text style={s.headerRight}>{right}</Text> : null}
    </View>
  );
}

/** Alatunniste joka sivulla. Sivunumero vain monisivuisessa asiakirjassa. */
export function DocumentFooter({ left }: { left: string }) {
  return (
    <View style={s.footer} fixed>
      <Text style={s.footerText}>{left}</Text>
      <Text style={s.footerText} fixed render={({ pageNumber, totalPages }) => (totalPages > 1 ? `${pageNumber} / ${totalPages}` : "")} />
    </View>
  );
}

export function Title({ children, lead }: { children: ReactNode; lead?: string | null }) {
  return (
    <View>
      <Text style={s.title}>{children}</Text>
      {lead ? <Text style={s.subtitle}>{lead}</Text> : null}
    </View>
  );
}

export function Panel({ children, style, wrap }: { children: ReactNode; style?: Style; wrap?: boolean }) {
  return (
    <View wrap={wrap} style={[s.panel, style ?? {}]}>
      {children}
    </View>
  );
}

export function Heading({ children }: { children: ReactNode }) {
  return (
    <Text style={s.heading} minPresenceAhead={40}>
      {children}
    </Text>
  );
}

export function Paragraph({ children, style }: { children: ReactNode; style?: Style }) {
  return <Text style={[{ marginTop: 4 }, style ?? {}]}>{children}</Text>;
}

export function Muted({ children, style }: { children: ReactNode; style?: Style }) {
  return <Text style={[{ fontSize: typeScale.small, color: colors.inkSoft }, style ?? {}]}>{children}</Text>;
}

export interface KeyValue {
  label: string;
  value: string;
}

/** Avaintiedot kahdessa sarakkeessa riveittäin, jotta lukujärjestys säilyy sivunvaihdossa. */
export function KeyValues({ items, columns = 2 }: { items: KeyValue[]; columns?: 1 | 2 | 3 }) {
  const rows: KeyValue[][] = [];
  for (let i = 0; i < items.length; i += columns) rows.push(items.slice(i, i + columns));
  const width = `${100 / columns}%`;
  return (
    <Panel style={{ marginTop: 8 }}>
      {rows.map((row, index) => (
        <View key={index} style={{ flexDirection: "row", marginTop: index === 0 ? 0 : 7 }} wrap={false}>
          {row.map((item) => (
            <View key={item.label} style={{ width, paddingRight: 10 }}>
              <Text style={s.label}>{item.label}</Text>
              <Text style={s.value}>{item.value}</Text>
            </View>
          ))}
        </View>
      ))}
    </Panel>
  );
}

export interface Column {
  key: string;
  label: string;
  /** Suhteellinen leveys. */
  flex?: number;
  align?: "left" | "right";
}

/** Yksinkertainen taulukko. Otsikkorivi toistuu sivunvaihdon jälkeen (`fixed`). */
export function DataTable({ columns, rows, emptyText = "Ei rivejä." }: { columns: Column[]; rows: Record<string, string>[]; emptyText?: string }) {
  return (
    <View style={{ marginTop: 6 }}>
      <View style={{ flexDirection: "row", borderBottomWidth: 1, borderBottomColor: colors.ink }} fixed>
        {columns.map((c) => (
          <Text key={c.key} style={[s.th, { flex: c.flex ?? 1, textAlign: c.align ?? "left" }]}>
            {c.label}
          </Text>
        ))}
      </View>
      {rows.length === 0 ? (
        <Text style={[s.td, { color: colors.inkSoft }]}>{emptyText}</Text>
      ) : (
        rows.map((row, index) => (
          <View key={index} style={{ flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: colors.line }} wrap={false}>
            {columns.map((c) => (
              <Text key={c.key} style={[s.td, { flex: c.flex ?? 1, textAlign: c.align ?? "left" }]}>
                {row[c.key] ?? ""}
              </Text>
            ))}
          </View>
        ))
      )}
    </View>
  );
}

export interface Signatory {
  role: string;
  name: string;
}

/**
 * Allekirjoitusrivit. Nimet valmiina viivan alla: pöytäkirja allekirjoitetaan
 * sähköisesti eSinetissä, ja viiva kertoo kuka allekirjoittaa.
 */
export function Signatures({ place, date, signatories }: { place: string; date: string; signatories: Signatory[] }) {
  const rows: Signatory[][] = [];
  for (let i = 0; i < signatories.length; i += 2) rows.push(signatories.slice(i, i + 2));
  return (
    <View style={{ marginTop: 20 }} wrap={false}>
      <Text style={s.label}>Paikka ja aika</Text>
      <Text style={{ marginTop: 2 }}>
        {place} {date}
      </Text>
      {rows.map((row, index) => (
        <View key={index} style={{ flexDirection: "row", marginTop: 30 }}>
          {row.map((signatory) => (
            <View key={signatory.role + signatory.name} style={{ width: "50%", paddingRight: 20 }}>
              <View style={{ borderTopWidth: 1, borderTopColor: colors.inkFaint, marginBottom: 3 }} />
              <Text>{signatory.name || " "}</Text>
              <Text style={s.label}>{signatory.role}</Text>
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

/** Selvä luonnosmerkintä, kun pohjan juridista sisältöä ei ole vielä hyväksytty. */
export function DraftBanner({ text }: { text: string }) {
  return (
    <View style={{ borderWidth: 1.5, borderColor: colors.coral, borderRadius: radius.pill, padding: 7, marginBottom: 12 }}>
      <Text style={{ color: colors.coral, fontWeight: weight.bold, fontSize: typeScale.body, textAlign: "center" }}>{text}</Text>
    </View>
  );
}
