import { LinkButton, PageHeader } from "@/components/ui";
import { requireStaff } from "@/lib/auth/current-user";
import { AnnualCycleView, type AnnualCycleSearch } from "./AnnualCycleView";

export const metadata = { title: "Vuosikello" };

export default async function AnnualCyclePage({ searchParams }: { searchParams: Promise<AnnualCycleSearch> }) {
  const ctx = await requireStaff();
  const sp = await searchParams;
  return (
    <AnnualCycleView
      ctx={ctx}
      sp={sp}
      basePath="/vuosikello"
      header={({ newHref }) => (
        <PageHeader
          title="Vuosikello"
          subtitle="Taloyhtiöiden määräajat ja toistuvat tehtävät"
          actions={
            <>
              <LinkButton variant="secondary" href="/sopimukset">Sopimukset</LinkButton>
              <LinkButton variant="secondary" href="/kulutus">Kulutusseuranta</LinkButton>
              <LinkButton href={newHref}>Uusi tehtävä</LinkButton>
            </>
          }
        />
      )}
    />
  );
}
