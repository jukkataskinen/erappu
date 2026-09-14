import { notFound, redirect } from "next/navigation";
import { FormError } from "@/components/FormError";
import { PageHeader } from "@/components/ui";
import { requireStaff } from "@/lib/auth/current-user";
import { getAnnouncement } from "@/lib/announcements/queries";
import { AnnouncementForm } from "../../AnnouncementForm";
import { saveAnnouncement } from "../../actions";
import { announcementFormOptions } from "../../form-data";

export const metadata = { title: "Muokkaa tiedotetta" };

export default async function EditAnnouncementPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ virhe?: string }> }) {
  const ctx = await requireStaff();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { virhe } = await searchParams;
  const data = await ctx.run(async (tx) => {
    const a = await getAnnouncement(tx, id);
    if (!a) return null;
    return { a, ...(await announcementFormOptions(tx, a.organization_id)) };
  });
  if (!data) notFound();
  if (data.a.status !== "draft" || !ctx.can("owner", "manager", "assistant")) redirect(`/tiedotteet/${id}`);

  return (
    <>
      <PageHeader title="Muokkaa tiedotetta" back={{ href: `/tiedotteet/${id}`, label: data.a.title }} />
      <FormError message={virhe} />
      <div className="max-w-3xl">
        <AnnouncementForm action={saveAnnouncement} companies={data.companies} buildings={data.buildings} values={data.a} />
      </div>
    </>
  );
}
