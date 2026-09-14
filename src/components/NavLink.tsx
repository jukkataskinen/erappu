"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

export function NavLink({ href, children, compact }: { href: string; children: ReactNode; compact?: boolean }) {
  const pathname = usePathname();
  const active = pathname === href || (href !== "/portaali" && pathname.startsWith(`${href}/`));
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={
        compact
          ? `flex min-h-[var(--size-touch)] flex-1 flex-col items-center justify-center gap-0.5 py-2 text-xs ${active ? "text-ink" : "text-ink/60"}`
          : `flex min-h-10 shrink-0 items-center gap-3 whitespace-nowrap rounded-xl px-3 text-sm font-semibold ${
              active ? "bg-cloud text-ink" : "text-ink/65 hover:bg-cloud/70 hover:text-ink"
            }`
      }
    >
      {children}
    </Link>
  );
}
