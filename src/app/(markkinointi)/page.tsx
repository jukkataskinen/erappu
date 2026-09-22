import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { FAQ, MANAGER_FEATURES, RESIDENT_FEATURES } from "@/content/marketing";
import { Container, FaqList, FeatureGrid, PrimaryCta, Section } from "@/components/marketing/Shell";
import { CertificatePreview, MinutesPreview, PortalPreview } from "@/components/marketing/Previews";

export const dynamic = "force-dynamic";
export const metadata = { title: { absolute: "eRappu – selkeää ja läpinäkyvää isännöintiä" } };

/**
 * erappu.fi:n etusivu. Kirjautunut käyttäjä ohjataan suoraan sovellukseen
 * kuten ennenkin (henkilökunta työpöydälle, asukas portaaliin).
 */
export default async function Home() {
  const user = await getCurrentUser();
  if (user) {
    if (user.memberships.length > 0) redirect("/tyopoyta");
    if (user.portal.length > 0) redirect("/portaali");
    redirect("/ei-oikeutta");
  }

  return (
    <>
      <section className="border-b border-line bg-paper py-14 md:py-[88px]">
        <Container>
          <div className="grid items-center gap-12 lg:grid-cols-[1.05fr_0.95fr]">
            <div>
              <p className="inline-flex rounded-full border border-line px-4 py-1.5 text-sm text-ink/70">Isännöintitoimistoille ja taloyhtiöille</p>
              <h1 className="mt-6 text-[34px] md:text-[52px]">Selkeää ja läpinäkyvää isännöintiä.</h1>
              <p className="prose-measure mt-5 text-ink/80">
                eRappu hoitaa kokoukset, allekirjoitukset, todistukset ja muistutukset yhtiön omista tiedoista. Sinä tarkistat ja hyväksyt, ja hallitus ja asukkaat
                näkevät saman puhelimestaan.
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-4">
                <PrimaryCta size="lg" />
                <Link href="/ominaisuudet" className="text-[15px] underline underline-offset-4">
                  Katso mitä eRappu tekee
                </Link>
              </div>
              <p className="mt-4 text-sm text-ink/70">Selaimessa, ilman asennuksia · Allekirjoitukset pankkitunnuksilla</p>
            </div>
            <div className="mx-auto w-full max-w-[400px]">
              <MinutesPreview />
            </div>
          </div>
        </Container>
      </section>

      <section className="border-b border-line bg-cloud py-14 md:py-[88px]">
        <Container>
          <h2 className="text-2xl md:text-[32px]">Tuodaan. Hoidetaan. Allekirjoitetaan.</h2>
          <ol className="mt-10 grid gap-8 md:grid-cols-3">
            {[
              { title: "Tuodaan", body: "Taloyhtiöt, osakeluettelo, lainat ja asiakirjat siirretään eRappuun, joten aloitat valmiista rekisteristä." },
              { title: "Hoidetaan", body: "Vuosikello muistuttaa, asukkaat lähettävät pyynnöt ja lukemat itse, ja asiakirjat syntyvät yhtiön tiedoista." },
              { title: "Allekirjoitetaan", body: "Pöytäkirjat ja sopimukset lähtevät allekirjoitettaviksi pankkitunnuksilla ja palaavat valmiina yhtiön asiakirjoihin." },
            ].map((step, i) => (
              <li key={step.title}>
                <span className="text-sm tabular-nums text-ink/60">{`0${i + 1}`}</span>
                <h3 className="mt-2 text-lg">{step.title}</h3>
                <p className="mt-2 text-ink/80">{step.body}</p>
              </li>
            ))}
          </ol>
        </Container>
      </section>

      <section className="border-b border-line bg-paper py-14 md:py-[88px]">
        <Container>
          <div className="grid items-center gap-10 md:grid-cols-2">
            <div>
              <p className="prose-measure text-xl leading-[1.5] md:text-2xl">
                Isännöitsijäntodistus ei ole enää kokoamistyötä. Osakkeet, vastikkeet, lainaosuudet ja liitteet tulevat rekisteristä, ja valmis todistus sinetöidään
                sähköisesti.
              </p>
              <p className="prose-measure mt-6 text-ink/70">Tilaaja täyttää lomakkeen verkossa, ja todistus muodostuu yhdellä painalluksella.</p>
            </div>
            <div className="mx-auto w-full max-w-[380px]">
              <CertificatePreview />
            </div>
          </div>
        </Container>
      </section>

      <section className="border-b border-line bg-cloud py-14 md:py-[88px]">
        <Container>
          <div className="grid items-center gap-10 md:grid-cols-2">
            <div className="md:order-2">
              <p className="prose-measure text-xl leading-[1.5] md:text-2xl">
                Asukas kuvaa vian ja lähettää pyynnön puhelimella. Hän näkee, missä korjaus menee, eikä kenenkään tarvitse soitella perään.
              </p>
              <p className="prose-measure mt-6 text-ink/70">
                Samasta portaalista löytyvät tiedotteet, asiakirjat, varaukset ja vastuunjakotaulukko. Kirjautuminen sähköpostiin tulevalla koodilla, ei salasanoja.
              </p>
            </div>
            <div className="md:order-1">
              <PortalPreview />
            </div>
          </div>
        </Container>
      </section>

      <Section title="Vähemmän rutiinia isännöitsijälle" lead="Toistuvat työt hoituvat yhtiön tiedoista.">
        <FeatureGrid items={MANAGER_FEATURES.slice(0, 3)} />
        <p className="mt-10">
          <Link href="/ominaisuudet#isannoitsijalle" className="font-medium underline underline-offset-4">
            Kaikki isännöitsijän työkalut
          </Link>
        </p>
      </Section>

      <Section tone="cloud" title="Hallitus ja asukkaat samalla sivulla" lead="Kaikki näkevät ajantasaisen tiedon, joten kysymyksiä tulee vähemmän.">
        <FeatureGrid items={RESIDENT_FEATURES.slice(0, 3)} />
        <p className="mt-10">
          <Link href="/ominaisuudet#taloyhtiolle" className="font-medium underline underline-offset-4">
            Mitä portaalissa on
          </Link>
        </p>
      </Section>

      <Section title="Usein kysyttyä">
        <FaqList items={FAQ.slice(0, 4)} />
        <p className="mt-8">
          <Link href="/ukk" className="font-medium underline underline-offset-4">
            Kaikki kysymykset
          </Link>
        </p>
      </Section>

      <section className="bg-paper py-14 md:py-[88px]">
        <Container>
          <div className="grid gap-10 md:grid-cols-2 md:items-center">
            <div>
              <h2 className="text-2xl md:text-[32px]">Näytetäänkö, miten se toimii?</h2>
              <p className="prose-measure mt-4 text-ink/80">
                Käydään yhdessä läpi, miltä teidän yhtiöidenne arki näyttää eRapussa. Esittely ei sido mihinkään.
              </p>
              <div className="mt-8">
                <PrimaryCta size="lg" />
              </div>
            </div>
            <div className="rounded-[var(--radius-panel)] border border-line bg-cloud p-6">
              <ul className="grid gap-3 text-ink/80">
                <li>Kokoukset, kutsut ja pöytäkirjat allekirjoituksineen</li>
                <li className="border-t border-line pt-3">Isännöitsijäntodistukset ja lainaosuuslaskelmat</li>
                <li className="border-t border-line pt-3">Vuosikello, pelastussuunnitelma ja muutostyöohje</li>
                <li className="border-t border-line pt-3">Huoltopyynnöt, tiedotteet ja asukasportaali</li>
              </ul>
            </div>
          </div>
        </Container>
      </section>
    </>
  );
}
