/** @jsxRuntime automatic */
/** @jsxImportSource react */
/**
 * Kokouksen pöytäkirja. LUONNOS: juridinen sisältö Jukan tarkistettava
 * (BLOCKERS 4). Allekirjoitukset kerätään eSinetissä; allekirjoitussivu
 * kertoo kuka allekirjoittaa.
 */

import { Page, Text, View } from "@react-pdf/renderer";
import { DocumentFooter, DocumentHeader, DocumentRoot, Heading, KeyValues, Muted, Signatures, pageStyle } from "./components";
import { formatDate, formatInteger, formatMeetingTime, orDash } from "./format";
import type { MeetingDocumentBase } from "./MeetingNotice";
import { colors, type as typeScale, weight } from "./theme";

export interface MinutesData extends MeetingDocumentBase {
  chairName: string | null;
  secretaryName: string | null;
  checkerNames: string[];
  attendance: {
    presentCount: number;
    representedShares: number;
    totalVotes: number;
    totalShares: number | null;
    names: string[];
  };
}

const TITLE: Record<MeetingDocumentBase["kind"], string> = {
  annual_general: "Varsinaisen yhtiökokouksen pöytäkirja",
  extraordinary_general: "Ylimääräisen yhtiökokouksen pöytäkirja",
  board: "Hallituksen kokouksen pöytäkirja",
};

export function Minutes({ data }: { data: MinutesData }) {
  const general = data.kind !== "board";
  const signatories = [
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
                ? `${formatInteger(data.attendance.presentCount)} osakasta, ${formatInteger(data.attendance.representedShares)} osaketta, ${formatInteger(data.attendance.totalVotes)} ääntä`
                : data.attendance.names.join(", ") || "–",
            },
            { label: "Tilikausi", value: orDash(data.fiscalYear) },
          ]}
        />
        {general ? <Muted style={{ marginTop: 4 }}>Ääniluettelo on pöytäkirjan liitteenä.</Muted> : null}

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
    </DocumentRoot>
  );
}
