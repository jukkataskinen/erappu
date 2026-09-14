import Link from "next/link";
import { Badge, Table, Td, Th } from "@/components/ui";
import { formatDate } from "@/lib/format";
import type { DocumentRow } from "@/lib/documents/queries";
import { CATEGORY_LABEL, VISIBILITY_LABEL, VISIBILITY_TONE, formatBytes } from "@/lib/documents/labels";

export function DocumentTable({ rows, showCompany = true }: { rows: DocumentRow[]; showCompany?: boolean }) {
  return (
    <Table>
      <thead>
        <tr>
          <Th>Dokumentti</Th>
          {showCompany ? <Th>Yhtiö</Th> : null}
          <Th>Luokka</Th>
          <Th>Näkyvyys</Th>
          <Th numeric>Vuosi</Th>
          <Th>Lisätty</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((d) => (
          <tr key={d.id} className="hover:bg-cloud/50">
            <Td>
              <Link href={`/dokumentit/${d.id}`} className="font-semibold hover:text-sky">
                {d.title}
              </Link>
              <p className="text-xs text-ink/55">
                <a href={`/api/dokumentit/${d.id}`} target="_blank" rel="noopener" className="hover:text-sky">
                  {d.file_name}
                </a>{" "}
                · {formatBytes(d.size_bytes)}
                {d.unit_label ? ` · huoneisto ${d.unit_label}` : ""}
                {d.subject_table ? " · liite" : ""}
              </p>
            </Td>
            {showCompany ? <Td>{d.company_name ?? "–"}</Td> : null}
            <Td>{CATEGORY_LABEL[d.category as keyof typeof CATEGORY_LABEL] ?? d.category}</Td>
            <Td>
              <Badge tone={VISIBILITY_TONE[d.visibility] ?? "neutral"}>{VISIBILITY_LABEL[d.visibility] ?? d.visibility}</Badge>
            </Td>
            <Td numeric>{d.year ?? "–"}</Td>
            <Td>{formatDate(d.created_at)}</Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
