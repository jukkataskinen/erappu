import Link from "next/link";
import { CONTACT } from "@/content/marketing";
import { Container, PageHero } from "@/components/marketing/Shell";

export const metadata = {
  title: "Tietosuojaseloste",
  description: "Miten eRapussa käsitellään henkilötietoja: kenen tietoja, mistä ne tulevat, kenelle niitä luovutetaan, missä ne säilytetään ja mitkä ovat rekisteröidyn oikeudet.",
};

/**
 * Tietosuojaseloste (EU 2016/679, 13 ja 14 artikla). Sisältö on rajattu
 * siihen, mikä on todennettavissa eRapun toteutuksesta ja käytetyistä
 * palveluista. Säilytysajat ja sopimusehdot sovitaan isännöintisopimuksessa,
 * joten niitä ei luvata tässä tarkempina kuin ne ovat.
 */

const UPDATED = "23.9.2026";

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-line py-8">
      <h2 className="text-xl md:text-2xl">{title}</h2>
      <div className="prose-measure mt-4 grid gap-3 text-ink/80">{children}</div>
    </section>
  );
}

function List({ items }: { items: string[] }) {
  return (
    <ul className="grid gap-2">
      {items.map((item) => (
        <li key={item} className="border-t border-line pt-2 first:border-t-0 first:pt-0">
          {item}
        </li>
      ))}
    </ul>
  );
}

