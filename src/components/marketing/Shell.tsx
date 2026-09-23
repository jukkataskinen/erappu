import Link from "next/link";
import type { ReactNode } from "react";
import { Brand } from "@/components/Brand";
import { CONTACT } from "@/content/marketing";
import { MobileNav } from "./MobileNav";

/**
 * erappu.fi:n markkinointisivujen kehys (Jukka 22.9.2026). Ilme on
 * reilusoppari.fi:n: valkoinen paper-pohja, ohuet reunaviivat, ei varjoja,
 * pilleripainikkeet ja tumma alatunniste. Sovelluksen näkymät eivät käytä tätä.
 */

export const NAV = [
  { href: "/ominaisuudet", label: "Ominaisuudet" },
  { href: "/ominaisuudet#taloyhtiolle", label: "Taloyhtiölle" },
  { href: "/hinnat", label: "Hinnat" },
  { href: "/ukk", label: "UKK" },
  { href: "/yhteystiedot", label: "Yhteystiedot" },
];

export function Container({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={`mx-auto w-full max-w-[1080px] px-6 ${className ?? ""}`}>{children}</div>;
}

const BUTTON = "inline-flex items-center justify-center rounded-full bg-ink font-medium text-paper transition-colors hover:bg-ink-strong";

export function PrimaryCta({ size = "md", className }: { size?: "md" | "lg"; className?: string }) {
  return (
    <Link href="/yhteystiedot" className={`${BUTTON} ${size === "lg" ? "px-7 py-3.5" : "px-5 py-2.5 text-[15px]"} ${className ?? ""}`}>
      Pyydä esittely
    </Link>
  );
}

export function MarketingHeader() {
  return (
    <header className="relative border-b border-line bg-paper">
      <Container className="flex items-center justify-between gap-6 py-4">
        <Link href="/" className="shrink-0" aria-label="eRappu, etusivu">
          <Brand size={30} />
        </Link>
        <nav aria-label="Päänavigaatio" className="hidden lg:block">
          <ul className="flex items-center gap-6 text-[15px]">
            {NAV.map((item) => (
              <li key={item.href}>
                <Link href={item.href} className="text-ink hover:underline hover:underline-offset-4">
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="hidden items-center gap-5 lg:flex">
          <Link href="/kirjaudu" className="text-[15px] text-ink hover:underline hover:underline-offset-4">
            Kirjaudu
          </Link>
          <PrimaryCta />
        </div>
        <MobileNav items={[...NAV, { href: "/kirjaudu", label: "Kirjaudu" }]} cta={<PrimaryCta size="lg" className="w-full" />} />
      </Container>
    </header>
  );
}

const FOOTER_LINKS = [
  {
    title: "Palvelu",
    links: [
      { href: "/ominaisuudet#isannoitsijalle", label: "Isännöitsijälle" },
      { href: "/ominaisuudet#taloyhtiolle", label: "Hallitukselle ja asukkaille" },
      { href: "/hinnat", label: "Hinnat" },
      { href: "/ukk", label: "Usein kysyttyä" },
    ],
  },
  {
    title: "Yhteys",
    links: [
      { href: "/yhteystiedot", label: "Pyydä esittely" },
      { href: "/kirjaudu", label: "Kirjaudu" },
    ],
  },
];

export function MarketingFooter() {
  return (
    <footer className="bg-ink text-paper">
      <Container className="py-12">
        <div className="grid grid-cols-1 gap-10 md:grid-cols-[1.6fr_1fr_1fr]">
          <div>
            <Brand size={30} inverted />
            <p className="mt-4 max-w-xs text-sm text-cloud/80">
              Isännöinnin työkalu, jossa taloyhtiön asiat hoituvat yhdessä paikassa isännöitsijältä asukkaalle.
            </p>
            <p className="mt-4 text-sm font-medium text-paper">Suomalainen palvelu, tiedot EU:ssa.</p>
          </div>
          {FOOTER_LINKS.map((group) => (
            <div key={group.title}>
              <h2 className="text-sm font-medium text-cloud/60">{group.title}</h2>
              <ul className="mt-3 flex flex-col gap-2">
                {group.links.map((link) => (
                  <li key={link.href}>
                    <Link href={link.href} className="text-sm text-cloud/80 hover:text-paper">
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="mt-10 border-t border-white/10 pt-6 text-sm text-cloud/60">
          <p>
            Allekirjoitukset ja sinetöinti:{" "}
            <a href="https://esinetti.fi" className="underline underline-offset-2 hover:text-paper">
              eSinetti
            </a>
            .
          </p>
          <p className="mt-2">
            &copy; {new Date().getFullYear()} {CONTACT.company}
          </p>
        </div>
      </Container>
    </footer>
  );
}

/** Sisältösivujen otsikkoalue (sama rakenne kuin reilusoppari.fi:ssä). */
export function PageHero({ eyebrow, title, lead, children }: { eyebrow?: string; title: string; lead?: string; children?: ReactNode }) {
  return (
    <section className="border-b border-line bg-paper py-14 md:py-[72px]">
      <Container>
        <span className="block h-1 w-12 rounded-full bg-sky" aria-hidden="true" />
        {eyebrow ? <p className="mt-5 text-sm font-medium text-ink/60">{eyebrow}</p> : null}
        <h1 className="mt-3 max-w-3xl text-[30px] md:text-[44px]">{title}</h1>
        {lead ? <p className="prose-measure mt-5 text-lg text-ink/80">{lead}</p> : null}
        {children ? <div className="mt-8">{children}</div> : null}
      </Container>
    </section>
  );
}

export function Section({ id, title, lead, tone = "paper", children }: { id?: string; title?: string; lead?: string; tone?: "paper" | "cloud"; children: ReactNode }) {
  return (
    <section id={id} className={`scroll-mt-16 border-b border-line py-14 md:py-[88px] ${tone === "cloud" ? "bg-cloud" : "bg-paper"}`}>
      <Container>
        {title ? <h2 className="text-2xl md:text-[32px]">{title}</h2> : null}
        {lead ? <p className="prose-measure mt-3 text-ink/75">{lead}</p> : null}
        <div className={title || lead ? "mt-10" : undefined}>{children}</div>
      </Container>
    </section>
  );
}

export function FeatureGrid({ items }: { items: { title: string; body: string }[] }) {
  return (
    <ul className="grid gap-x-10 gap-y-8 md:grid-cols-2 lg:grid-cols-3">
      {items.map((f) => (
        <li key={f.title} className="border-t border-line pt-5">
          <h3 className="text-lg">{f.title}</h3>
          <p className="mt-2 text-ink/75">{f.body}</p>
        </li>
      ))}
    </ul>
  );
}

export function FaqList({ items }: { items: { question: string; answer: string }[] }) {
  return (
    <div className="divide-y divide-line border-y border-line">
      {items.map((item) => (
        <details key={item.question} className="group py-4">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-left [&::-webkit-details-marker]:hidden">
            <span className="font-medium">{item.question}</span>
            <span className="shrink-0 text-ink/70 transition-transform group-open:rotate-45" aria-hidden="true">
              +
            </span>
          </summary>
          <p className="prose-measure mt-3 text-ink/75">{item.answer}</p>
        </details>
      ))}
    </div>
  );
}
