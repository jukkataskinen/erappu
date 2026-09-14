/** @jsxRuntime automatic */
/** @jsxImportSource react */
/**
 * Kokouskutsu ja asialista. LUONNOS: juridinen sisältö Jukan tarkistettava
 * (BLOCKERS 4).
 */

import { Page, Text, View } from "@react-pdf/renderer";
import { DocumentFooter, DocumentHeader, DocumentRoot, Heading, KeyValues, Muted, Paragraph, pageStyle } from "./components";
import { PageDecoration } from "./decorations";
import { formatDate, formatMeetingTime, orDash } from "./format";
import { colors, type as typeScale, weight } from "./theme";

export interface MeetingDocumentBase {
  organizationName: string;
  companyName: string;
  companyBusinessId: string | null;
  companyAddress: string | null;
  kind: "annual_general" | "extraordinary_general" | "board";
  startsAt: string;
  location: string | null;
  remoteParticipation: boolean;
  remoteUrl: string | null;
  fiscalYear: string | null;
  items: { position: number; title: string; proposal: string | null; decision?: string | null }[];
  manager: { name: string | null; email: string | null; phone: string | null } | null;
  /** Asiakirjan päiväys VVVV-KK-PP. */
  issuedOn: string;
}

export interface MeetingNoticeData extends MeetingDocumentBase {
  attachmentsNote: string | null;
}

const TITLE: Record<MeetingDocumentBase["kind"], string> = {
  annual_general: "Kutsu varsinaiseen yhtiökokoukseen",
  extraordinary_general: "Kutsu ylimääräiseen yhtiökokoukseen",
  board: "Kutsu hallituksen kokoukseen",
};

export function MeetingNotice({ data }: { data: MeetingNoticeData }) {
  const general = data.kind !== "board";
  const intro = general
    ? `${data.companyName} kutsuu osakkaat ${data.kind === "annual_general" ? "varsinaiseen" : "ylimääräiseen"} yhtiökokoukseen.`
    : `Hallituksen jäsenet kutsutaan hallituksen kokoukseen.`;
  const manager = data.manager;
  return (
    <DocumentRoot title={TITLE[data.kind]} subject={data.companyName} date={data.issuedOn}>
      <Page size="A4" style={pageStyle}>
        <PageDecoration />
        <DocumentHeader right={[data.companyName, data.companyBusinessId].filter(Boolean).join(" · ")} />
        <Text style={{ fontSize: typeScale.title, fontWeight: weight.bold, lineHeight: 1.25 }}>{TITLE[data.kind]}</Text>
        <Muted style={{ marginTop: 3 }}>{data.companyName}</Muted>
        <Paragraph style={{ marginTop: 10 }}>{intro}</Paragraph>

        <KeyValues
          items={[
            { label: "Aika", value: formatMeetingTime(data.startsAt) },
            { label: "Paikka", value: orDash(data.location) },
            {
              label: "Etäosallistuminen",
              value: data.remoteParticipation ? (data.remoteUrl ? `Mahdollinen: ${data.remoteUrl}` : "Mahdollinen, ohjeet lähetetään erikseen") : "Ei",
            },
            { label: "Tilikausi", value: orDash(data.fiscalYear) },
          ]}
        />

        <Heading>{general ? "Kokouksessa käsitellään" : "Esityslista"}</Heading>
        {data.items.length === 0 ? <Muted>Asialista puuttuu.</Muted> : null}
        {data.items.map((item) => (
          <View key={item.position} style={{ flexDirection: "row", marginTop: 5 }} wrap={false}>
            <Text style={{ width: 24, fontWeight: weight.bold }}>{item.position}.</Text>
            <View style={{ flex: 1 }}>
              <Text style={{ fontWeight: weight.medium }}>{item.title}</Text>
              {item.proposal ? <Text style={{ fontSize: typeScale.small, color: colors.inkSoft }}>{item.proposal}</Text> : null}
            </View>
          </View>
        ))}

        {data.attachmentsNote ? (
          <>
            <Heading>Asiakirjat</Heading>
            <Paragraph>{data.attachmentsNote}</Paragraph>
          </>
        ) : null}

        {general ? (
          <>
            <Heading>Osallistuminen</Heading>
            <Paragraph>
              Osakas voi osallistua kokoukseen itse tai asiamiehen välityksellä. Asiamiehen on esitettävä päivätty valtakirja. Osakas voi käyttää
              kokouksessa avustajaa.
            </Paragraph>
          </>
        ) : null}

        <View style={{ marginTop: 22 }} wrap={false}>
          <Text>{formatDate(data.issuedOn)}</Text>
          <Text style={{ marginTop: 8, fontWeight: weight.medium }}>{general ? "Hallitus" : "Hallituksen puheenjohtaja / isännöitsijä"}</Text>
          {manager ? (
            <Muted style={{ marginTop: 10 }}>
              {["Lisätietoja: isännöitsijä", manager.name, manager.email, manager.phone].filter(Boolean).join(", ")}
            </Muted>
          ) : null}
        </View>
        <DocumentFooter left={`${data.organizationName} · ${data.companyName}`} />
      </Page>
    </DocumentRoot>
  );
}
