import Link from "next/link";
import { PriceCalculator } from "@/components/marketing/PriceCalculator";
import { FaqList, PageHero, PrimaryCta, Section } from "@/components/marketing/Shell";
import { formatEuro, MONTHLY, VAT_NOTE, YEARLY_MONTHLY } from "@/content/pricing";

export const metadata = {
  title: "Hinnat",
  description: "eRapun hinta: perusmaksu taloyhtiöltä ja huoneistokohtainen maksu. Vuosi etukäteen maksettuna 10 prosentin alennus. Laske hinta laskurilla.",
};

const PRICING_FAQ = [
  {
    question: "Mitä hintaan kuuluu?",
    answer: "Kaikki eRapun toiminnot: kokoukset ja asiakirjat, isännöitsijäntodistukset, vuosikello, pelastussuunnitelma, huoltopyynnöt, asukasportaali ja tietojen tuonti käyttöönotossa. Lisäosia ei ole.",
  },
  {
    question: "Mitä huoneistolla tarkoitetaan?",
    answer: "Yhtiöjärjestyksen mukaisia osakeryhmiä, eli asuinhuoneistoja ja liiketiloja. Autopaikkoja tai varastoja ei lasketa erikseen.",
  },
  {
    question: "Entä sähköiset allekirjoitukset?",
    answer: "Pöytäkirjojen ja sopimusten allekirjoitukset tehdään eSinetissä, jossa vahvasta tunnistuksesta veloitetaan erikseen. Kerromme hinnan esittelyssä.",
  },
  {
    question: "Miten laskutus toimii?",
    answer: "Vuosimaksu laskutetaan etukäteen kerran vuodessa ja siitä saa 10 prosentin alennuksen. Kuukausilaskutuksessa maksu peritään kuukausittain ilman alennusta.",
  },
];

export default function PricingPage() {
  return (
    <>
      <PageHero
        eyebrow="Hinnat"
        title="Hinta taloyhtiön koon mukaan."
        lead={`Perusmaksu taloyhtiöltä ja pieni maksu huoneistolta. Vuosi etukäteen maksettuna hinta on ${formatEuro(YEARLY_MONTHLY.base)} kuukaudessa taloyhtiöltä ja ${formatEuro(YEARLY_MONTHLY.perUnit)} huoneistolta, vähintään ${formatEuro(YEARLY_MONTHLY.minimum)} kuukaudessa.`}
      />

      <Section title="Laske hinta">
        <PriceCalculator />
      </Section>

      <Section tone="cloud" title="Hinnasto">
        <div className="grid gap-6 md:grid-cols-2">
          {(
            [
              { title: "Vuosi etukäteen", note: "10 prosentin alennus", rates: YEARLY_MONTHLY, highlight: true },
              { title: "Kuukausilaskutus", note: "Ei sitoutumista vuodeksi", rates: MONTHLY, highlight: false },
            ] as const
          ).map((plan) => (
            <div key={plan.title} className={`rounded-[var(--radius-panel)] border bg-paper p-6 ${plan.highlight ? "border-ink" : "border-line"}`}>
              <h3 className="text-lg">{plan.title}</h3>
              <p className="mt-1 text-sm text-ink/60">{plan.note}</p>
              <dl className="mt-4 grid gap-2 text-sm">
                <div className="flex justify-between gap-4 border-t border-line pt-2">
                  <dt className="text-ink/60">Taloyhtiö</dt>
                  <dd className="tabular-nums">{formatEuro(plan.rates.base)} / kk</dd>
                </div>
                <div className="flex justify-between gap-4 border-t border-line pt-2">
                  <dt className="text-ink/60">Huoneisto</dt>
                  <dd className="tabular-nums">{formatEuro(plan.rates.perUnit)} / kk</dd>
                </div>
                <div className="flex justify-between gap-4 border-t border-line pt-2">
                  <dt className="text-ink/60">Vähintään</dt>
                  <dd className="tabular-nums">{formatEuro(plan.rates.minimum)} / kk</dd>
                </div>
              </dl>
            </div>
          ))}
        </div>
        <p className="mt-6 text-sm text-ink/60">{VAT_NOTE}</p>
      </Section>

      <Section title="Hinnoittelusta usein kysyttyä">
        <FaqList items={PRICING_FAQ} />
        <div className="mt-10 flex flex-wrap items-center gap-4">
          <PrimaryCta size="lg" />
          <Link href="/ominaisuudet" className="text-[15px] underline underline-offset-4">
            Mitä hintaan kuuluu
          </Link>
        </div>
      </Section>
    </>
  );
}
