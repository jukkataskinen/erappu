import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui";
import { COMPANY_MODULES, companyModuleHref, type CompanyModuleKey } from "@/config/company-tabs";
import type { StaffContext } from "@/lib/auth/current-user";
import { getCompany, type Company } from "@/lib/registry/queries";
import { COMPANY_FORM } from "@/lib/registry/labels";
import type { ReactNode } from "react";

/**
 * Taloyhtiösivujen yhteinen otsikko. Palauttaa yhtiön, jotta sivu ei hae sitä
 * toiseen kertaan. Toisen organisaation yhtiö → 404 (RLS).
 */
export async function loadCompany(ctx: StaffContext, companyId: string): Promise<Company> {
  if (!/^[0-9a-f-]{36}$/i.test(companyId)) notFound();
  const company = await ctx.run((tx) => getCompany(tx, companyId));
  if (!company) notFound();
  return company;
}

function CompanyFacts({ company }: { company: Company }) {
  return (
    <span className="flex flex-wrap items-center gap-2">
      <span>{company.business_id}</span>
      <span aria-hidden>·</span>
      <span>{COMPANY_FORM[company.company_form]}</span>
      {company.city ? (
        <>
          <span aria-hidden>·</span>
          <span>{company.city}</span>
        </>
      ) : null}
      {company.htj_synced_at ? <Badge tone="ok">HTJ synkronoitu</Badge> : <Badge tone="warn">Ei HTJ-yhteyttä</Badge>}
    </span>
  );
}

function Breadcrumb({ items }: { items: { label: string; href?: string }[] }) {
  return (
    <nav aria-label="Murupolku" className="mb-2 text-sm text-ink/60">
      <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
        {items.map((item, i) => (
          <li key={i} className="flex min-w-0 items-center gap-1.5">
            {i > 0 ? <span aria-hidden className="text-ink/35">/</span> : null}
            {item.href ? (
              <Link href={item.href} className="truncate hover:text-ink">
                {item.label}
              </Link>
            ) : (
              <span aria-current="page" className="truncate font-semibold text-ink/80">
                {item.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

/**
 * Yhtiön etusivulla (`active` puuttuu) otsikko on yhtiön nimi ja perustiedot.
 * Moduulisivulla murupolku "Taloyhtiöt / Yhtiö / Moduuli" ja otsikkona moduuli;
 * yhtiö vie takaisin korttinäkymään. Moduulin alasivu antaa `sub`-tekstin
 * murupolun viimeiseksi osaksi, jolloin moduuli on linkki; `title` korvaa
 * lisäksi otsikon (esim. muokkaussivu).
 */
export function CompanyHeader({
  company,
  active,
  sub,
  title,
  actions,
}: {
  company: Company;
  active?: CompanyModuleKey;
  sub?: string;
  title?: string;
  actions?: ReactNode;
}) {
  const mod = active ? COMPANY_MODULES.find((m) => m.key === active) : undefined;
  const crumbs: { label: string; href?: string }[] = [{ label: "Taloyhtiöt", href: "/taloyhtiot" }];
  if (mod) {
    crumbs.push({ label: company.name, href: `/taloyhtiot/${company.id}` });
    const last = sub ?? title;
    crumbs.push({ label: mod.label, href: last ? companyModuleHref(company.id, mod.key) : undefined });
    if (last) crumbs.push({ label: last });
  } else {
    crumbs.push({ label: company.name });
  }

  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <Breadcrumb items={crumbs} />
        <h1 className="text-2xl sm:text-3xl">{mod ? (title ?? mod.label) : company.name}</h1>
        {mod ? null : (
          <div className="mt-1 text-ink/65">
            <CompanyFacts company={company} />
          </div>
        )}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </header>
  );
}
