import Link from "next/link";
import { CompanyHeader, loadCompany } from "@/components/CompanyHeader";
import { Badge, DefinitionList, LinkButton, Notice, Panel, SectionTitle, Stat } from "@/components/ui";
import { requireStaff } from "@/lib/auth/current-user";
import { formatDate, formatNumber } from "@/lib/format";
import { listBoard, listBuildings, listShareGroups } from "@/lib/registry/queries";
import { BOARD_ROLE, COMPANY_FORM, REDEMPTION_CLAUSE } from "@/lib/registry/labels";
import { checkCoverage } from "@/lib/registry/share-ranges";
import { latestKeyDocuments } from "@/lib/documents/key-documents";
import { KeyDocumentLinks } from "@/components/KeyDocuments";
import * as huolto from "@/widgets/huolto";
import * as htj from "@/widgets/htj";
import * as talous from "@/widgets/talous";
import * as viestinta from "@/widgets/viestinta";
import * as kokoukset from "@/widgets/kokoukset";
import * as arki from "@/widgets/arki";

export default async function CompanyOverviewPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireStaff();
  const { id } = await params;
  const company = await loadCompany(ctx, id);
  const [groups, board, buildings, keyDocs, manager] = await ctx.run(async (tx) =>
    Promise.all([
      listShareGroups(tx, id),
      listBoard(tx, id),
      listBuildings(tx, id),
      latestKeyDocuments(tx, [id]).then((m) => m.get(id) ?? {}),
      company.manager_user_id
        ? tx.query<{ name: string }>("select coalesce(full_name, email) as name from er_users where id = $1", [company.manager_user_id])
        : Promise.resolve([]),
    ]),
  );

  const issues = checkCoverage(groups.map((g) => ({ unitLabel: g.unit_label, ranges: g.ranges })), company.total_shares);
  const area = groups.reduce((s, g) => s + Number(g.area_m2 ?? 0), 0);
  const apartments = groups.filter((g) => g.kind === "apartment").length;
  const restrictions = REDEMPTION_CLAUSE.filter((r) => company.redemption_clause?.[r.key]).map((r) => r.label);
  const canWrite = ctx.can("owner", "manager", "assistant");

  return (
    <>
      <CompanyHeader company={company} active="yleiset" actions={canWrite ? <LinkButton variant="secondary" href={`/taloyhtiot/${id}/muokkaa`}>Muokkaa</LinkButton> : null} />

      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="Asuinhuoneistot" value={apartments} href={`/taloyhtiot/${id}/huoneistot`} />
        <Stat label="Muut osakeryhmät" value={groups.length - apartments} href={`/taloyhtiot/${id}/huoneistot`} />
        <Stat label="Huoneistoala" value={formatNumber(area, "m²")} />
        <Stat label="Osakkeet" value={formatNumber(company.total_shares)} tone={issues.length ? "alert" : undefined} />
      </div>

      {issues.length > 0 ? (
        <div className="mt-6">
          <Notice tone="alert" title={`Osakeluettelossa ${issues.length} korjattavaa kohtaa`}>
            <ul className="mt-1 list-disc pl-5">
              {issues.map((i, n) => (
                <li key={n}>{i.message}</li>
              ))}
            </ul>
            <p className="mt-2">Korjaa tiedot yhtiöjärjestyksen mukaan ennen HTJ-vertailua.</p>
          </Notice>
        </div>
      ) : null}

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Panel>
          <SectionTitle>Yhtiön tiedot</SectionTitle>
          <DefinitionList
            items={[
              { label: "Yhtiömuoto", value: COMPANY_FORM[company.company_form] },
              { label: "Osoite", value: [company.street_address, [company.postal_code, company.city].filter(Boolean).join(" ")].filter(Boolean).join(", ") || "–" },
              { label: "Yhtiöjärjestys", value: formatDate(company.articles_date) },
              { label: "Tilikausi alkaa", value: company.fiscal_year_start.split("-").reverse().join(".") + "." },
              { label: "Kaupparekisteri", value: company.commercial_register_note },
              { label: "Vastuuisännöitsijä", value: manager[0]?.name },
              { label: "Isännöinti alkoi", value: formatDate(company.management_started_on) },
              { label: "Vakuutus", value: [company.insurance_company, company.insurance_type].filter(Boolean).join(", ") || "–" },
              { label: "Kiinteistönhoito", value: company.property_maintenance },
              { label: "Sama vastikeperuste", value: company.same_charge_basis === null ? "–" : company.same_charge_basis ? "Kyllä" : "Ei" },
              { label: "Rakennukset", value: buildings.length ? buildings.map((b) => [b.label, b.building_type, b.completed_year].filter(Boolean).join(" ")).join("; ") : "–" },
              { label: "Rajoitukset", value: restrictions.length ? restrictions.join(", ") : "Ei rajoituksia" },
            ]}
          />
        </Panel>

        <div className="grid content-start gap-6">
        <Panel>
          <SectionTitle actions={<Link href={`/taloyhtiot/${id}/dokumentit`} className="text-sm text-sky">Kaikki</Link>}>Perusdokumentit</SectionTitle>
          <KeyDocumentLinks companyId={id} docs={keyDocs} />
        </Panel>
        <Panel>
          <SectionTitle actions={<Link href={`/taloyhtiot/${id}/hallitus`} className="text-sm text-sky">Kaikki</Link>}>Hallitus</SectionTitle>
          {board.length === 0 ? (
            <p className="text-sm text-ink/65">Hallituksen jäseniä ei ole kirjattu.</p>
          ) : (
            <ul className="divide-y divide-line">
              {board.map((b) => (
                <li key={b.id} className="flex items-center justify-between gap-3 py-2">
                  <span className="font-semibold">{b.display_name}</span>
                  <Badge tone={b.role === "chair" ? "info" : "neutral"}>{BOARD_ROLE[b.role]}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <huolto.CompanyOverviewWidget ctx={ctx} companyId={id} />
        <talous.CompanyOverviewWidget ctx={ctx} companyId={id} />
        <kokoukset.CompanyOverviewWidget ctx={ctx} companyId={id} />
        <htj.CompanyOverviewWidget ctx={ctx} companyId={id} />
        <arki.CompanyOverviewWidget ctx={ctx} companyId={id} />
        <viestinta.CompanyOverviewWidget ctx={ctx} companyId={id} />
        </div>
      </div>
    </>
  );
}
