/** @jsxRuntime automatic */
/** @jsxImportSource react */
/**
 * Osakkaan lainaosuuslaskelma: huoneiston osuudet yhtiölainoista,
 * kuukausittainen rahoitusvastike ja kertasuorituksen määrä valittuna
 * maksupäivänä maksuohjeineen. Annetaan osakkaalle esimerkiksi
 * kertasuorituspäätöstä tai asunnon myyntiä varten.
 */

import { Page, Text, View } from "@react-pdf/renderer";
import { DataTable, DocumentFooter, DocumentHeader, DocumentRoot, Heading, KeyValues, Muted, Panel, Paragraph, pageStyle } from "./components";
import { formatDate, formatInteger } from "./format";
import { colors, type as typeScale, weight } from "./theme";

export interface LoanShareCalculationData {
  organizationName: string;
  companyName: string;
  businessId: string;
  unitLabel: string;
  shareCount: number;
  shareRanges: string;
  owners: string;
  /** Kirjeen vastaanottaja: omistajat ja ensisijaisen maksajan postiosoite. */
  recipient: { name: string; lines: string[] } | null;
  /** Isännöitsijän yhteystiedot laskelman loppuun. */
  contact: string[];
  issuedOn: string;
  payOn: string;
  loans: {
    name: string;
    details: string;
    original: string;
    remaining: string;
    balanceDate: string;
    payAmount: string;
    /** "65 osaketta × 194,408462 €/osake" */
    perShare: string | null;
    estimated: boolean;
    paidOff: string | null;
  }[];
  monthlyFinancing: string | null;
  fee: string | null;
  feeLabel: string;
  total: string;
  payment: { iban: string | null; bic: string | null; reference: string | null } | null;
  notes: string[];
}

export function LoanShareCalculation({ data }: { data: LoanShareCalculationData }) {
  const open = data.loans.filter((l) => !l.paidOff);
  return (
    <DocumentRoot title={`Lainaosuuslaskelma, huoneisto ${data.unitLabel}`} subject={data.companyName} date={data.issuedOn}>
      <Page size="A4" style={pageStyle}>
        <DocumentHeader right={data.companyName} />
        {data.recipient ? (
          <View style={{ marginBottom: 18 }}>
            <Text style={{ fontSize: typeScale.small, color: colors.inkSoft }}>Vastaanottaja</Text>
            <Text style={{ marginTop: 2 }}>{data.recipient.name}</Text>
            {data.recipient.lines.map((l, i) => (
              <Text key={i}>{l}</Text>
            ))}
          </View>
        ) : null}
        <Text style={{ fontSize: typeScale.title, fontWeight: weight.bold, lineHeight: 1.25 }}>Lainaosuuslaskelma</Text>
        <Muted style={{ marginTop: 3 }}>
          {data.companyName} ({data.businessId}), huoneisto {data.unitLabel}
        </Muted>
        <KeyValues
          columns={3}
          items={[
            { label: "Huoneisto", value: data.unitLabel },
            { label: "Osakkeet", value: `${formatInteger(data.shareCount)}${data.shareRanges ? ` (${data.shareRanges})` : ""}` },
            { label: "Laadittu", value: formatDate(data.issuedOn) },
            { label: "Osakkaat", value: data.owners || "–" },
            { label: "Kertasuorituksen maksupäivä", value: formatDate(data.payOn) },
            { label: "Rahoitusvastike nyt", value: data.monthlyFinancing ? `${data.monthlyFinancing} / kk` : "–" },
          ]}
        />

        <Heading>Huoneiston lainaosuudet</Heading>
        <DataTable
          columns={[
            { key: "name", label: "Laina", flex: 2.2 },
            { key: "original", label: "Alkuperäinen osuus", flex: 1.3, align: "right" },
            { key: "remaining", label: "Jäljellä saldopäivänä", flex: 1.5, align: "right" },
            { key: "pay", label: `Kertasuoritus ${formatDate(data.payOn)}`, flex: 1.5, align: "right" },
          ]}
          rows={data.loans.map((l) => ({
            name: `${l.name}${l.details ? `\n${l.details}` : ""}`,
            original: l.original,
            remaining: l.paidOff ? "–" : `${l.remaining}\n${formatDate(l.balanceDate)}`,
            pay: l.paidOff ? l.paidOff : `${l.payAmount}${l.estimated ? " *" : ""}${l.perShare ? `\n${l.perShare}` : ""}`,
          }))}
          emptyText="Huoneistolla ei ole lainaosuuksia."
        />

        {open.length ? (
          <Panel style={{ marginTop: 12 }} wrap={false}>
            {data.fee ? (
              <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 4 }}>
                <Text>{data.feeLabel}</Text>
                <Text>{data.fee}</Text>
              </View>
            ) : null}
            <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
              <Text style={{ fontWeight: weight.bold }}>Kertasuoritus yhteensä {formatDate(data.payOn)}</Text>
              <Text style={{ fontWeight: weight.bold }}>{data.total}</Text>
            </View>
            {data.payment ? (
              <View style={{ marginTop: 8, borderTopWidth: 0.5, borderTopColor: colors.line, paddingTop: 6 }}>
                <Text style={{ fontSize: typeScale.small, color: colors.inkSoft }}>Maksuohje</Text>
                <Text>
                  Saaja {data.companyName}
                  {data.payment.iban ? `, tili ${data.payment.iban}` : ""}
                  {data.payment.bic ? ` (${data.payment.bic})` : ""}
                </Text>
                <Text>
                  {data.payment.reference ? `Viite ${data.payment.reference}, ` : ""}eräpäivä {formatDate(data.payOn)}
                </Text>
              </View>
            ) : null}
          </Panel>
        ) : null}

        <View style={{ marginTop: 10 }}>
          {data.notes.map((n, i) => (
            <Paragraph key={i} style={{ fontSize: typeScale.small, color: colors.inkSoft }}>
              {n}
            </Paragraph>
          ))}
        </View>
        {data.contact.length ? (
          <View style={{ marginTop: 14, borderTopWidth: 0.5, borderTopColor: colors.line, paddingTop: 6 }} wrap={false}>
            <Text style={{ fontSize: typeScale.small, color: colors.inkSoft }}>Lisätietoja</Text>
            <Text style={{ fontSize: typeScale.small }}>
              {data.organizationName}, {data.contact.join(", ")}
            </Text>
          </View>
        ) : null}
        <DocumentFooter left={`${data.organizationName} · ${data.companyName} · huoneisto ${data.unitLabel}`} />
      </Page>
    </DocumentRoot>
  );
}
