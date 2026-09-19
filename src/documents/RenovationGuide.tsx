/** @jsxRuntime automatic */
/** @jsxImportSource react */
/**
 * Yhtiökohtainen muutostyöohje osakkaille. Sisältö tulee
 * `buildGuideContent`-funktiosta (src/lib/maintenance/renovation-guide.ts).
 */

import { Page, Text, View } from "@react-pdf/renderer";
import type { GuideContent, GuideSection } from "@/lib/maintenance/renovation-guide";
import { DocumentFooter, DocumentHeader, DocumentRoot, DraftBanner, Heading, Muted, Panel, Paragraph, pageStyle } from "./components";
import { PageDecoration } from "./decorations";
import { formatDate } from "./format";
import { colors, type as typeScale, weight } from "./theme";

export interface RenovationGuideData {
  approved: boolean;
  companyName: string;
  businessId: string | null;
  issuedOn: string;
  content: GuideContent;
}

function Bullets({ items }: { items: string[] }) {
  return (
    <View style={{ marginTop: 4 }}>
      {items.map((b, i) => (
        <View key={i} style={{ flexDirection: "row", marginTop: 3 }} wrap={false}>
          <Text style={{ width: 12, color: colors.inkSoft }}>•</Text>
          <Text style={{ flex: 1 }}>{b}</Text>
        </View>
      ))}
    </View>
  );
}

function Section({ section }: { section: GuideSection }) {
  return (
    <View>
      <Heading>{section.title}</Heading>
      {section.paragraphs.map((p, i) => (
        <Paragraph key={i}>{p}</Paragraph>
      ))}
      {section.bullets?.length ? <Bullets items={section.bullets} /> : null}
    </View>
  );
}

export function RenovationGuide({ data }: { data: RenovationGuideData }) {
  const { content } = data;
  return (
    <DocumentRoot title={`Muutostyöohje, ${data.companyName}`} subject={data.companyName} date={data.issuedOn}>
      <Page size="A4" style={pageStyle}>
        <PageDecoration />
        <DocumentHeader right={[data.companyName, data.businessId].filter(Boolean).join(" · ")} />
        {!data.approved ? <DraftBanner text="LUONNOS – vakiotekstejä ei ole vielä hyväksytty" /> : null}
        <Text style={{ fontSize: typeScale.title, fontWeight: weight.bold, lineHeight: 1.2 }}>Muutostyöohje osakkaille</Text>
        <Text style={{ fontSize: typeScale.subtitle, color: colors.inkSoft, marginTop: 4 }}>
          {data.companyName} · päivitetty {formatDate(data.issuedOn)}
        </Text>
        <Paragraph style={{ marginTop: 10 }}>
          Tämä ohje kertoo, milloin huoneiston remontista on ilmoitettava taloyhtiölle, miten ilmoitus käsitellään ja mitä työltä edellytetään. Ohje ei korvaa yhtiöjärjestystä
          eikä yhtiön päätöksessä asetettuja ehtoja.
        </Paragraph>

        {content.sections.slice(0, 4).map((s) => (
          <Section key={s.title} section={s} />
        ))}

        {content.asbestos ? (
          <Panel style={{ marginTop: 12, borderWidth: 1, borderColor: colors.coral }} wrap={false}>
            <Text style={{ fontWeight: weight.bold }}>{content.asbestos.title}</Text>
            {content.asbestos.paragraphs.map((p, i) => (
              <Paragraph key={i}>{p}</Paragraph>
            ))}
          </Panel>
        ) : null}

        {content.workTypes.length ? (
          <View style={{ marginTop: 18 }}>
            <Text style={{ fontSize: typeScale.heading, fontWeight: weight.bold, marginBottom: 4 }} minPresenceAhead={80}>
              Työlajikohtaiset vaatimukset
            </Text>
            <Muted>Yhtiö voi asettaa päätöksessään lisäehtoja. Vaatimukset koskevat myös osakkaan itse tekemää työtä.</Muted>
            {content.workTypes.map((w) => (
              <View key={w.key} style={{ marginTop: 10 }}>
                <Text style={{ fontWeight: weight.bold }} minPresenceAhead={40}>
                  {w.title}
                </Text>
                <Paragraph>{w.intro}</Paragraph>
                <Bullets items={w.requirements} />
              </View>
            ))}
          </View>
        ) : null}

        {content.sections.slice(4).map((s) => (
          <Section key={s.title} section={s} />
        ))}

        <Muted style={{ marginTop: 16 }}>Perusta: {content.legalBasis}.</Muted>
        <DocumentFooter left={`Muutostyöohje · ${data.companyName}`} />
      </Page>
    </DocumentRoot>
  );
}
