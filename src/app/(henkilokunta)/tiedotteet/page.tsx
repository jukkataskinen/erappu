import { LinkButton, PageHeader } from "@/components/ui";
import { requireStaff } from "@/lib/auth/current-user";
import { AnnouncementsView, type AnnouncementsSearch } from "./AnnouncementsView";

export const metadata = { title: "Tiedotteet" };

export default async function AnnouncementsPage({ searchParams }: { searchParams: Promise<AnnouncementsSearch> }) {
  const ctx = await requireStaff();
  const sp = await searchParams;

  return (
    <AnnouncementsView
      ctx={ctx}
      sp={sp}
      header={({ boardDrafts, newHref, canWrite }) => (
        <PageHeader
          title="Tiedotteet"
          subtitle={boardDrafts > 0 ? `${boardDrafts} hallituksen luonnosta odottaa julkaisua` : "Tiedotteet osakkaille, asukkaille ja hallitukselle"}
          actions={
            <>
              <LinkButton variant="secondary" href="/tiedotteet/lahetykset">
                Lähetykset
              </LinkButton>
              {canWrite ? <LinkButton href={newHref}>Uusi tiedote</LinkButton> : null}
            </>
          }
        />
      )}
    />
  );
}
