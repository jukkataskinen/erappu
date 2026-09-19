/** @jsxRuntime automatic */
/** @jsxImportSource react */
/**
 * Kokouskutsu ja asialista. LUONNOS: juridinen sisältö Jukan tarkistettava
 * (BLOCKERS 4).
 */

import type { GoverningAct } from "@/lib/meetings/governing-act";
import { Page, Text, View } from "@react-pdf/renderer";
import { DocumentFooter, DocumentHeader, DocumentRoot, Heading, KeyValues, Muted, Paragraph, pageStyle } from "./components";
import { PageDecoration } from "./decorations";
import { formatDate, formatMeetingTime, orDash } from "./format";
import { colors, type as typeScale, weight } from "./theme";

export interface MeetingDocumentBase {
  /** Sovellettava laki pykäläviittauksiin (0107). Oletus AOYL. */
  governingAct?: GoverningAct;
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

/** Täytettävä rivi: nimike ja viiva, jolle kirjoitetaan käsin. */
function FillLine({ label, height = 22 }: { label: string; height?: number }) {
  return (
    <View style={{ marginTop: 10 }} wrap={false}>
      <Text style={{ fontSize: typeScale.small, color: colors.inkSoft }}>{label}</Text>
      <View style={{ height, borderBottomWidth: 0.75, borderBottomColor: colors.ink }} />
    </View>
  );
}

/**
 * Valtakirjapohja yhtiökokoukseen (AOYL 6:8 §: valtuutetun on esitettävä
 * päivätty valtakirja; valtuutus koskee yhtä kokousta, jollei siitä muuta
 * ilmene). Kokouksen tiedot ovat valmiina, osakas täyttää loput käsin.
 */
function ProxyFormPage({ data }: { data: MeetingNoticeData }) {
  const meetingName = data.kind === "annual_general" ? "varsinaisessa yhtiökokouksessa" : "ylimääräisessä yhtiökokouksessa";
  return (
    <Page size="A4" style={pageStyle}>
      <DocumentHeader right={[data.companyName, data.companyBusinessId].filter(Boolean).join(" · ")} />
      <Text style={{ fontSize: typeScale.title, fontWeight: weight.bold, lineHeight: 1.25 }}>Valtakirja</Text>
      <Muted style={{ marginTop: 3 }}>Kokouskutsun liite</Muted>

      <Paragraph style={{ marginTop: 12 }}>
        Valtuutan alla mainitun henkilön edustamaan minua ja käyttämään puhe- ja äänioikeuttani yhtiön {data.companyName} {meetingName}{" "}
        {formatMeetingTime(data.startsAt)}
        {data.location ? `, ${data.location}` : ""}, sekä mahdollisessa jatkokokouksessa.
      </Paragraph>

      <Heading>Osakkeenomistaja</Heading>
      <FillLine label="Nimi" />
      <FillLine label="Huoneisto tai osakkeiden numerot" />
      <FillLine label="Puhelin tai sähköposti" />

      <Heading>Valtuutettu</Heading>
      <FillLine label="Nimi" />
      <FillLine label="Puhelin tai sähköposti (vapaaehtoinen)" />

      <Heading>Allekirjoitus</Heading>
      <View style={{ flexDirection: "row", gap: 18 }}>
        <View style={{ flex: 1 }}>
          <FillLine label="Paikka ja päivämäärä" />
        </View>
        <View style={{ flex: 1 }} />
      </View>
      <View style={{ flexDirection: "row", gap: 18 }}>
        <View style={{ flex: 1 }}>
          <FillLine label="Osakkeenomistajan allekirjoitus" height={30} />
          <FillLine label="Nimen selvennys" />
        </View>
        <View style={{ flex: 1 }}>
          <FillLine label="Toisen omistajan allekirjoitus (yhteisomistus)" height={30} />
          <FillLine label="Nimen selvennys" />
        </View>
      </View>

      <View style={{ marginTop: 18 }} wrap={false}>
        <Muted>
          Valtakirjan on oltava päivätty, ja valtuutettu esittää sen kokouksessa (asunto-osakeyhtiölaki 6:8 §). Valtuutus koskee tätä kokousta. Jos huoneistolla on
          useampi omistaja, valtakirjan allekirjoittavat kaikki, jotka valtuuttavat. Yhteisön puolesta allekirjoittaa nimenkirjoitusoikeudellinen henkilö. Osakas ja
          valtuutettu saavat käyttää kokouksessa avustajaa.
        </Muted>
      </View>
      <DocumentFooter left={`${data.organizationName} · ${data.companyName} · valtakirja`} />
    </Page>
  );
}

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
              Osakas voi osallistua kokoukseen itse tai asiamiehen välityksellä. Asiamiehen on esitettävä päivätty valtakirja. Valtakirjapohja on tämän
              kutsun liitteenä. Osakas voi käyttää kokouksessa avustajaa.
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
      {general ? <ProxyFormPage data={data} /> : null}
    </DocumentRoot>
  );
}
