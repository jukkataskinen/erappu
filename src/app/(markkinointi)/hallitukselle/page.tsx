import Link from "next/link";
import { BOARD_BENEFITS, BUYING_FAQ, COST_COMPARISON, PROBLEMS, TRUST } from "@/content/marketing";
import { FaqList, FeatureGrid, PageHero, PrimaryCta, Section } from "@/components/marketing/Shell";
import { ProposeMessage } from "@/components/marketing/ProposeMessage";
import { formatEuro, monthlyPrice, VAT_NOTE, YEARLY_MONTHLY } from "@/content/pricing";

export const metadata = {
  title: "Hallituksen jäsenelle",
  description: "Miksi taloyhtiön kannattaa ottaa eRappu käyttöön: mitä ongelmaa se ratkaisee, mitä hallitus saa, miten käyttöönotto tapahtuu ja mitä se maksaa.",
};

const STEPS = [
  { title: "Isännöitsijä tuo tiedot", body: "Osakeluettelo, yhtiöjärjestys, lainat, sopimukset ja asiakirjat siirretään eRappuun." },
  { title: "Hallitus saa kutsun", body: "Jokainen hallituksen jäsen kirjautuu sähköpostiin tulevalla koodilla. Mitään ei asenneta." },
  { title: "Osakkaat ja asukkaat mukaan", body: "Portaali avataan osakkaille ja asukkaille, kun yhtiön tiedot ovat valmiina." },
];

export default function BoardPage() {
  return (
    <>
      <PageHero
        eyebrow="Hallituksen jäsenelle"
        title="Miksi taloyhtiömme kannattaa ottaa eRappu käyttöön?"
        lead="Tämä sivu on tehty hallituksen päätöksen tueksi. Se kertoo, mitä ongelmaa eRappu ratkaisee, mitä hallitus saa, miten käyttöönotto tapahtuu ja mitä palvelu maksaa."
      >
        <PrimaryCta size="lg" />
      </PageHero>

      <Section title="Mitä ongelmaa eRappu ratkaisee?">
        <FeatureGrid items={PROBLEMS} />
      </Section>

      <Section tone="cloud" title="Mitä hallitus saa?">
        <FeatureGrid items={BOARD_BENEFITS} />
      </Section>

      <Section title="Miten käyttöönotto tapahtuu?" lead="Työ on isännöitsijän. Hallitukselta kuluu aikaa vain päätökseen.">
        <ol className="grid gap-8 md:grid-cols-3">
          {STEPS.map((step, i) => (
            <li key={step.title}>
              <span className="text-sm tabular-nums text-ink/60">{`0${i + 1}`}</span>
              <h3 className="mt-2 text-lg">{step.title}</h3>
              <p className="mt-2 text-ink/80">{step.body}</p>
            </li>
          ))}
        </ol>
      </Section>

      <Section tone="cloud" title="Mitä taloyhtiölle maksaa?" lead={`Hinta on taloyhtiökohtainen, ja lasku menee suoraan yhtiölle. ${VAT_NOTE}`}>
        <dl className="grid max-w-xl gap-2">
          <div className="flex justify-between gap-4 border-t border-line pt-2">
            <dt className="text-ink/70">Taloyhtiö</dt>
            <dd className="tabular-nums">{formatEuro(YEARLY_MONTHLY.base)} / kk</dd>
          </div>
          <div className="flex justify-between gap-4 border-t border-line pt-2">
            <dt className="text-ink/70">Huoneisto</dt>
            <dd className="tabular-nums">{formatEuro(YEARLY_MONTHLY.perUnit)} / kk</dd>
          </div>
          <div className="flex justify-between gap-4 border-t border-line pt-2">
            <dt className="text-ink/70">Vähintään</dt>
            <dd className="tabular-nums">{formatEuro(YEARLY_MONTHLY.minimum)} / kk</dd>
          </div>
          <div className="flex justify-between gap-4 border-t border-line pt-2">
            <dt className="text-ink/70">Esimerkki: 15 huoneistoa</dt>
            <dd className="tabular-nums">
              {formatEuro(monthlyPrice(15, "yearly"))} / kk · {formatEuro(monthlyPrice(15, "yearly") / 15)} / huoneisto
            </dd>
          </div>
        </dl>
        <p className="mt-6">
          <Link href="/hinnat" className="font-medium underline underline-offset-4">
            Laske oman taloyhtiösi hinta
          </Link>
        </p>
      </Section>

      <Section
        title="Mihin hintaa kannattaa verrata?"
        lead="Taloyhtiö maksaa osasta näitä asioita jo nyt, erillisinä palveluina ja postimerkkeinä. Alla suuntaa antavat vuosihinnat, kun ne ostetaan yksitellen."
      >
        <dl className="grid max-w-3xl gap-5">
          {COST_COMPARISON.map((row) => (
            <div key={row.label} className="border-t border-line pt-4">
              <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
                <dt className="font-medium">{row.label}</dt>
                <dd className="tabular-nums text-ink/70">{row.price}</dd>
              </div>
              <p className="mt-1 text-sm text-ink/70">{row.note}</p>
            </div>
          ))}
        </dl>
        <p className="prose-measure mt-8 text-ink/80">
          Nämä kolme yhdessä ovat noin 280–300 euroa vuodessa. Kymmenen huoneiston taloyhtiöllä eRappu maksaa{" "}
          <span className="tabular-nums">{formatEuro(monthlyPrice(10, "yearly") * 12)} vuodessa</span> vuosimaksulla, ja samaan hintaan kuuluvat myös
          asiakirjapankki, kokoukset ja pöytäkirjojen sähköinen allekirjoitus, huoltopyynnöt, vuosikello, kulutusseuranta ja osakkaiden portaali. {VAT_NOTE}
        </p>
      </Section>

      <Section title="Kuka ylläpitää palvelua?">
        <p className="prose-measure text-ink/80">
          Isännöitsijä. Hän hoitaa yhtiön asiat eRapussa kuten tähänkin asti: kokoukset, asiakirjat, todistukset ja lakisääteiset ilmoitukset. Hallitus saa saman tiedon
          näkyviinsä, eikä hallitukselle siirry töitä. Palvelun toimittaa {`Adepta Tilat Oy`}.
        </p>
      </Section>

      <Section tone="cloud" title="Tietoturva ja tietojen säilytys">
        <FeatureGrid items={TRUST} />
        <p className="mt-10">
          <Link href="/tietosuoja" className="font-medium underline underline-offset-4">
            Tietosuojaseloste
          </Link>
        </p>
      </Section>

      <Section title="Usein kysytyt kysymykset">
        <FaqList items={BUYING_FAQ} />
      </Section>

      <Section id="ehdota" tone="cloud" title="Ehdota eRappua taloyhtiöllesi" lead="Lähetä tämä viesti isännöitsijälle tai hallituksen puheenjohtajalle. Muokkaa vapaasti.">
        <ProposeMessage />
        <div className="mt-10">
          <PrimaryCta size="lg" />
        </div>
      </Section>
    </>
  );
}
