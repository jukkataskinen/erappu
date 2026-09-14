import { FormError } from "@/components/FormError";
import { PageHeader } from "@/components/ui";
import { requireStaff } from "@/lib/auth/current-user";
import { AnnouncementForm } from "../AnnouncementForm";
import { saveAnnouncement } from "../actions";
import { announcementFormOptions } from "../form-data";

export const metadata = { title: "Uusi tiedote" };

export default async function NewAnnouncementPage({ searchParams }: { searchParams: Promise<{ virhe?: string; yhtio?: string }> }) {
  const ctx = await requireStaff();
  const { virhe, yhtio } = await searchParams;
  const { companies, buildings } = await ctx.run((tx) => announcementFormOptions(tx, ctx.org.organizationId));
  return (
    <>
      <PageHeader title="Uusi tiedote" subtitle="Tallenna ensin luonnos. Julkaisua ennen näet vastaanottajat ja esikatselun." back={{ href: "/tiedotteet", label: "Tiedotteet" }} />
      <FormError message={virhe} />
      <div className="max-w-3xl">
        <AnnouncementForm action={saveAnnouncement} companies={companies} buildings={buildings} values={{ company_id: companies.some((c) => c.id === yhtio) ? yhtio : undefined }} />
      </div>
    </>
  );
}
