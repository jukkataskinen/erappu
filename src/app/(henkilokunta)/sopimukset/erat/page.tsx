import Link from "next/link";
import { Badge, EmptyState, LinkButton, PageHeader, Table, Td, Th } from "@/components/ui";
import { requireStaff } from "@/lib/auth/current-user";
import { getTemplate } from "@/lib/contract-templates";
import { BATCH_STATUS_LABEL, BATCH_STATUS_TONE, listBatches } from "@/lib/contract-templates/queries";
import { formatDate } from "@/lib/format";

export const metadata = { title: "Sopimusten massaluonti" };

export default async function BatchesPage() {
  const ctx = await requireStaff();
  const batches = await ctx.run((tx) => listBatches(tx, ctx.org.organizationId));
  const canWrite = ctx.can("owner", "manager", "assistant");

  return (
    <>
      <PageHeader
        title="Sopimusten massaluonti"
        subtitle="Sama sopimus usealle taloyhtiölle kerralla, allekirjoitus eSinetillä"
        back={{ href: "/sopimukset", label: "Sopimukset" }}
        actions={
          <>
            <LinkButton variant="secondary" href="/sopimukset/pohjat">Pohjat</LinkButton>
            {canWrite ? <LinkButton href="/sopimukset/erat/uusi">Uusi massaluonti</LinkButton> : null}
          </>
        }
      />
      {batches.length === 0 ? (
        <EmptyState title="Ei vielä eriä" action={canWrite ? <LinkButton href="/sopimukset/erat/uusi">Uusi massaluonti</LinkButton> : null}>
          Valitse pohja, urakoitsija ja yhtiöt, täytä yhtiökohtaiset tiedot ja lähetä sopimukset allekirjoitettavaksi yhdellä kertaa.
        </EmptyState>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Erä</Th>
              <Th>Urakoitsija</Th>
              <Th numeric>Yhtiöitä</Th>
              <Th>Tila</Th>
              <Th>Luotu</Th>
            </tr>
          </thead>
          <tbody>
            {batches.map((b) => (
              <tr key={b.id} className="row-link hover:bg-cloud/50">
                <Td>
                  <Link href={`/sopimukset/erat/${b.id}`} className="row-link-main font-semibold hover:text-sky">{b.title}</Link>
                  <span className="block text-xs text-ink/55">{getTemplate(b.template_key)?.name ?? b.template_key}</span>
                </Td>
                <Td>{b.provider_name ?? <span className="text-ink/55">–</span>}</Td>
                <Td numeric>{b.item_count}</Td>
                <Td>
                  <div className="flex flex-wrap gap-1">
                    <Badge tone={BATCH_STATUS_TONE[b.status]}>{BATCH_STATUS_LABEL[b.status]}</Badge>
                    {b.status === "sent" || b.status === "completed" ? (
                      <>
                        <Badge tone="warn">Lähetetty {b.sent_count}/{b.item_count}</Badge>
                        <Badge tone={b.signed_count === b.item_count ? "ok" : "neutral"}>Allekirjoitettu {b.signed_count}/{b.item_count}</Badge>
                      </>
                    ) : null}
                  </div>
                </Td>
                <Td>{formatDate(b.created_at)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}
