import { CONTACT } from "@/content/marketing";
import { PageHero, Section } from "@/components/marketing/Shell";

export const metadata = {
  title: "Pyydä esittely",
  description: "Pyydä eRapun esittely. Käydään yhdessä läpi, miltä yhtiöidenne arki näyttää eRapussa.",
};

const SUBJECT = "eRappu-esittely";
const BODY = "Hei,\n\nhaluaisin eRapun esittelyn.\n\nIsännöintitoimisto:\nHallinnoitavia yhtiöitä noin:\nPuhelin:\n";

export default function ContactPage() {
  const mailto = `mailto:${CONTACT.email}?subject=${encodeURIComponent(SUBJECT)}&body=${encodeURIComponent(BODY)}`;
  return (
    <>
      <PageHero
        eyebrow="Yhteystiedot"
        title="Pyydä esittely."
        lead="Kerro, montako yhtiötä hallinnoitte, niin näytämme eRapun teidän arkenne kautta. Esittely ei sido mihinkään."
      />
      <Section>
        <div className="grid gap-10 md:grid-cols-2">
          <div>
            <a
              href={mailto}
              className="inline-flex items-center justify-center rounded-full bg-ink px-7 py-3.5 font-medium text-paper transition-colors hover:bg-ink-strong"
            >
              Lähetä sähköposti
            </a>
            <p className="mt-4 text-ink/70">
              Tai kirjoita osoitteeseen{" "}
              <a href={`mailto:${CONTACT.email}`} className="underline underline-offset-4">
                {CONTACT.email}
              </a>
              .
            </p>
          </div>
          <dl className="rounded-[var(--radius-panel)] border border-line bg-cloud p-6">
            <div className="flex justify-between gap-4">
              <dt className="text-ink/60">Yhteyshenkilö</dt>
              <dd>{CONTACT.person}</dd>
            </div>
            <div className="mt-3 flex justify-between gap-4 border-t border-line pt-3">
              <dt className="text-ink/60">Yritys</dt>
              <dd>{CONTACT.company}</dd>
            </div>
          </dl>
        </div>
      </Section>
    </>
  );
}
