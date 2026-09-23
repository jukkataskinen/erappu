import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { AFTER, BEFORE, BOARD_BENEFITS, BUYING_FAQ, PROBLEMS, TRUST } from "@/content/marketing";
import { Container, FaqList, FeatureGrid, PrimaryCta, Section } from "@/components/marketing/Shell";
import { formatEuro, monthlyPrice, VAT_NOTE, YEARLY_MONTHLY } from "@/content/pricing";
import { BoardHomePreview, MinutesPreview } from "@/components/marketing/Previews";

export const dynamic = "force-dynamic";
export const metadata = { title: { absolute: "eRappu – taloyhtiösi tärkeät asiat yhdessä paikassa" } };

/**
 * erappu.fi:n etusivu hallitukselle: ongelma, hyöty, käyttötapaus, ennen ja
 * jälkeen, hinta, luottamus, oston esteet. Kirjautunut käyttäjä ohjataan
 * sovellukseen kuten ennenkin.
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
              <p className="inline-flex rounded-full border border-line px-4 py-1.5 text-sm text-ink/70">Taloyhtiön hallitukselle ja osakkaille</p>
              <h1 className="mt-6 text-[34px] md:text-[52px]">Taloyhtiösi tärkeät asiat. Yhdessä paikassa.</h1>
              <p className="prose-measure mt-5 text-ink/80">
                eRappu antaa hallitukselle ja osakkaille selkeän näkymän yhtiön tietoihin, päätöksiin, asiakirjoihin ja tehtäviin. Ei sähköpostien, Excelien eikä
                kansioiden etsimistä.
              </p>
              <p className="prose-measure mt-3 font-medium">Vähemmän etsimistä. Enemmän näkyvyyttä.</p>
              <div className="mt-8 flex flex-wrap items-center gap-4">
                <PrimaryCta size="lg" />
                <Link href="/hallitukselle" className="text-[15px] underline underline-offset-4">
                  Miksi taloyhtiömme kannattaa ottaa eRappu
                </Link>
              </div>
              <p className="mt-4 text-sm text-ink/70">Selaimessa, ilman asennuksia · Kirjautuminen sähköpostiin tulevalla koodilla</p>
            </div>
            <div className="mx-auto w-full max-w-[400px]">
              <BoardHomePreview />
            </div>
          </div>
        </Container>
      </section>

      <Section tone="cloud" title="Kuinka monessa paikassa taloyhtiön asiat ovat nyt?" lead="Tuttu tilanne useimmissa yhtiöissä.">
        <FeatureGrid items={PROBLEMS} />
        <p className="mt-10 text-lg font-medium">eRappu kokoaa nämä yhteen paikkaan.</p>
      </Section>

      <Section title="Mitä eRappu antaa hallitukselle?" lead="Hallituksen ei tarvitse muistaa kaikkea eikä etsiä mitään.">
        <FeatureGrid items={BOARD_BENEFITS} />
      </Section>

      <section className="border-b border-line bg-cloud py-14 md:py-[88px]">
        <Container>
          <div className="grid items-center gap-10 md:grid-cols-2">
            <div>
              <p className="text-sm font-medium text-ink/60">Näin se toimii</p>
              <p className="prose-measure mt-3 text-xl leading-[1.5] md:text-2xl">
                Puheenjohtaja kirjautuu, näkee yhtiön tehtävät, avaa kokouksen asialistan ja tarkistaa, mitä edellisessä kokouksessa päätettiin.
              </p>
              <p className="prose-measure mt-6 text-ink/70">
                Kokouksen aikana liitteet avautuvat pykälän kohdalta, ja pöytäkirja lähtee allekirjoitettavaksi pankkitunnuksilla heti kokouksen jälkeen.
              </p>
            </div>
            <div className="mx-auto w-full max-w-[400px]">
              <MinutesPreview />
            </div>
          </div>
        </Container>
      </section>

      <Section title="Vähemmän etsimistä. Enemmän näkyvyyttä.">
        <div className="grid gap-8 md:grid-cols-2">
          <div className="rounded-[var(--radius-panel)] border border-line bg-paper p-6">
            <h3 className="text-lg text-ink/70">Ennen</h3>
            <ul className="mt-4 grid gap-2 text-ink/70">
              {BEFORE.map((row) => (
                <li key={row} className="border-t border-line pt-2 first:border-t-0 first:pt-0">
                  {row}
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-[var(--radius-panel)] border border-ink bg-paper p-6">
            <h3 className="text-lg">eRapun kanssa</h3>
            <ul className="mt-4 grid gap-2">
              {AFTER.map((row) => (
                <li key={row} className="border-t border-line pt-2 first:border-t-0 first:pt-0">
                  {row}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Section>

      <Section tone="cloud" title="Isännöitsijä hoitaa käytännön. Hallitus näkee kokonaisuuden.">
        <p className="prose-measure text-ink/80">
          Isännöitsijä käyttää eRappua päivittäin: hän hoitaa kokoukset, asiakirjat, todistukset ja ilmoitukset. Hallitukselle ei siirry töitä, vaan näkyvyys siihen,
          mitä yhtiössä tapahtuu.
        </p>
        <p className="mt-6">
          <Link href="/ominaisuudet" className="font-medium underline underline-offset-4">
            Mitä eRappu tekee isännöitsijälle
          </Link>
        </p>
      </Section>

      <Section title="Pienellä kuukausihinnalla koko taloyhtiön käyttöön" lead={`Perusmaksu taloyhtiöltä ja pieni maksu huoneistolta, vähintään ${formatEuro(YEARLY_MONTHLY.minimum)} kuukaudessa. ${VAT_NOTE}`}>
        <div className="grid gap-8 md:grid-cols-[1.1fr_1fr] md:items-center">
          <dl className="grid gap-2">
            <div className="flex justify-between gap-4 border-t border-line pt-2">
              <dt className="text-ink/70">Taloyhtiö</dt>
              <dd className="tabular-nums">{formatEuro(YEARLY_MONTHLY.base)} / kk</dd>
            </div>
            <div className="flex justify-between gap-4 border-t border-line pt-2">
              <dt className="text-ink/70">Huoneisto</dt>
              <dd className="tabular-nums">{formatEuro(YEARLY_MONTHLY.perUnit)} / kk</dd>
            </div>
            <div className="flex justify-between gap-4 border-t border-line pt-2">
              <dt className="text-ink/70">Esimerkki: 15 huoneistoa</dt>
              <dd className="tabular-nums">
                {formatEuro(monthlyPrice(15, "yearly"))} / kk · {formatEuro(monthlyPrice(15, "yearly") / 15)} / huoneisto
              </dd>
            </div>
          </dl>
          <p className="rounded-[var(--radius-panel)] border border-line bg-cloud p-6 text-ink/80">
            Hinnat ovat vuosimaksun hintoja. Hinta on taloyhtiökohtainen, ja lasku menee suoraan taloyhtiölle.{" "}
            <Link href="/hinnat" className="font-medium underline underline-offset-4">
              Laske oman taloyhtiösi hinta
            </Link>
            .
          </p>
        </div>
      </Section>

      <Section tone="cloud" title="Miksi taloyhtiö voi luottaa eRappuun?">
        <FeatureGrid items={TRUST} />
        <p className="mt-10">
          <Link href="/tietosuoja" className="font-medium underline underline-offset-4">
            Tietosuojaseloste
          </Link>
        </p>
      </Section>

      <Section title="Kysymykset ennen päätöstä">
        <FaqList items={BUYING_FAQ} />
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
              <h2 className="text-2xl md:text-[32px]">Katso, miltä oman taloyhtiösi eRappu näyttäisi.</h2>
              <p className="prose-measure mt-4 text-ink/80">
                Käydään yhdessä läpi teidän yhtiönne asiat: kokoukset, asiakirjat, vuosikello ja portaali. Esittely ei sido mihinkään.
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-4">
                <PrimaryCta size="lg" />
                <Link href="/hallitukselle#ehdota" className="text-[15px] underline underline-offset-4">
                  Ehdota eRappua taloyhtiöllesi
                </Link>
              </div>
            </div>
            <p className="rounded-[var(--radius-panel)] border border-line bg-cloud p-6 text-lg">
              Hallitus päättää. Isännöitsijä hoitaa käytännön. eRappu pitää tiedot ja asiat yhdessä paikassa.
            </p>
          </div>
        </Container>
      </section>
    </>
  );
}
