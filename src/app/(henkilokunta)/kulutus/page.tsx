import { LinkButton, PageHeader } from "@/components/ui";
import { requireStaff } from "@/lib/auth/current-user";
import { ConsumptionView, type ConsumptionSearch } from "./ConsumptionView";

export const metadata = { title: "Kulutusseuranta" };

export default async function ConsumptionPage({ searchParams }: { searchParams: Promise<ConsumptionSearch> }) {
  const ctx = await requireStaff();
  const sp = await searchParams;
  return (
    <ConsumptionView
      ctx={ctx}
      sp={sp}
      basePath="/kulutus"
      header={
        <PageHeader
          title="Kulutusseuranta"
          subtitle="Sähkö, vesi ja lämmitys (kaukolämpö tai öljy) yhtiöittäin"
          actions={
            <>
              <LinkButton variant="secondary" href="/sopimukset">Sopimukset</LinkButton>
              <LinkButton variant="secondary" href="/vuosikello">Vuosikello</LinkButton>
            </>
          }
        />
      }
    />
  );
}
