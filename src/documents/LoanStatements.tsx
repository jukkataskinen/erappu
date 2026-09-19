/** @jsxRuntime automatic */
/** @jsxImportSource react */
/**
 * Tilinpäätöksen liite: vastikkeiden käyttö (jälkilaskelma, AOYL 10:5 §:n
 * 1 kohta) ja lainaosuuslaskelmat huoneistoittain. Ei omistajien nimiä:
 * lainaosuus kuuluu osakeryhmälle.
 */

import { Page, Text, View } from "@react-pdf/renderer";
import { DataTable, DocumentFooter, DocumentHeader, DocumentRoot, Heading, KeyValues, Muted, Paragraph, pageStyle } from "./components";
import { formatDate, formatInteger } from "./format";
import { colors, type as typeScale, weight } from "./theme";

export interface LoanStatementsData {
  organizationName: string;
  companyName: string;
  businessId: string;
  periodStart: string;
  periodEnd: string;
  issuedOn: string;
  /** Laskelman rivit valmiiksi muotoiltuina (€). */
  maintenance: { label: string; value: string; strong?: boolean }[] | null;
  financing: { label: string; value: string; strong?: boolean }[] | null;
  usageText: string[];
  loans: {
    name: string;
    details: string;
    summary: { label: string; value: string }[];
    rows: { unit: string; shares: number; opening: string; lumpSum: string; amortization: string; closing: string; note: string }[];
    totals: { opening: string; lumpSum: string; amortization: string; closing: string };
    warnings: string[];
  }[];
}

function Statement({ rows }: { rows: { label: string; value: string; strong?: boolean }[] }) {
  return (
    <View style={{ marginTop: 6 }}>
      {rows.map((r, i) => (
        <View
          key={i}
          style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 3, borderTopWidth: r.strong ? 0.75 : 0, borderTopColor: colors.ink }}
          wrap={false}
        >
          <Text style={{ fontWeight: r.strong ? weight.bold : weight.regular }}>{r.label}</Text>
          <Text style={{ fontWeight: r.strong ? weight.bold : weight.regular }}>{r.value}</Text>
        </View>
      ))}
    </View>
  );
}

export function LoanStatements({ data }: { data: LoanStatementsData }) {
  const periodText = `${formatDate(data.periodStart)}–${formatDate(data.periodEnd)}`;
  const columns = [
    { key: "unit", label: "Huoneisto", flex: 1 },
    { key: "shares", label: "Osakkeet", flex: 0.8, align: "right" as const },
    { key: "opening", label: `Osuus ${formatDate(data.periodStart)}`, flex: 1.3, align: "right" as const },
    { key: "lumpSum", label: "Kertasuoritus", flex: 1.2, align: "right" as const },
    { key: "amortization", label: "Lyhennys", flex: 1.1, align: "right" as const },
    { key: "closing", label: `Osuus ${formatDate(data.periodEnd)}`, flex: 1.3, align: "right" as const },
    { key: "note", label: "", flex: 1.2 },
  ];
  return (
    <DocumentRoot title={`Vastikkeiden käyttö ja lainaosuuslaskelmat ${periodText}`} subject={data.companyName} date={data.issuedOn}>
      <Page size="A4" style={pageStyle}>
        <DocumentHeader right={data.companyName} />
        <Text style={{ fontSize: typeScale.title, fontWeight: weight.bold, lineHeight: 1.25 }}>Vastikkeiden käyttö ja lainaosuuslaskelmat</Text>
        <Muted style={{ marginTop: 3 }}>
          {data.companyName} ({data.businessId}), tilikausi {periodText}
        </Muted>
        <KeyValues
          columns={3}
          items={[
            { label: "Tilikausi", value: periodText },
            { label: "Lainoja", value: formatInteger(data.loans.length) },
            { label: "Laadittu", value: formatDate(data.issuedOn) },
          ]}
        />

        {data.maintenance ? (
          <View wrap={false}>
            <Heading>Hoitolaskelma</Heading>
            <Statement rows={data.maintenance} />
          </View>
        ) : null}

        {data.financing ? (
          <View wrap={false}>
            <Heading>Rahoitusvastikelaskelma</Heading>
            <Statement rows={data.financing} />
          </View>
        ) : null}

        {data.usageText.length ? (
          <View>
            <Heading>Tiedot yhtiövastikkeen käytöstä (AOYL 10:5 § 1 kohta)</Heading>
            {data.usageText.map((t, i) => (
              <Paragraph key={i}>{t}</Paragraph>
            ))}
          </View>
        ) : null}

        {data.loans.map((l) => (
          <View key={l.name} break={data.loans.length > 0}>
            <Heading>Lainaosuuslaskelma: {l.name}</Heading>
            {l.details ? <Muted>{l.details}</Muted> : null}
            <KeyValues columns={3} items={l.summary} />
            <DataTable
              columns={columns}
              rows={[
                ...l.rows.map((r) => ({ ...r, shares: formatInteger(r.shares) })),
                { unit: "Yhteensä", shares: "", opening: l.totals.opening, lumpSum: l.totals.lumpSum, amortization: l.totals.amortization, closing: l.totals.closing, note: "" },
              ]}
            />
            {l.warnings.length ? (
              <View style={{ marginTop: 6 }}>
                {l.warnings.map((w, i) => (
                  <Muted key={i}>Huomio: {w}</Muted>
                ))}
              </View>
            ) : null}
          </View>
        ))}

        <View style={{ marginTop: 10 }}>
          <Muted>
            Lainaosuudet on jaettu osakkeiden suhteessa niille osakeryhmille, jotka eivät ole maksaneet osuuttaan kertasuorituksena. Lainojen saldot, lyhennykset
            ja korot perustuvat lainanantajan saldotietoihin ja kirjanpitoon.
          </Muted>
        </View>
        <DocumentFooter left={`${data.organizationName} · ${data.companyName}`} />
      </Page>
    </DocumentRoot>
  );
}
