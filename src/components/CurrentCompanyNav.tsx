"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NavIcon } from "./NavIcon";

/**
 * Valittu taloyhtiö sivupalkissa. Yhtiö päätellään osoitteesta, koska kehys
 * ei renderöidy uudelleen sivujen välillä. Nimi tulee kehyksen nimilistasta;
 * juuri luotu yhtiö voi puuttua listasta, jolloin näytetään yleisnimi.
 */
export function CurrentCompanyNav({ companies }: { companies: { id: string; name: string }[] }) {
  const pathname = usePathname();
  const match = /^\/taloyhtiot\/([0-9a-f-]{36})(\/|$)/i.exec(pathname);
  if (!match) return null;
  const id = match[1];
  const name = companies.find((c) => c.id === id)?.name ?? "Valittu yhtiö";
  const onOverview = pathname === `/taloyhtiot/${id}`;

  return (
    <div className="flex shrink-0 items-center gap-1 lg:mt-2 lg:block lg:rounded-xl lg:border lg:border-line lg:bg-cloud/50 lg:p-2">
      <p className="hidden px-2 pb-1 text-xs font-semibold uppercase tracking-wide text-ink/45 lg:block">Valittu yhtiö</p>
      <Link
        href={`/taloyhtiot/${id}`}
        aria-current={onOverview ? "page" : undefined}
        className={`flex min-h-10 items-center gap-3 whitespace-nowrap rounded-xl px-3 text-sm font-semibold lg:whitespace-normal ${
          onOverview ? "bg-paper text-ink lg:shadow-[0_0_0_1px_var(--color-line)]" : "text-ink/80 hover:bg-paper hover:text-ink"
        }`}
      >
        <NavIcon name="building" />
        <span className="min-w-0 lg:line-clamp-2">{name}</span>
      </Link>
      <Link href="/taloyhtiot" className="hidden px-3 pt-1 text-xs text-sky hover:underline lg:block">
        Vaihda yhtiö
      </Link>
    </div>
  );
}
