import { FormError } from "@/components/FormError";
import { LinkButton, PageHeader, SectionTitle, Stat } from "@/components/ui";
import { requireStaff } from "@/lib/auth/current-user";
import { listOrders } from "@/lib/certificates/orders";
import { listMeetings, listPendingSignatures } from "@/lib/meetings/queries";
import { listCompanies } from "@/lib/registry/queries";
import { MeetingTable, NewMeetingForm } from "./components";

export const metadata = { title: "Kokoukset" };

export default async function MeetingsPage({ searchParams }: { searchParams: Promise<{ virhe?: string }> }) {
  const ctx = await requireStaff();
  const { virhe } = await searchParams;
  const orgId = ctx.org.organizationId;
  const [upcoming, past, pending, orders, companies] = await ctx.run((tx) =>
    Promise.all([
      listMeetings(tx, { organizationId: orgId, scope: "upcoming" }),
      listMeetings(tx, { organizationId: orgId, scope: "past", limit: 50 }),
      listPendingSignatures(tx, orgId),
      listOrders(tx, orgId, { openOnly: true }),
      listCompanies(tx, orgId),
    ]),
  );
  const canWrite = ctx.can("owner", "manager", "assistant");

  return (
    <>
      <PageHeader
        title="Kokoukset"
        subtitle="Yhtiökokoukset ja hallituksen kokoukset kaikista taloyhtiöistä"
        actions={<LinkButton variant="secondary" href="/todistukset">Isännöitsijäntodistukset</LinkButton>}
      />
      <FormError message={virhe} />
      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <Stat label="Tulevat kokoukset" value={upcoming.length} />
        <Stat label="Pöytäkirjat allekirjoitettavana" value={pending.length} tone={pending.length ? "warn" : undefined} />
        <Stat label="Avoimet todistustilaukset" value={orders.length} href="/todistukset" tone={orders.some((o) => o.status === "new") ? "alert" : undefined} />
      </div>
      <div className="grid gap-6 xl:grid-cols-[1.6fr_1fr]">
        <div className="grid content-start gap-6">
          <section>
            <SectionTitle>Tulevat</SectionTitle>
            <MeetingTable meetings={upcoming} showCompany empty="Ei tulevia kokouksia" />
          </section>
          <section>
            <SectionTitle>Pidetyt ja päättyneet</SectionTitle>
            <MeetingTable meetings={past} showCompany empty="Ei pidettyjä kokouksia" />
          </section>
        </div>
        {canWrite ? <NewMeetingForm companies={companies.map((c) => ({ id: c.id, name: c.name }))} /> : null}
      </div>
    </>
  );
}
