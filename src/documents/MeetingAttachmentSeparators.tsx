/** @jsxRuntime automatic */
/** @jsxImportSource react */
/**
 * Esityslistan ja pöytäkirjan liitteiden erotinsivut: yksi sivu liitettä
 * kohden ennen liitteen omia sivuja ("Liite 8.1", otsikko ja pykälä).
 * Jos tiedostoa ei voi liittää PDF:ään (esim. Excel), erotinsivu kertoo sen,
 * ja liite on avattavissa kokoussivulta ja portaalista.
 */

import { Page, Text, View } from "@react-pdf/renderer";
import { DocumentHeader, DocumentRoot, Muted, pageStyle } from "./components";
import { formatDate } from "./format";
import { colors, type as typeScale, weight } from "./theme";

export interface MeetingAttachmentSeparatorData {
  documentLabel: "ESITYSLISTAN LIITE" | "PÖYTÄKIRJAN LIITE";
  companyName: string;
  meetingTitle: string;
  issuedOn: string;
  items: { label: string; title: string; item: string; pages: number | null; failure: string | null }[];
}

export function MeetingAttachmentSeparators({ data }: { data: MeetingAttachmentSeparatorData }) {
  return (
    <DocumentRoot title={`${data.meetingTitle}: liitteet`} subject={data.companyName} date={data.issuedOn}>
      {data.items.map((item) => (
        <Page key={item.label} size="A4" style={pageStyle}>
          <DocumentHeader right={`${data.companyName} · ${data.meetingTitle}`} />
          <View style={{ marginTop: 180, alignItems: "center" }}>
            <Text style={{ fontSize: typeScale.label, color: colors.inkFaint, letterSpacing: 1 }}>{data.documentLabel}</Text>
            <Text style={{ marginTop: 10, fontSize: typeScale.title, fontWeight: weight.bold, lineHeight: 1.3, textAlign: "center" }}>{item.label}</Text>
            <Text style={{ marginTop: 10, fontSize: typeScale.subtitle, lineHeight: 1.4, textAlign: "center" }}>{item.title}</Text>
            <Muted style={{ marginTop: 8 }}>{[item.item, item.pages ? `${item.pages} sivua` : null].filter(Boolean).join(" · ")}</Muted>
            {item.failure ? (
              <Text style={{ marginTop: 24, maxWidth: 380, textAlign: "center", lineHeight: 1.4 }}>
                Liitettä ei voitu liittää tähän asiakirjaan ({item.failure}). Se on avattavissa kokouksen tiedoista eRapussa.
              </Text>
            ) : null}
            <Muted style={{ marginTop: 24 }}>Asiakirja laadittu {formatDate(data.issuedOn)}</Muted>
          </View>
        </Page>
      ))}
    </DocumentRoot>
  );
}
