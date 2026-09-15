import { LinkButton, PageHeader } from "@/components/ui";
import { requireStaff } from "@/lib/auth/current-user";
import { ContractsView, type ContractsSearch } from "./ContractsView";

export const metadata = { title: "Sopimukset" };

export default async function ContractsPage({ searchParams }: { searchParams: Promise<ContractsSearch> }) {
  const ctx = await requireStaff();
  const sp = await searchParams;
  return (
    <ContractsView
      ctx={ctx}
      sp={sp}
      basePath="/sopimukset"
      header={({ newHref, canWrite }) => (
        <PageHeader
          title="Sopimukset"
          subtitle="Taloyhtiöiden sopimukset, irtisanomisajat ja muistutukset"
          actions={
            <>
              <LinkButton variant="secondary" href="/kulutus">Kulutusseuranta</LinkButton>
              <LinkButton variant="secondary" href="/sopimukset/pohjat">Pohjat</LinkButton>
              <LinkButton variant="secondary" href="/sopimukset/erat">Massaluonti</LinkButton>
              {canWrite ? <LinkButton href={newHref}>Lisää sopimus</LinkButton> : null}
            </>
          }
        />
      )}
    />
  );
}
