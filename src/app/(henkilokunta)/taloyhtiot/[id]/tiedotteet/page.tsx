import { CompanyHeader, loadCompany } from "@/components/CompanyHeader";
import { LinkButton, Notice } from "@/components/ui";
import { requireStaff } from "@/lib/auth/current-user";
import { AnnouncementsView, type AnnouncementsSearch } from "../../../tiedotteet/AnnouncementsView";

export const metadata = { title: "Tiedotteet" };

export default async function CompanyAnnouncementsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<AnnouncementsSearch> }) {
  const ctx = await requireStaff();
  const { id } = await params;
  const company = await loadCompany(ctx, id);
  const sp = await searchParams;

  return (
    <AnnouncementsView
      ctx={ctx}
      sp={sp}
      fixedCompanyId={company.id}
      header={({ boardDrafts, newHref, canWrite }) => (
        <>
          <CompanyHeader company={company} active="tiedotteet" actions={canWrite ? <LinkButton href={newHref}>Uusi tiedote</LinkButton> : null} />
          {boardDrafts > 0 ? (
            <div className="mb-4">
              <Notice tone="warn" title={`${boardDrafts} hallituksen luonnosta odottaa julkaisua`} />
            </div>
          ) : null}
        </>
      )}
    />
  );
}
