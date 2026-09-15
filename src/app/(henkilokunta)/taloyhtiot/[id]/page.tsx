import Link from "next/link";
import { CompanyHeader, loadCompany } from "@/components/CompanyHeader";
import { NavIcon } from "@/components/NavIcon";
import { COMPANY_MODULE_GROUPS, companyModulesFor, type CompanyModule, type CompanyModuleKey } from "@/config/company-tabs";
import { requireStaff } from "@/lib/auth/current-user";
import { isoDateHelsinki } from "@/lib/format";
import { loadCompanyModuleStatus, type ModuleStatus, type ModuleTone } from "@/lib/registry/company-modules";

export const metadata = { title: "Taloyhtiö" };

const TONE_TEXT: Record<ModuleTone, string> = {
  neutral: "text-ink/60",
  ok: "text-moss",
  warn: "text-amber",
  alert: "text-coral",
};

/**
 * Yhtiön etusivu: kaikki yhtiön moduulit kortteina. Isännöitsijä valitsee
 * ensin yhtiön ja sitten asian, joten sivupalkissa ei ole moduulilinkkejä.
 */
export default async function CompanyModulesPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireStaff();
  const { id } = await params;
  const company = await loadCompany(ctx, id);
  const status = await ctx.run((tx) => loadCompanyModuleStatus(tx, company, isoDateHelsinki()));
  const modules = companyModulesFor(ctx.org.role);

  return (
    <>
      <CompanyHeader company={company} />
      <div className="grid gap-8">
        {COMPANY_MODULE_GROUPS.map((group) => {
          const items = modules.filter((m) => m.group === group.key);
          if (items.length === 0) return null;
          return (
            <section key={group.key} aria-labelledby={`ryhma-${group.key}`}>
              <h2 id={`ryhma-${group.key}`} className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink/50">
                {group.label}
              </h2>
              <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {items.map((m) => (
                  <li key={m.key}>
                    <ModuleCard companyId={id} module={m} status={status[m.key as CompanyModuleKey]} />
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </>
  );
}

function ModuleCard({ companyId, module: m, status }: { companyId: string; module: CompanyModule; status: ModuleStatus[CompanyModuleKey] }) {
  return (
    <Link
      href={`/taloyhtiot/${companyId}${m.path}`}
      // Inline-säde, koska globaali :focus-visible-sääntö muuttaisi muuten pyöristyksen.
      style={{ borderRadius: "var(--radius-panel)" }}
      className="group flex h-full min-h-24 items-start gap-4 border border-line bg-paper p-4 hover:border-sky/50 hover:bg-sky-soft/30 sm:p-5"
    >
      <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-cloud text-ink/75 group-hover:bg-sky-soft group-hover:text-sky">
        <NavIcon name={m.icon} size={22} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center justify-between gap-2">
          <span className="font-bold">{m.label}</span>
          <span aria-hidden className="text-ink/30 group-hover:text-sky">
            →
          </span>
        </span>
        <span className={`mt-0.5 block text-sm ${status ? TONE_TEXT[status.tone ?? "neutral"] : "text-ink/55"} ${status?.tone === "alert" ? "font-semibold" : ""}`}>
          {status?.text ?? m.description}
        </span>
      </span>
    </Link>
  );
}
