/** @jsxRuntime automatic */
/** @jsxImportSource react */
import "server-only";
import type { Sql } from "@/lib/db";
import { audit } from "@/lib/audit";
import { deleteStoredFile, storeFile } from "@/lib/storage";
import { renderDocumentPdf } from "@/documents/render";
import { RenovationGuide, type RenovationGuideData } from "@/documents/RenovationGuide";
import { buildGuideContent, RENOVATION_GUIDE_TEMPLATE_APPROVED, resolveGuideSettings, type GuideSettings } from "./renovation-guide";

/** Muutostyöohjeen lataus, esikatselu ja julkaisu dokumentiksi (0106). */

type Runner = <T>(fn: (tx: Sql) => Promise<T>) => Promise<T>;

export interface GuideCompany {
  id: string;
  organizationId: string;
  name: string;
  businessId: string | null;
  settings: GuideSettings;
  oldestBuildingYear: number | null;
  managerContact: string[];
  /** Palvelun "huolto" oletustoimittaja esitäyttöä varten. */
  defaultServiceContact: string | null;
}

export async function loadGuideCompany(tx: Sql, companyId: string): Promise<GuideCompany | null> {
  const [c] = await tx.query<{
    id: string; organization_id: string; name: string; business_id: string | null; settings: unknown; oldest_year: number | null;
    manager_name: string | null; manager_email: string | null; manager_phone: string | null; org_phone: string | null; org_email: string | null;
  }>(
    `select c.id, c.organization_id, c.name, c.business_id, c.renovation_guide_settings as settings,
            (select min(b.completed_year)::int from er_buildings b where b.company_id = c.id) as oldest_year,
            u.full_name as manager_name, u.email as manager_email, u.phone as manager_phone,
            o.settings #>> '{contact,phone}' as org_phone, o.settings #>> '{contact,email}' as org_email
       from er_housing_companies c join er_organizations o on o.id = c.organization_id
       left join er_users u on u.id = c.manager_user_id
      where c.id = $1`,
    [companyId],
  );
  if (!c) return null;
  const [service] = await tx.query<{ name: string; phone: string | null; email: string | null }>(
    `select p.name, coalesce(p.emergency_phone, p.phone) as phone, p.email
       from er_company_services s join er_service_providers p on p.id = s.provider_id
      where s.company_id = $1 and (s.service ilike '%huolto%' or s.default_for_requests)
      order by s.default_for_requests desc, s.created_at limit 1`,
    [companyId],
  );
  const phone = c.manager_phone ?? c.org_phone;
  const managerContact = c.manager_name
    ? [`Isännöitsijä ${c.manager_name}${phone ? `, puh. ${phone}` : ""}${(c.manager_email ?? c.org_email) ? `, ${c.manager_email ?? c.org_email}` : ""}`]
    : phone || c.org_email
      ? [`Isännöinti${phone ? `, puh. ${phone}` : ""}${c.org_email ? `, ${c.org_email}` : ""}`]
      : [];
  return {
    id: c.id,
    organizationId: c.organization_id,
    name: c.name,
    businessId: c.business_id,
    settings: resolveGuideSettings(c.settings),
    oldestBuildingYear: c.oldest_year,
    managerContact,
    defaultServiceContact: service ? [service.name, service.phone, service.email].filter(Boolean).join(", ") : null,
  };
}

export async function saveGuideSettings(tx: Sql, opts: { companyId: string; userId: string; settings: GuideSettings }) {
  const rows = await tx.query<{ organization_id: string }>(
    "update er_housing_companies set renovation_guide_settings = $2::jsonb where id = $1 returning organization_id",
    [opts.companyId, JSON.stringify(opts.settings)],
  );
  if (rows.length === 0) return false;
  await audit(tx, { organizationId: rows[0].organization_id, userId: opts.userId, action: "update", entity: "renovation_guide_settings", entityId: opts.companyId });
  return true;
}

function guideData(company: GuideCompany, issuedOn: string): RenovationGuideData {
  const settings = { ...company.settings, serviceContact: company.settings.serviceContact || company.defaultServiceContact || "" };
  return {
    approved: RENOVATION_GUIDE_TEMPLATE_APPROVED,
    companyName: company.name,
    businessId: company.businessId,
    issuedOn,
    content: buildGuideContent(settings, { companyName: company.name, oldestBuildingYear: company.oldestBuildingYear, managerContact: company.managerContact }),
  };
}

export async function renderGuidePdf(company: GuideCompany, issuedOn: string) {
  const pdf = await renderDocumentPdf(<RenovationGuide data={guideData(company, issuedOn)} />);
  return { ...pdf, fileName: `muutostyoohje-${issuedOn}.pdf` };
}

/** Tallentaa ohjeen yhtiön dokumentiksi. Uusin renovation_guide-dokumentti on osakkaan kuittaama ohje. */
export async function publishGuide(run: Runner, opts: { companyId: string; userId: string; issuedOn: string; visibleToOwners: boolean }): Promise<string | null> {
  const company = await run((tx) => loadGuideCompany(tx, opts.companyId));
  if (!company) return null;
  const pdf = await renderGuidePdf(company, opts.issuedOn);
  const stored = await storeFile({ organizationId: company.organizationId, companyId: company.id, fileName: pdf.fileName, mimeType: "application/pdf", bytes: Buffer.from(pdf.bytes) });
  try {
    return await run(async (tx) => {
      const [doc] = await tx.query<{ id: string }>(
        `insert into er_documents (organization_id, company_id, category, title, file_name, storage_path, mime_type, size_bytes, sha256, visibility, year, uploaded_by)
         values ($1,$2,'renovation_guide',$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id`,
        [company.organizationId, company.id, `Muutostyöohje${RENOVATION_GUIDE_TEMPLATE_APPROVED ? "" : " (luonnos)"}`, stored.fileName, stored.storagePath, stored.mimeType,
          stored.sizeBytes, stored.sha256, opts.visibleToOwners ? "owners" : "internal", Number(opts.issuedOn.slice(0, 4)), opts.userId],
      );
      await audit(tx, { organizationId: company.organizationId, userId: opts.userId, action: "create", entity: "renovation_guide", entityId: doc.id, details: { visible: opts.visibleToOwners } });
      return doc.id;
    });
  } catch (err) {
    await deleteStoredFile(stored.storagePath);
    throw err;
  }
}
