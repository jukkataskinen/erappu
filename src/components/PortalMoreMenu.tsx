"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

type MenuItem = { href: string; label: string; xlHidden?: boolean };

/**
 * Portaalin ylävalikon "Lisää": kohdat, jotka eivät mahdu riville. `details`
 * toimii ilman JavaScriptiä; skripti vain sulkee valikon sivun vaihtuessa,
 * ulkopuolista klikatessa ja Escillä.
 */
export function PortalMoreMenu({ items }: { items: MenuItem[] }) {
  const pathname = usePathname();
  const ref = useRef<HTMLDetailsElement>(null);
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  const anyActive = items.some((i) => isActive(i.href));

  useEffect(() => {
    ref.current?.removeAttribute("open");
  }, [pathname]);

  useEffect(() => {
    function onPointer(e: PointerEvent) {
      if (ref.current?.open && !ref.current.contains(e.target as Node)) ref.current.removeAttribute("open");
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && ref.current?.open) {
        ref.current.removeAttribute("open");
        ref.current.querySelector("summary")?.focus();
      }
    }
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  return (
    <details ref={ref} className="group relative">
      <summary
        className={`flex min-h-10 cursor-pointer list-none items-center gap-1 whitespace-nowrap rounded-xl px-3 text-sm font-semibold [&::-webkit-details-marker]:hidden ${
          anyActive ? "bg-cloud text-ink" : "text-ink/65 hover:bg-cloud/70 hover:text-ink"
        }`}
      >
        Lisää
        <svg aria-hidden viewBox="0 0 12 12" className="h-3 w-3 transition-transform group-open:rotate-180">
          <path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </summary>
      <ul className="absolute left-0 top-full z-20 mt-1.5 grid min-w-52 gap-0.5 rounded-xl border border-line bg-paper p-1.5 shadow-[0_8px_24px_rgba(27,42,65,0.14)]">
        {items.map((i) => {
          const active = isActive(i.href);
          return (
            <li key={i.href} className={i.xlHidden ? "xl:hidden" : undefined}>
              <Link
                href={i.href}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-10 items-center rounded-lg px-3 text-sm font-semibold ${active ? "bg-cloud text-ink" : "text-ink/70 hover:bg-cloud/70 hover:text-ink"}`}
              >
                {i.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </details>
  );
}
