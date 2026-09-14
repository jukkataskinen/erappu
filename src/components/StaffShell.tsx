import Link from "next/link";
import type { ReactNode } from "react";
import { Brand } from "./Brand";
import { NavIcon } from "./NavIcon";
import { NavLink } from "./NavLink";
import { STAFF_NAV } from "@/config/nav";
import type { StaffContext } from "@/lib/auth/current-user";
import { switchOrganization } from "@/app/actions/session";

const ROLE_LABEL = { owner: "Pääkäyttäjä", manager: "Isännöitsijä", accountant: "Kirjanpitäjä", assistant: "Assistentti" } as const;

/**
 * Henkilökunnan kehys: sivupalkki työpöydällä, vaakasuuntainen valikko
 * kapealla näytöllä. Taulukot tarvitsevat tilaa, joten sisältöalue on leveä.
 */
export function StaffShell({ ctx, children }: { ctx: StaffContext; children: ReactNode }) {
  const items = STAFF_NAV.filter((i) => !i.roles || i.roles.includes(ctx.org.role));
  const hasPortal = ctx.user.portal.length > 0;
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[240px_minmax(0,1fr)]">
      <aside className="no-print border-b border-line bg-paper lg:sticky lg:top-0 lg:flex lg:h-dvh lg:flex-col lg:border-b-0 lg:border-r">
        <div className="flex h-14 items-center justify-between px-5">
          <Link href="/tyopoyta" aria-label="eRappu, työpöytä">
            <Brand />
          </Link>
          <a href="/kirjaudu/ulos" className="text-sm text-ink/55 hover:text-ink lg:hidden">
            Kirjaudu ulos
          </a>
        </div>
        <form action="/haku" role="search" className="px-3 pb-2">
          <label htmlFor="nav-search" className="sr-only">
            Hae
          </label>
          <input
            id="nav-search"
            name="q"
            placeholder="Hae yhtiö, huoneisto tai henkilö"
            className="min-h-10 w-full rounded-xl border border-line bg-cloud/60 px-3 text-sm placeholder:text-ink/45 focus:border-sky focus:bg-paper focus:outline-none"
          />
        </form>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-3 lg:min-h-0 lg:flex-1 lg:flex-col lg:gap-0.5 lg:overflow-y-auto lg:pb-3" aria-label="Päävalikko">
          {items.map((item) => (
            <NavLink key={item.href} href={item.href}>
              <NavIcon name={item.icon} />
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="hidden shrink-0 border-t border-line px-5 py-4 text-sm lg:block">
          <p className="truncate font-semibold">{ctx.user.fullName ?? ctx.user.email}</p>
          <p className="text-ink/55">
            {ROLE_LABEL[ctx.org.role]} · {ctx.org.organizationName}
          </p>
          {ctx.user.memberships.length > 1 ? (
            <form action={switchOrganization} className="mt-2">
              <label htmlFor="org-switch" className="sr-only">
                Organisaatio
              </label>
              <select id="org-switch" name="organizationId" defaultValue={ctx.org.organizationId} className="w-full rounded-lg border border-line bg-paper px-2 py-1 text-sm">
                {ctx.user.memberships.map((m) => (
                  <option key={m.organizationId} value={m.organizationId}>
                    {m.organizationName}
                  </option>
                ))}
              </select>
              <button className="mt-1 text-xs text-sky">Vaihda</button>
            </form>
          ) : null}
          <div className="mt-3 flex gap-4">
            {hasPortal ? (
              <Link href="/portaali" className="text-sky">
                Portaali
              </Link>
            ) : null}
            <a href="/kirjaudu/ulos" className="text-ink/55 hover:text-ink">
              Kirjaudu ulos
            </a>
          </div>
        </div>
      </aside>
      <main className="mx-auto w-full min-w-0 max-w-[var(--container-wide)] px-5 py-8 sm:px-8">{children}</main>
    </div>
  );
}
