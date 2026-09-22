"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";

/** Mobiilivalikko markkinointisivuille. CTA tulee propsina palvelinkomponentilta. */
export function MobileNav({ items, cta }: { items: { href: string; label: string }[]; cta?: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="lg:hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="mobile-nav-panel"
        className="inline-flex items-center justify-center rounded-[var(--radius-panel)] border border-line p-2 text-ink"
      >
        <span className="sr-only">{open ? "Sulje valikko" : "Avaa valikko"}</span>
        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
          {open ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
        </svg>
      </button>
      {open ? (
        <div id="mobile-nav-panel" className="absolute inset-x-0 top-[65px] z-20 border-b border-line bg-paper px-6 pb-6 pt-2">
          <ul className="flex flex-col">
            {items.map((item) => (
              <li key={item.href} className="border-b border-line">
                <Link href={item.href} onClick={() => setOpen(false)} className="block py-3 text-ink">
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
          {cta ? <div className="mt-5">{cta}</div> : null}
        </div>
      ) : null}
    </div>
  );
}
