import Link from "next/link";
import { notFound } from "next/navigation";
import { FormError } from "@/components/FormError";
import { Badge, Button, DefinitionList, LinkButton, Notice, PageHeader, Panel, SectionTitle, Stat } from "@/components/ui";
import { requireStaff } from "@/lib/auth/current-user";
import { formatDate, formatDateTime } from "@/lib/format";
import { deliveryStats, getAnnouncement } from "@/lib/announcements/queries";
import { resolveRecipients } from "@/lib/announcements/recipients";
import { composeAnnouncementEmail } from "@/lib/announcements/content";
import { ANNOUNCEMENT_STATUS, CHANNEL_LABEL, audienceText } from "@/lib/announcements/labels";
import { archiveAnnouncement, deleteDraft, publishAnnouncementAction } from "../actions";

export const metadata = { title: "Tiedote" };

export default async function AnnouncementPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ virhe?: string; julkaistu?: string }> }) {
  const ctx = await requireStaff();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { virhe, julkaistu } = await searchParams;

  const data = await ctx.run(async (tx) => {
    const a = await getAnnouncement(tx, id);
    if (!a) return null;
    const buildings = a.building_ids?.length
      ? await tx.query<{ label: string | null }>("select label from er_buildings where id = any($1::uuid[]) order by label", [a.building_ids])
      : [];
    const recipients = a.status === "draft" ? await resolveRecipients(tx, { companyId: a.company_id, audienceRoles: a.audience_roles, buildingIds: a.building_ids }) : null;
    const stats = a.status === "draft" ? null : await deliveryStats(tx, id);
    return { a, buildings, recipients, stats };
  });
  if (!data) notFound();
  const { a, buildings, recipients, stats } = data;
  const canWrite = ctx.can("owner", "manager", "assistant");
  const canPublish = ctx.can("owner", "manager");
  const email = a.channels.includes("email");
  const preview = composeAnnouncementEmail({
    companyName: a.company_name, title: a.title, body: a.body, validUntil: a.valid_until,
    portalUrl: process.env.APP_BASE_URL ? `${process.env.APP_BASE_URL.replace(/\/$/, "")}/portaali/tiedotteet/${a.id}` : null,
  });

  return (
    <>
      <PageHeader
        back={{ href: "/tiedotteet", label: "Tiedotteet" }}
        title={a.title}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <span>{a.company_name}</span>
            <Badge tone={ANNOUNCEMENT_STATUS[a.status].tone}>{ANNOUNCEMENT_STATUS[a.status].label}</Badge>
            {a.origin === "board" ? <Badge tone="info">Hallituksen luonnos</Badge> : null}
          </span>
        }
        actions={
          <>
            {a.status === "draft" && canWrite ? (
              <LinkButton variant="secondary" href={`/tiedotteet/${a.id}/muokkaa`}>
                Muokkaa
              </LinkButton>
            ) : null}
            {a.status === "published" && canWrite ? (
              <form action={archiveAnnouncement}>
                <input type="hidden" name="id" value={a.id} />
                <Button variant="secondary">Arkistoi</Button>
              </form>
            ) : null}
          </>
        }
      />
      <FormError message={virhe} />
      {julkaistu ? (
        <div className="mb-5">
          <Notice tone="ok" title="Tiedote julkaistu">
            {email ? "Sähköpostit on lähetetty tai ne ovat jonossa. Tilanne näkyy alla." : "Tiedote näkyy nyt portaalissa."}
          </Notice>
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <div className="grid content-start gap-6">
          <Panel>
            <SectionTitle>Esikatselu</SectionTitle>
            {email ? <p className="mb-2 text-sm text-ink/60">Sähköpostin aihe: {preview.subject}</p> : null}
            <div className="whitespace-pre-wrap rounded-xl border border-line bg-cloud/50 p-4 text-sm leading-relaxed">{email ? preview.body : a.body}</div>
          </Panel>
          <Panel>
            <SectionTitle>Tiedot</SectionTitle>
            <DefinitionList
              items={[
                { label: "Kohderyhmät", value: audienceText(a.audience_roles) },
                { label: "Rakennukset", value: buildings.length ? buildings.map((b) => b.label ?? "nimetön").join(", ") : "Koko yhtiö" },
                { label: "Kanavat", value: a.channels.map((c) => CHANNEL_LABEL[c]).join(", ") },
                { label: "Voimassa asti", value: a.valid_until ? formatDate(a.valid_until) : "Toistaiseksi" },
                { label: "Laatija", value: a.author_name },
                { label: "Julkaistu", value: a.published_at ? `${formatDateTime(a.published_at)}${a.published_by_name ? `, ${a.published_by_name}` : ""}` : "–" },
              ]}
            />
          </Panel>
        </div>

        <div className="grid content-start gap-6">
          {recipients ? (
            <Panel>
              <SectionTitle>Vastaanottajat</SectionTitle>
              <div className="grid grid-cols-2 gap-3">
                <Stat label="Henkilöitä" value={recipients.partyCount} />
                <Stat label="Portaalissa" value={recipients.portalUserCount} />
                {email ? <Stat label="Sähköposteja" value={recipients.emailRecipients.length} /> : null}
                {email ? <Stat label="Ilman sähköpostia" value={recipients.withoutEmailCount} tone={recipients.withoutEmailCount ? "warn" : undefined} /> : null}
              </div>
              {email && recipients.withoutEmailCount > 0 ? (
                <p className="mt-3 text-sm text-ink/65">Henkilöt ilman sähköpostia näkevät tiedotteen vain portaalissa, jos heillä on tunnus. Tarvittaessa tiedote jaetaan paperisena.</p>
              ) : null}
              {recipients.partyCount === 0 ? (
                <div className="mt-3">
                  <Notice tone="warn" title="Kohderyhmässä ei ole ketään">
                    Tarkista kohderyhmät ja rakennusrajaus sekä yhtiön osakas- ja asukastiedot.
                  </Notice>
                </div>
              ) : null}
              {canPublish ? (
                <form action={publishAnnouncementAction} className="mt-5 flex flex-wrap gap-2">
                  <input type="hidden" name="id" value={a.id} />
                  <Button>{email ? "Julkaise ja lähetä" : "Julkaise"}</Button>
                </form>
              ) : (
                <p className="mt-4 text-sm text-ink/60">Tiedotteen julkaisee pääkäyttäjä tai isännöitsijä.</p>
              )}
              {canWrite ? (
                <form action={deleteDraft} className="mt-3">
                  <input type="hidden" name="id" value={a.id} />
                  <button className="text-sm text-coral">Poista luonnos</button>
                </form>
              ) : null}
            </Panel>
          ) : null}

          {stats ? (
            <Panel>
              <SectionTitle>Lähetysraportti</SectionTitle>
              <div className="grid grid-cols-2 gap-3">
                <Stat label="Henkilöitä" value={a.recipient_party_count ?? 0} />
                <Stat label="Lukenut portaalissa" value={stats.reads} />
                {email ? (
                  <>
                    <Stat label="Lähetetty" value={stats.sent} tone="ok" />
                    <Stat label="Jonossa" value={stats.queued} tone={stats.queued ? "warn" : undefined} />
                    <Stat label="Epäonnistui" value={stats.failed} tone={stats.failed ? "alert" : undefined} />
                    <Stat label="Ilman sähköpostia" value={a.missing_email_count ?? 0} tone={a.missing_email_count ? "warn" : undefined} />
                  </>
                ) : null}
              </div>
              {stats.failed > 0 || stats.queued > 0 ? (
                <p className="mt-3 text-sm">
                  <Link href="/tiedotteet/lahetykset" className="text-sky">
                    Avaa lähetysjono
                  </Link>
                </p>
              ) : null}
            </Panel>
          ) : null}
        </div>
      </div>
    </>
  );
}
