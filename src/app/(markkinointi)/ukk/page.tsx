import { FAQ } from "@/content/marketing";
import { FaqList, PageHero, PrimaryCta, Section } from "@/components/marketing/Shell";

export const metadata = {
  title: "Usein kysyttyä",
  description: "Vastauksia eRapun käytöstä: kenelle palvelu sopii, miten allekirjoitukset toimivat ja missä tiedot ovat.",
};

export default function FaqPage() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQ.map((f) => ({ "@type": "Question", name: f.question, acceptedAnswer: { "@type": "Answer", text: f.answer } })),
  };
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <PageHero eyebrow="UKK" title="Usein kysyttyä" lead="Etkö löydä vastausta? Kysy suoraan, niin vastaamme." />
      <Section>
        <FaqList items={FAQ} />
        <div className="mt-10">
          <PrimaryCta size="lg" />
        </div>
      </Section>
    </>
  );
}
