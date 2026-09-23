import { FEATURE_PAGE_SECTIONS } from "@/content/marketing";
import { FeatureGrid, PageHero, PrimaryCta, Section } from "@/components/marketing/Shell";

export const metadata = {
  title: "Ominaisuudet",
  description: "Mitä eRappu tekee isännöitsijälle, hallitukselle, osakkaille ja asukkaille: kokoukset, allekirjoitukset, todistukset, vuosikello ja asukasportaali.",
};

export default function FeaturesPage() {
  return (
    <>
      <PageHero
        eyebrow="Isännöitsijälle ja taloyhtiölle"
        title="Kaikki taloyhtiön asiat yhdessä paikassa."
        lead="Isännöitsijä hoitaa yhtiöt eRapussa, ja hallitus, osakkaat ja asukkaat käyttävät samaa palvelua omasta näkymästään. Tiedot kirjataan kerran, ja ne ovat käytössä kaikkialla."
      >
        <PrimaryCta size="lg" />
      </PageHero>
      {FEATURE_PAGE_SECTIONS.map((s, i) => (
        <Section key={s.id} id={s.id} title={s.title} lead={s.lead} tone={i % 2 ? "cloud" : "paper"}>
          <FeatureGrid items={[...s.items]} />
        </Section>
      ))}
      <Section title="Turvallisesti ja läpinäkyvästi">
        <FeatureGrid
          items={[
            { title: "Tiedot EU:ssa", body: "Palvelu ja tietokanta toimivat EU:ssa. Henkilötunnuksia ei tallenneta selväkielisinä." },
            { title: "Jokainen muutos kirjataan", body: "Tapahtumaloki näyttää, kuka muutti mitä ja milloin, myös pöytäkirjan allekirjoittajien muutokset." },
            { title: "Oikeudet roolin mukaan", body: "Isännöitsijä, kirjanpitäjä, hallitus, osakas ja asukas näkevät vain sen, mikä heille kuuluu." },
          ]}
        />
      </Section>
    </>
  );
}
