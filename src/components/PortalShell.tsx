import Link from "next/link";
import type { ReactNode } from "react";
import { Brand } from "./Brand";
import { NavLink } from "./NavLink";
import { PORTAL_NAV } from "@/config/nav";

/**
 * Osakkaan, asukkaan ja hallituksen portaali. Puhelin ensin kuten
 * Reilusopparissa: navigaatio alalaidassa peukalon ulottuvilla.
 */
export function PortalShell({ children, staffLink }: { children: ReactNode; staffLink?: boolean }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-10 border-b border-line bg-paper/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-[var(--container-content)] items-center justify-between px-5">
          <Link href="/portaali" className="flex items-center">
            <Brand />
          </Link>
          <div className="flex items-center gap-1">
            <nav className="hidden sm:flex sm:items-center sm:gap-1">
              {PORTAL_NAV.map((i) => (
                <Link key={i.href} href={i.href} className="rounded-full px-3 py-2 text-sm text-ink/70 hover:text-ink">
                  {i.label}
                </Link>
              ))}
            </nav>
            {staffLink ? (
              <Link href="/tyopoyta" className="px-3 py-2 text-sm text-sky">
                Työpöytä
              </Link>
            ) : null}
            <a href="/kirjaudu/ulos" className="px-3 py-2 text-sm text-ink/60 hover:text-ink">
              Kirjaudu ulos
            </a>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-[var(--container-content)] flex-1 px-5 py-8">{children}</main>
      <nav className="sticky bottom-0 border-t border-line bg-paper/95 backdrop-blur sm:hidden" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
        <div className="mx-auto flex max-w-[var(--container-content)]">
          {PORTAL_NAV.map((i) => (
            <NavLink key={i.href} href={i.href} compact>
              {i.label}
            </NavLink>
          ))}
        </div>
      </nav>
      <footer className="border-t border-line bg-cloud">
        <div className="mx-auto max-w-[var(--container-content)] px-5 py-5 text-sm text-ink/50">Taloyhtiön asiat yhdessä paikassa.</div>
      </footer>
    </div>
  );
}