export default function PrivacyPage() {
  return (
    <>
      <PageHero
        eyebrow="Tietosuoja"
        title="Tietosuojaseloste"
        lead={`Miten eRapussa käsitellään henkilötietoja. Päivitetty ${UPDATED}.`}
      />
      <section className="bg-paper py-10 md:py-14">
        <Container>
          <Block title="1. Rekisterinpitäjä ja käsittelijä">
            <p>
              Taloyhtiön tiedoissa rekisterinpitäjä on <strong>taloyhtiö</strong>, jonka asioita eRapussa hoidetaan. {CONTACT.company} käsittelee näitä tietoja
              taloyhtiön ja sen isännöitsijän lukuun eli toimii henkilötietojen käsittelijänä.
            </p>
            <p>
              Verkkosivuston kävijöiden ja yhteydenottojen osalta rekisterinpitäjä on {CONTACT.company}. Yhteydenotot tietosuoja-asioissa:{" "}
              <a href={`mailto:${CONTACT.email}`} className="underline underline-offset-4">
                {CONTACT.email}
              </a>
              .
            </p>
          </Block>

          <Block title="2. Mitä tietoja käsitellään">
            <List
              items={[
                "Yhteystiedot: nimi, osoite, sähköpostiosoite ja puhelinnumero.",
                "Rooli taloyhtiössä: osakas, asukas, hallituksen jäsen, isännöitsijä tai palveluntuottaja, sekä huoneisto ja osakeryhmä.",
                "Omistus- ja hallintatiedot: osakkeet, omistuksen alkaminen ja päättyminen sekä hallintaan liittyvät merkinnät.",
                "Henkilötunnus silloin, kun se tarvitaan osakeluettelon tai huoneistotietojärjestelmän tietoihin. Henkilötunnusta ei tallenneta selväkielisenä.",
                "Asiointitiedot: huoltopyynnöt kuvineen, yhteydenotot, muutostyöilmoitukset, varaukset ja vesimittarilukemat.",
                "Talouden tiedot: vastikkeet, lainaosuudet ja maksutilanne siltä osin kuin ne on kirjattu eRappuun.",
                "Kokoustiedot: läsnäolot, äänimäärät ja pöytäkirjan allekirjoittajat.",
                "Käyttöä koskevat tiedot: kirjautumiset ja tapahtumaloki siitä, kuka muutti mitä ja milloin.",
              ]}
            />
          </Block>

          <Block title="3. Mihin tietoja käytetään ja millä perusteella">
            <List
              items={[
                "Isännöintipalvelun ja taloyhtiön hallinnon hoitaminen: käsittely perustuu taloyhtiön ja sen sopimuskumppanin väliseen sopimukseen sekä rekisterinpitäjän oikeutettuun etuun.",
                "Lakisääteiset velvoitteet: osakeluettelo ja huoneistotietojärjestelmän ilmoitukset, isännöitsijäntodistus, pelastussuunnitelma ja kirjanpitoon liittyvät velvoitteet.",
                "Asiakirjojen allekirjoittaminen ja niiden todentaminen.",
                "Palvelun tietoturva ja väärinkäytösten selvittäminen tapahtumalokin avulla.",
              ]}
            />
            <p>Tietoja ei käytetä profilointiin, automaattiseen päätöksentekoon eikä markkinointiin ilman erillistä suostumusta.</p>
          </Block>

          <Block title="4. Mistä tiedot saadaan">
            <List
              items={[
                "Taloyhtiöltä ja isännöitsijältä, esimerkiksi osakeluettelosta ja yhtiön asiakirjoista.",
                "Rekisteröidyltä itseltään, esimerkiksi huoltopyynnöstä, muutostyöilmoituksesta tai omista yhteystiedoista portaalissa.",
                "Huoneistotietojärjestelmästä (Maanmittauslaitos), kun yhtiön osakeluettelo on siirretty sinne.",
              ]}
            />
          </Block>

          <Block title="5. Kenelle tietoja luovutetaan">
            <p>
              Tietoja näkevät taloyhtiön isännöitsijä ja ne hallituksen jäsenet, osakkaat ja asukkaat, joille tieto kuuluu. Oikeudet määräytyvät roolin mukaan, eikä
              toisen taloyhtiön tietoja näe kukaan.
            </p>
            <p>Palvelun tuottamisessa käytetään seuraavia käsittelijöitä:</p>
            <List
              items={[
                "Vercel: sovelluksen käyttöpalvelu, palvelinalue Tukholma.",
                "Supabase: tietokanta ja asiakirjojen tallennus, palvelinalue Tukholma.",
                "Auth0: kirjautuminen, EU:n alueen ympäristö.",
                "Resend: palvelun lähettämät sähköpostiviestit.",
                "eSinetti (Adepta Oy): asiakirjojen sähköinen allekirjoitus ja sinetöinti.",
                "Maanmittauslaitos: huoneistotietojärjestelmän ilmoitukset ja kyselyt, kun yhtiö kuuluu järjestelmään.",
              ]}
            />
            <p>
              Tietoja ei myydä eikä luovuteta markkinointitarkoituksiin. Viranomaiselle tietoja luovutetaan vain, kun laki sitä edellyttää.
            </p>
          </Block>

          <Block title="6. Tietojen säilytys ja sijainti">
            <p>
              Tiedot säilytetään EU:n alueella sijaitsevilla palvelimilla. Jos jokin käsittelijä siirtää tietoja EU:n ulkopuolelle, siirto tehdään EU-komission
              vakiolausekkeilla tai muulla tietosuoja-asetuksen sallimalla perusteella.
            </p>
            <p>
              Tietoja säilytetään niin kauan kuin isännöintisopimus on voimassa ja sen jälkeen niin kauan kuin laki edellyttää, esimerkiksi kirjanpito- ja
              asiakirjasäännösten mukaisesti. Säilytysajoista sovitaan isännöintisopimuksessa. Allekirjoitettujen asiakirjojen säilytysaika eSinetin arkistossa on
              enintään kymmenen vuotta, ja alkuperäinen allekirjoittamaton tiedosto poistetaan sieltä 30 päivässä.
            </p>
          </Block>

          <Block title="7. Tietojen suojaaminen">
            <List
              items={[
                "Yhteys on salattu (HTTPS), ja kirjautuminen on henkilökohtainen.",
                "Portaaliin kirjaudutaan sähköpostiin lähetettävällä kertakoodilla, henkilökunta omilla tunnuksillaan.",
                "Pääsy tietoihin määräytyy roolin mukaan tietokantatasolla, ei vain käyttöliittymässä.",
                "Henkilötunnuksia ei tallenneta selväkielisinä, ja arkaluonteiset kentät salataan.",
                "Jokainen muutos kirjataan tapahtumalokiin.",
                "Asiakirjat ovat yksityisessä tallennustilassa, eikä niihin pääse ilman kirjautumista.",
              ]}
            />
          </Block>

          <Block title="8. Evästeet">
            <p>
              Sivusto käyttää vain välttämättömiä evästeitä: kirjautumisen istuntoeväste ja valitun organisaation muistava eväste. Seurantaa, mainosevästeitä tai
              kävijäanalytiikkaa ei käytetä, joten evästeisiin ei pyydetä suostumusta.
            </p>
          </Block>

          <Block title="9. Rekisteröidyn oikeudet">
            <List
              items={[
                "Oikeus saada tietää, mitä tietoja sinusta käsitellään, ja saada niistä jäljennös.",
                "Oikeus oikaista virheelliset tiedot.",
                "Oikeus tietojen poistamiseen, kun käsittelylle ei ole enää perustetta.",
                "Oikeus käsittelyn rajoittamiseen ja oikeus vastustaa käsittelyä.",
                "Oikeus siirtää itse antamasi tiedot järjestelmästä toiseen.",
                "Oikeus tehdä valitus tietosuojavaltuutetun toimistolle (tietosuoja.fi).",
              ]}
            />
            <p>
              Pyynnöt osoitetaan taloyhtiön isännöitsijälle tai osoitteeseen{" "}
              <a href={`mailto:${CONTACT.email}`} className="underline underline-offset-4">
                {CONTACT.email}
              </a>
              . Pyytäjän henkilöllisyys tarkistetaan ennen tietojen luovuttamista.
            </p>
          </Block>

          <Block title="10. Muutokset">
            <p>
              Tätä selostetta päivitetään, kun palvelu tai käsittelyn perusteet muuttuvat. Viimeisin päivitys {UPDATED}.{" "}
              <Link href="/yhteystiedot" className="underline underline-offset-4">
                Ota yhteyttä
              </Link>
              , jos jokin jäi epäselväksi.
            </p>
          </Block>
        </Container>
      </section>
    </>
  );
}
