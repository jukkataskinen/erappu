/** @jsxRuntime automatic */
/** @jsxImportSource react */
import { ContractDocument, type ContractDocumentData } from "@/documents/ContractDocument";
import { renderDocumentPdf, type RenderedDocument } from "@/documents/render";

export function renderContractPdf(data: ContractDocumentData): Promise<RenderedDocument> {
  return renderDocumentPdf(<ContractDocument data={data} />);
}
