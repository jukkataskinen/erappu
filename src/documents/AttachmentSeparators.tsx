/** @jsxRuntime automatic */
/** @jsxImportSource react */
/**
 * Isännöitsijäntodistuksen liitteiden erotinsivut: yksi sivu liitettä kohden,
 * "Liite N: <nimi>". Renderöidään yhtenä asiakirjana ja kopioidaan
 * yhdistettyyn PDF:ään kunkin liitteen eteen (`pdf-merge.ts`).
 */

import { Page, Text, View } from "@react-pdf/renderer";
import { DocumentHeader, DocumentRoot, Muted, pageStyle } from "./components";
import { formatDate } from "./format";
import { colors, type as typeScale, weight } from "./theme";

export interface AttachmentSeparatorData {
  companyName: string;
  unitLabel: string;
  issuedOn: string;
  draft: boolean;
  items: { number: number; label: string; title: string | null; dateText: string | null; pages: number | null }[];
}

export function AttachmentSeparators({ data }: { data: AttachmentSeparatorData }) {
  return (
    <DocumentRoot title="Isännöitsijäntodistuksen liitteet" subject={`${data.companyName}, ${data.unitLabel}`} date={data.issuedOn}>
      {data.items.map((item) => (
        <Page key={item.number} size="A4" style={pageStyle}>
          <DocumentHeader right={`${data.companyName} · huoneisto ${data.unitLabel}`} />
          <View style={{ marginTop: 180, alignItems: "center" }}>
            <Text style={{ fontSize: typeScale.label, color: colors.inkFaint, letterSpacing: 1 }}>ISÄNNÖITSIJÄNTODISTUKSEN LIITE</Text>
            <Text style={{ marginTop: 10, fontSize: typeScale.title, fontWeight: weight.bold, lineHeight: 1.3, textAlign: "center" }}>
              Liite {item.number}: {item.label}
            </Text>
            {item.title && item.title !== item.label ? (
              <Text style={{ marginTop: 10, fontSize: typeScale.subtitle, lineHeight: 1.4, textAlign: "center" }}>{item.title}</Text>
            ) : null}
            <Muted style={{ marginTop: 8 }}>
              {[item.dateText ? `Päiväys / vuosi ${item.dateText}` : null, item.pages ? `${item.pages} sivua` : null].filter(Boolean).join(" · ")}
            </Muted>
            <Muted style={{ marginTop: 24 }}>
              Isännöitsijäntodistus annettu {formatDate(data.issuedOn)}
              {data.draft ? " · LUONNOS" : ""}
            </Muted>
          </View>
        </Page>
      ))}
    </DocumentRoot>
  );
}
