import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth/current-user";
import { getTemplate } from "@/lib/contract-templates";
import { renderContractPdf } from "@/lib/contract-templates/pdf";
import { fillTemplate } from "@/lib/contract-templates/render";
import { isoDateHelsinki } from "@/lib/format";

/**
 * Pohjan esikatselu kuvitteellisilla esimerkkiarvoilla. Vain henkilökunnalle;
 * ei henkilö- eikä rekisteritietoja, joten mitään ei tallenneta eikä lokiteta.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ key: string }> }) {
  const ctx = await requireStaff();
  const { key } = await params;
  const template = getTemplate(key);
  if (!template) return new NextResponse("Ei löytynyt", { status: 404 });
  const values = template.exampleValues;
  const pdf = await renderContractPdf({
    contract: fillTemplate(template, values),
    organizationName: ctx.org.organizationName,
    companyName: String(values.company_name ?? "As Oy Esimerkki"),
    companyBusinessId: String(values.company_business_id ?? ""),
    issuedOn: isoDateHelsinki(),
  });
  return new NextResponse(new Uint8Array(pdf.bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(`${template.key}-esikatselu.pdf`)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
