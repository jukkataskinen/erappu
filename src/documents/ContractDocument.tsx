/** @jsxRuntime automatic */
/** @jsxImportSource react */
/**
 * Pohjasta täytetty sopimus. Yleinen kaikille sopimuspohjille: sisältö tulee
 * `fillTemplate`-funktiolta, joten uusi pohja ei tarvitse uutta komponenttia.
 * Luonnosmerkintä, jos pohjaa ei ole hyväksytty juridisesti.
 */

import { Page, Text, View } from "@react-pdf/renderer";
import type { FilledContract } from "@/lib/contract-templates/render";
import { DocumentFooter, DocumentHeader, DocumentRoot, DraftBanner, Heading, KeyValues, Muted, Paragraph, Signatures, pageStyle } from "./components";
import { type as typeScale, weight } from "./theme";

export interface ContractDocumentData {
  contract: FilledContract;
  organizationName: string;
  companyName: string;
  companyBusinessId: string;
  /** VVVV-KK-PP; asiakirjan aikaleima, jotta renderöinti on deterministinen. */
  issuedOn: string;
}

export function ContractDocument({ data }: { data: ContractDocumentData }) {
  const { contract } = data;
  return (
    <DocumentRoot title={contract.title} subject={data.companyName} date={data.issuedOn}>
      <Page size="A4" style={pageStyle}>
        <DocumentHeader right={[data.companyName, data.companyBusinessId].filter(Boolean).join(" · ")} />
        {!contract.approved ? <DraftBanner text="LUONNOS – sisältö tarkistettava" /> : null}
        <Text style={{ fontSize: typeScale.title, fontWeight: weight.bold, lineHeight: 1.25 }}>{contract.title}</Text>

        {contract.sections.map((section) => (
          <View key={section.number}>
            <Heading>
              {section.number}. {section.heading}
            </Heading>
            {section.keyValues.length > 0 ? <KeyValues items={section.keyValues} columns={1} /> : null}
            {section.paragraphs.map((p, i) => (
              <Paragraph key={i}>{p}</Paragraph>
            ))}
          </View>
        ))}

        {/* Otsikko ja allekirjoitusrivit samalle sivulle, jotta otsikko ei jää orvoksi. */}
        <View wrap={false}>
          <Heading>Allekirjoitukset</Heading>
          <Muted>Allekirjoitukset kerätään sähköisesti eSinetillä. Allekirjoitusten ajankohdat ja tunnistustiedot näkyvät sinetöidyssä asiakirjassa.</Muted>
          <Signatures place="Sähköinen allekirjoitus" date="" signatories={contract.signatories} />
        </View>
        <DocumentFooter left={`${data.organizationName} · ${data.companyName}`} />
      </Page>
    </DocumentRoot>
  );
}
