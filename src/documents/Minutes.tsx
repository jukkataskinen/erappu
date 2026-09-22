/** @jsxRuntime automatic */
/** @jsxImportSource react */
/**
 * Kokouksen pöytäkirja. LUONNOS: juridinen sisältö Jukan tarkistettava
 * (BLOCKERS 4). Allekirjoitukset kerätään eSinetissä; allekirjoitussivu
 * kertoo kuka allekirjoittaa.
 */

import { cite } from "@/lib/meetings/governing-act";
import { attendanceItemPosition } from "@/lib/meetings/labels";
import { Page, Text, View } from "@react-pdf/renderer";
import { DataTable, DocumentFooter, DocumentHeader, DocumentRoot, Heading, KeyValues, Muted, Paragraph, Signatures, pageStyle } from "./components";
import { formatDate, formatInteger, formatMeetingTime, orDash } from "./format";
import type { MeetingDocumentBase } from "./MeetingNotice";
import { colors, type as typeScale, weight } from "./theme";

export interface MinutesData extends MeetingDocumentBase {
  chairName: string | null;
  secretaryName: string | null;
  checkerNames: string[];
  /** Hallituksen kokouksessa allekirjoittajat yhtiöjärjestyksen mukaan (minutes-signers.ts). */
  signatories?: { role: string; name: string }[];
  attendance: {
    presentCount: number;
    representedShares: number;
    totalVotes: number;
    totalShares: number | null;
    names: string[];
    /** Toteamus edustetuista osakkeista ja äänistä (määrä ja osuus), yhtiökokouksessa. */
    statement?: string | null;
    /** Ääniluettelo läsnä olleista, pöytäkirjan liitteeksi. */
    rows?: { name: string; units: string; proxy: string; shares: string; votes: string }[];
    totals?: { shares: string; votes: string };
  };
}

const formatPercent = (part: number, whole: number) =>
  `${(Math.round((part / whole) * 1000) / 10).toLocaleString("fi-FI", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`;

/** Asia, jossa läsnäolijat ja ääniluettelo todetaan. */

const TITLE: Record<MeetingDocumentBase["kind"], string> = {
  annual_general: "Varsinaisen yhtiökokouksen pöytäkirja",
  extraordinary_general: "Ylimääräisen yhtiökokouksen pöytäkirja",
  board: "Hallituksen kokouksen pöytäkirja",
};

