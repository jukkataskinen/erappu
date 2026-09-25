/** @jsxRuntime automatic */
/** @jsxImportSource react */
/**
 * Ikkunakirjeen etusivu (A4, isoikkunainen C5-kuori). Asettelu Postitan
 * kirjepohjaohjeen mukaan (postita.fi/static/postita/postitafi-kirjepohjaohje.pdf),
 * mitat paperin reunasta:
 *   lähettäjä        10–30 mm ylhäältä, 20–85 mm vasemmalta
 *   maksumerkintä    30–40 mm ylhäältä tyhjänä (Postita tulostaa Postin merkinnän)
 *   vastaanottaja    40–60 mm ylhäältä, 20–85 mm vasemmalta, enintään neljä riviä
 *   turva-alue       0–85 mm ylhäältä ja 0–110 mm vasemmalta: ei muuta sisältöä
 * Päiväys ja viite ovat turva-alueen oikealla puolella, teksti sen alapuolella.
 *
 * Osoitekenttien absoluuttiset sijainnit lasketaan paperin reunasta (sivun
 * täyte ei vaikuta niihin). Rivit sovitetaan kenttään ennen renderöintiä
 * (`src/lib/letters/pdf.tsx`), koska React-PDF ei pienennä tekstiä itse.
 * Koetulosteessa alueet piirretään katkoviivalla.
 */

import { Page, Text, View } from "@react-pdf/renderer";
import type { FittedLine } from "@/lib/letters/address";
import { DocumentRoot } from "./components";
import { formatDate } from "./format";
import { A4_HEIGHT, FONT_FAMILY, colors, type as typeScale, weight } from "./theme";

const MM = 72 / 25.4;
export const mm = (value: number) => value * MM;

/** Osoitekenttien leveys (20–85 mm). */
export const ADDRESS_FIELD_WIDTH = mm(65);
export const ADDRESS_FONT = { max: 10, min: 7 } as const;
export const SENDER_FONT = { max: 8.5, min: 6.5 } as const;
/** Oikean reunan tietojen leveys (125–190 mm). */
export const INFO_FIELD_WIDTH = mm(65);

const ROW = mm(4.4);

export interface WindowLetterData {
  /** Enintään neljä riviä; ensimmäinen lihavoidaan. */
  sender: FittedLine[];
  /** Enintään neljä riviä. */
  recipient: FittedLine[];
  /** VVVV-KK-PP */
  date: string;
  /** Esim. vastaanottajan huoneisto. */
  reference: FittedLine | null;
  title: string;
  paragraphs: string[];
  signature: string[];
  footer: string;
  calibration?: boolean;
}

function Box({ top, bottom, left, right, dotted }: { top: number; bottom: number; left: number; right: number; dotted?: boolean }) {
  return (
    <View
      style={{
        position: "absolute",
        top: mm(top),
        left: mm(left),
        width: mm(right - left),
        height: mm(bottom - top),
        borderWidth: 0.7,
        borderColor: colors.sky,
        borderStyle: dotted ? "dotted" : "dashed",
      }}
    />
  );
}

function Calibration() {
  const label = { position: "absolute" as const, fontSize: 6.5, color: colors.sky };
  return (
    <>
      <Box top={0.5} bottom={85} left={0.5} right={110} dotted />
      <Box top={10} bottom={30} left={20} right={85} />
      <Box top={40} bottom={60} left={20} right={85} />
      <Text style={{ ...label, top: mm(33.5), left: mm(21) }}>Maksumerkintä 30–40 mm: jätetään tyhjäksi</Text>
      <Text style={{ ...label, top: mm(78), left: mm(21), width: mm(85) }}>
        Lähettäjä 10–30 mm ja vastaanottaja 40–60 mm ylhäältä, 20–85 mm vasemmalta. Pisteviiva: turva-alue 85 × 110 mm.
      </Text>
    </>
  );
}

export function WindowLetter({ data }: { data: WindowLetterData }) {
  return (
    <DocumentRoot title={data.title} subject={data.footer} date={data.date}>
      <Page
        size="A4"
        style={{
          fontFamily: FONT_FAMILY,
          fontSize: typeScale.body,
          color: colors.ink,
          lineHeight: 1.45,
          paddingTop: mm(20),
          paddingBottom: mm(22),
          paddingHorizontal: mm(20),
        }}
      >
        <View style={{ position: "absolute", top: mm(11), left: mm(20), width: ADDRESS_FIELD_WIDTH }}>
          {data.sender.slice(0, 4).map((line, i) => (
            <Text key={i} style={{ height: ROW, fontSize: line.size, lineHeight: 1.2, fontWeight: i === 0 ? weight.bold : weight.regular }}>
              {line.text}
            </Text>
          ))}
        </View>

        <View style={{ position: "absolute", top: mm(11), left: mm(125), width: INFO_FIELD_WIDTH }}>
          <Text style={{ height: ROW, fontSize: typeScale.body, lineHeight: 1.2 }}>{formatDate(data.date)}</Text>
          {data.reference ? <Text style={{ height: ROW, lineHeight: 1.2, fontSize: data.reference.size, color: colors.inkSoft }}>{data.reference.text}</Text> : null}
        </View>

        <View style={{ position: "absolute", top: mm(41.5), left: mm(20), width: ADDRESS_FIELD_WIDTH }}>
          {data.recipient.slice(0, 4).map((line, i) => (
            <Text key={i} style={{ height: ROW, fontSize: line.size, lineHeight: 1.2 }}>
              {line.text}
            </Text>
          ))}
        </View>

        {data.calibration ? <Calibration /> : null}

        {/* Teksti alkaa 98 mm:stä, turva-alueen alapuolelta. */}
        <View style={{ height: mm(78) }} />
        <Text style={{ fontSize: typeScale.heading + 2, fontWeight: weight.bold, lineHeight: 1.25, marginBottom: 8 }}>{data.title}</Text>
        {data.paragraphs.map((p, i) => (
          <Text key={i} style={{ marginTop: i === 0 ? 0 : 7 }}>
            {p}
          </Text>
        ))}
        {data.signature.length ? (
          <View style={{ marginTop: 16 }} wrap={false}>
            {data.signature.map((line, i) => (
              <Text key={i} style={i === 0 ? { fontWeight: weight.medium } : { fontSize: typeScale.small, color: colors.inkSoft }}>
                {line}
              </Text>
            ))}
          </View>
        ) : null}

        <View style={{ position: "absolute", top: A4_HEIGHT - 34, left: mm(20), right: mm(20), flexDirection: "row", justifyContent: "space-between" }} fixed>
          <Text style={{ fontSize: typeScale.label, color: colors.inkFaint }}>{data.footer}</Text>
          <Text
            style={{ fontSize: typeScale.label, color: colors.inkFaint }}
            fixed
            render={({ pageNumber, totalPages }) => (totalPages > 1 ? `${pageNumber} / ${totalPages}` : "")}
          />
        </View>
      </Page>
    </DocumentRoot>
  );
}
