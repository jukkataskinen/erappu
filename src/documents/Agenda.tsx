/** @jsxRuntime automatic */
/** @jsxImportSource react */
/**
 * Esityslista Jukan mallin mukaan (As Oy Paikkalantorpat, yhtiökokous 2025):
 * vasemmalla yhtiön nimi ja postiosoite, oikealla ESITYSLISTA ja kokouksen
 * päivä, sen alla numeroitu asialista. Tulostetaan kokoukseen, joten ulkoasu
 * on kirjeen kaltainen eikä siinä ole eRapun tunnusta. Numerot vastaavat
 * pöytäkirjan pykäliä.
 */

import { Page, Text, View } from "@react-pdf/renderer";
import type { MeetingDocumentBase } from "./MeetingNotice";
import { DocumentRoot, pageStyle } from "./components";
import { formatDate, formatMeetingTime } from "./format";
import { colors, type as typeScale, weight } from "./theme";

const KIND_LABEL: Record<MeetingDocumentBase["kind"], string> = {
  annual_general: "Varsinainen yhtiökokous",
  extraordinary_general: "Ylimääräinen yhtiökokous",
  board: "Hallituksen kokous",
};

/** Postiosoitteen viimeinen rivi mallin tapaan: "41660 Toivakka". */
export function postalLine(address: string | null): string | null {
  if (!address) return null;
  const parts = address.split(",").map((p) => p.trim()).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : null;
}

/**
 * "Muut asiat" -kohdan jälkeen lisätyt asiat ennen kokouksen päättämistä
 * sisennetään mallin tapaan. Numerointi säilyy, jotta se vastaa pöytäkirjan pykäliä.
 */
export function otherMattersSubItems(items: { position: number; title: string }[]): Set<number> {
  const start = items.findIndex((i) => /^muut asiat/i.test(i.title.trim()));
  const end = items.findIndex((i, idx) => idx > start && /^kokouksen päättäminen/i.test(i.title.trim()));
  if (start < 0 || end < 0) return new Set();
  return new Set(items.slice(start + 1, end).map((i) => i.position));
}

export function Agenda({ data }: { data: MeetingDocumentBase }) {
  const meetingDate = formatDate(new Date(data.startsAt));
  const street = data.companyAddress?.split(",")[0]?.trim() ?? null;
  const postal = postalLine(data.companyAddress);
  const subItems = otherMattersSubItems(data.items);
  return (
    <DocumentRoot title={`Esityslista: ${KIND_LABEL[data.kind].toLowerCase()}`} subject={data.companyName} date={data.issuedOn}>
      <Page size="A4" style={{ ...pageStyle, paddingTop: 56 }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
          <View style={{ flex: 1, paddingRight: 24 }}>
            <Text style={{ fontWeight: weight.bold }}>{data.companyName}</Text>
            {street && street !== postal ? <Text>{street}</Text> : null}
            {postal ? <Text>{postal}</Text> : null}
          </View>
          <View style={{ width: 170 }}>
            <Text style={{ fontSize: typeScale.title, fontWeight: weight.bold, letterSpacing: 1, lineHeight: 1.1 }}>ESITYSLISTA</Text>
            <Text style={{ marginTop: 6 }}>{meetingDate}</Text>
          </View>
        </View>

        <View style={{ marginTop: 22, paddingBottom: 8, borderBottomWidth: 0.75, borderBottomColor: colors.line }}>
          <Text style={{ fontWeight: weight.medium }}>{KIND_LABEL[data.kind]}</Text>
          <Text style={{ fontSize: typeScale.small, color: colors.inkSoft, marginTop: 2 }}>
            {[formatMeetingTime(data.startsAt), data.location].filter(Boolean).join(" · ")}
          </Text>
        </View>

        <View style={{ marginTop: 14 }}>
          {data.items.length === 0 ? <Text style={{ color: colors.inkSoft }}>Asialista puuttuu.</Text> : null}
          {data.items.map((item) => {
            const sub = subItems.has(item.position);
            return (
              <View key={item.position} style={{ flexDirection: "row", marginTop: sub ? 2 : 5, marginLeft: sub ? 26 : 0 }} wrap={false}>
                <Text style={{ width: 26, textAlign: "right", paddingRight: 8 }}>{item.position}.</Text>
                <Text style={{ flex: 1, lineHeight: 1.15 }}>{item.title}</Text>
              </View>
            );
          })}
        </View>

        <Text
          style={{ position: "absolute", bottom: 28, left: 56, right: 56, fontSize: typeScale.label, color: colors.inkFaint }}
          fixed
          render={({ pageNumber, totalPages }) => (totalPages > 1 ? `${data.companyName} · esityslista ${meetingDate} · ${pageNumber}/${totalPages}` : "")}
        />
      </Page>
    </DocumentRoot>
  );
}