export function Minutes({ data }: { data: MinutesData }) {
  const general = data.kind !== "board";
  const attendancePosition = attendanceItemPosition(data.items);
  const signatories = data.signatories?.length
    ? [...data.signatories.slice(0, 1), ...(data.secretaryName ? [{ role: "Sihteeri", name: data.secretaryName }] : []), ...data.signatories.slice(1)]
    : [
    { role: "Puheenjohtaja", name: data.chairName ?? "" },
    ...(data.secretaryName ? [{ role: "Sihteeri", name: data.secretaryName }] : []),
    ...(data.checkerNames.length > 0
      ? data.checkerNames.map((name) => ({ role: general ? "Pöytäkirjantarkastaja" : "Pöytäkirjan tarkastaja", name }))
      : [
          { role: "Pöytäkirjantarkastaja", name: "" },
          { role: "Pöytäkirjantarkastaja", name: "" },
        ]),
  ];

  return (
    <DocumentRoot title={TITLE[data.kind]} subject={data.companyName} date={data.issuedOn}>
      <Page size="A4" style={pageStyle}>
        <DocumentHeader right={[data.companyName, data.companyBusinessId].filter(Boolean).join(" · ")} />
        <Text style={{ fontSize: typeScale.title, fontWeight: weight.bold, lineHeight: 1.25 }}>{TITLE[data.kind]}</Text>
        <Muted style={{ marginTop: 3 }}>{data.companyName}</Muted>

        <KeyValues
          items={[
            { label: "Aika", value: formatMeetingTime(data.startsAt) },
            { label: "Paikka", value: orDash(data.location) + (data.remoteParticipation ? " (myös etäyhteys)" : "") },
            { label: "Puheenjohtaja", value: orDash(data.chairName) },
            { label: "Sihteeri", value: orDash(data.secretaryName) },
            {
              label: general ? "Läsnä ja edustettuina" : "Läsnä",
              value: general
                ? `${formatInteger(data.attendance.presentCount)} osakasta, ${formatInteger(data.attendance.representedShares)} osaketta${
                    data.attendance.totalShares ? ` (${formatPercent(data.attendance.representedShares, data.attendance.totalShares)})` : ""
                  }, ${formatInteger(data.attendance.totalVotes)} ääntä`
                : data.attendance.names.join(", ") || "–",
            },
            { label: "Tilikausi", value: orDash(data.fiscalYear) },
          ]}
        />


        {data.items.map((item) => (
          <View key={item.position} style={{ marginTop: 12 }} wrap={false}>
            <View style={{ flexDirection: "row" }}>
              <Text style={{ width: 28, fontWeight: weight.bold }}>{item.position} §</Text>
              <Text style={{ flex: 1, fontWeight: weight.bold }}>{item.title}</Text>
            </View>
            {item.proposal ? (
              <View style={{ marginLeft: 28, marginTop: 2 }}>
                <Text style={{ fontSize: typeScale.small, color: colors.inkSoft }}>{item.proposal}</Text>
              </View>
            ) : null}
            {item.attachments?.length ? (
              <View style={{ marginLeft: 28, marginTop: 2 }}>
                {item.attachments.map((a) => (
                  <Text key={a.label} style={{ fontSize: typeScale.small, color: colors.inkSoft }}>
                    {a.label}: {a.title}
                  </Text>
                ))}
              </View>
            ) : null}
            {item.position === attendancePosition && (general ? data.attendance.statement : data.attendance.names.length) ? (
              <View style={{ marginLeft: 28, marginTop: 3 }}>
                <Text>
                  {general
                    ? `${data.attendance.statement}${data.attendance.rows?.length ? " Ääniluettelo on pöytäkirjan liitteenä." : ""}`
                    : `Läsnä: ${data.attendance.names.join(", ")}.`}
                </Text>
              </View>
            ) : null}
            <View style={{ marginLeft: 28, marginTop: 3 }}>
              <Text>
                <Text style={{ fontWeight: weight.medium }}>Päätös: </Text>
                {item.decision?.trim() ? item.decision : "–"}
              </Text>
            </View>
          </View>
        ))}

        <Heading>Allekirjoitukset</Heading>
        <Muted>Pöytäkirja on tarkastettu ja hyväksytty. Allekirjoitukset kerätään sähköisesti.</Muted>
        <Signatures place={orDash(data.location)} date={formatDate(data.startsAt)} signatories={signatories} />
        <DocumentFooter left={`${data.organizationName} · ${data.companyName}`} />
      </Page>
      {general && data.attendance.rows?.length ? (
        <Page size="A4" style={pageStyle}>
          <DocumentHeader right={[data.companyName, data.companyBusinessId].filter(Boolean).join(" · ")} />
          <Text style={{ fontSize: typeScale.title, fontWeight: weight.bold, lineHeight: 1.25 }}>Liite: ääniluettelo</Text>
          <Muted style={{ marginTop: 3 }}>
            {TITLE[data.kind]} {formatDate(data.startsAt)} · läsnä ja valtakirjalla edustetut osakkaat ({cite(data.governingAct ?? "aoyl", "6:23", "5:23")})
          </Muted>
          <View style={{ marginTop: 10 }}>
            <DataTable
              columns={[
                { key: "name", label: "Osakas", flex: 3 },
                { key: "units", label: "Huoneistot", flex: 1.6 },
                { key: "proxy", label: "Asiamies", flex: 2 },
                { key: "shares", label: "Osakkeet", flex: 1, align: "right" },
                { key: "votes", label: "Äänet", flex: 1, align: "right" },
              ]}
              rows={[...data.attendance.rows, { name: "Yhteensä", units: "", proxy: "", shares: data.attendance.totals?.shares ?? "", votes: data.attendance.totals?.votes ?? "" }]}
            />
          </View>
          {data.attendance.statement ? <Paragraph style={{ marginTop: 10 }}>{data.attendance.statement}</Paragraph> : null}
          <DocumentFooter left={`${data.organizationName} · ${data.companyName} · ääniluettelo`} />
        </Page>
      ) : null}
    </DocumentRoot>
  );
}
