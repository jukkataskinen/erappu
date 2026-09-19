import { FormError } from "@/components/FormError";
import { Notice, PageHeader } from "@/components/ui";
import { requireStaff } from "@/lib/auth/current-user";
import { announcementDraft, isDraftKey } from "@/lib/announcements/drafts";
import { isoDateHelsinki } from "@/lib/format";
import { AnnouncementForm } from "../AnnouncementForm";
import { saveAnnouncement } from "../actions";
import { announcementFormOptions } from "../form-data";

export const metadata = { title: "Uusi tiedote" };

export default async function NewAnnouncementPage({ searchParams }: { searchParams: Promise<{ virhe?: string; yhtio?: string; pohja?: string }> }) {
  const ctx = await requireStaff();
  const { virhe, yhtio, pohja } = await searchParams;
  const { companies, buildings } = await ctx.run((tx) => announcementFormOptions(tx, ctx.org.organizationId));
  const companyId = companies.some((c) => c.id === yhtio) ? yhtio : undefined;
  // Vuosikellon asukastiedote-tehtävästä: valmis pohja, jonka hakasulkeissa olevat kohdat täydennetään.
  let draft: { title: string; body: string } | null = null;
  if (isDraftKey(pohja)) {
    const [m] = companyId
      ? await ctx.run((tx) =>
          tx.query<{ manager_name: string | null }>("select u.full_name as manager_name from er_housing_companies c left join er_users u on u.id = c.manager_user_id where c.id = $1", [companyId]),
        )
      : [];
    draft = announcementDraft(pohja, { year: Number(isoDateHelsinki().slice(0, 4)), managerName: m?.manager_name ?? null });
  }
  return (
    <>
      <PageHeader title="Uusi tiedote" subtitle="Tallenna ensin luonnos. Julkaisua ennen näet vastaanottajat ja esikatselun." back={{ href: "/tiedotteet", label: "Tiedotteet" }} />
      <FormError message={virhe} />
      {draft ? (
        <div className="mb-5 max-w-3xl">
          <Notice tone="info" title="Tiedote on esitäytetty vuosikellon pohjasta">
            Täydennä tai poista hakasulkeissa olevat kohdat. Tiedotteen voi julkaista vasta, kun niitä ei enää ole.
          </Notice>
        </div>
      ) : null}
      <div className="max-w-3xl">
        <AnnouncementForm action={saveAnnouncement} companies={companies} buildings={buildings} values={{ company_id: companyId, ...(draft ?? {}) }} />
      </div>
    </>
  );
}
