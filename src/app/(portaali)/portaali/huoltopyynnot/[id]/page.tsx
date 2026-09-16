import Link from "next/link";
import { notFound } from "next/navigation";
import { FormError } from "@/components/FormError";
import { ProgressSteps } from "@/components/ProgressSteps";
import { Button, DefinitionList, Notice, Panel, SectionTitle, Textarea } from "@/components/ui";
import { requirePortal } from "@/lib/auth/current-user";
import { formatDateTime } from "@/lib/format";
import { requestProgress } from "@/lib/progress";
import { PhotoForm } from "@/lib/service-requests/components/PhotoForm";
import { PhotoInput } from "@/lib/service-requests/components/PhotoInput";
import { StatusBadge, Timeline, UrgencyBadge, YesNo } from "@/lib/service-requests/components/parts";
import { CATEGORY_LABEL } from "@/lib/service-requests/labels";
import { getRequest, listPhotos, listPortalEvents } from "@/lib/service-requests/queries";
import { reporterTransition } from "@/lib/service-requests/status";
import { portalComment, portalPhotos, reporterAction } from "../actions";

export const metadata = { title: "Huoltopyyntö" };

export default async function PortalRequestPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ virhe?: string; uusi?: string }> }) {
  const ctx = await requirePortal();
  const { id } = await params;
  const { virhe, uusi } = await searchParams;
  const request = await ctx.run((tx) => getRequest(tx, id));
  if (!request) notFound();
  const mine = request.reporter_user_id === ctx.user.id;
  const board = ctx.companies.some((c) => c.id === request.company_id && c.roles.includes("board"));
  // Henkilökuntaan kuuluva näkee RLS:n kautta kaikki pyynnöt; portaalissa vain omat ja hallituksen.
  if (!mine && !board) notFound();

  const [events, photos] = await ctx.run((tx) =>
    Promise.all([listPortalEvents(tx, id, ctx.user.id, board), listPhotos(tx, id, ["reporter"])]),
  );
  const photoIds = new Set(photos.map((p) => p.id));
  const visibleEvents = events.filter((e) => e.type !== "attachment" || (e.document_id && photoIds.has(e.document_id)));
  const canClose = mine && reporterTransition(request.status, "close") !== null;
  const canReopen = mine && reporterTransition(request.status, "reopen") !== null;
  const open = !["closed", "rejected"].includes(request.status);

  return (
    <>
      <Link href="/portaali/huoltopyynnot" className="text-sm text-ink/60 hover:text-ink">
        ← Huoltopyynnöt
      </Link>
      <h1 className="mt-2 text-2xl">{request.title}</h1>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-ink/60">
        <StatusBadge status={request.status} />
        <UrgencyBadge urgency={request.urgency} />
        <span>#{request.number}</span>
      </div>
      <ProgressSteps progress={requestProgress(request.status)} className="mt-4 max-w-xl" />

      <div className="mt-4">
        <FormError message={virhe} />
        {uusi ? (
          <div className="mb-4">
            <Notice tone="ok" title="Pyyntö on lähetetty">
              Isännöinti käsittelee pyynnön. Saat sähköpostiin tiedon, kun tila muuttuu.
            </Notice>
          </div>
        ) : null}
      </div>

      {canClose || canReopen ? (
        <Panel className="mb-5">
          <SectionTitle>{request.status === "done" ? "Onko vika korjattu?" : "Onko vika palannut?"}</SectionTitle>
          {canClose ? (
            <form action={reporterAction} className="mb-4">
              <input type="hidden" name="id" value={id} />
              <input type="hidden" name="action" value="close" />
              <Button type="submit" className="w-full sm:w-auto">
                Kuittaa korjatuksi
              </Button>
            </form>
          ) : null}
          <form action={reporterAction} className="grid gap-3">
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="action" value="reopen" />
            <Textarea name="comment" required minLength={3} maxLength={5000} rows={2} aria-label="Syy uudelleenavaukselle" placeholder="Kerro, mikä on edelleen vialla" />
            <div>
              <Button type="submit" variant="secondary" className="w-full sm:w-auto">
                Avaa pyyntö uudelleen
              </Button>
            </div>
          </form>
        </Panel>
      ) : null}

      <Panel>
        <SectionTitle>Tiedot</SectionTitle>
        <p className="mb-4 whitespace-pre-wrap break-words">{request.description}</p>
        <DefinitionList
          items={[
            { label: "Kohde", value: `${request.company_name}${request.unit_label ? `, ${request.unit_label}` : ""}` },
            { label: "Aihe", value: CATEGORY_LABEL[request.category] },
            { label: "Tehty", value: formatDateTime(request.created_at) },
            { label: "Yleisavaimella", value: <YesNo value={request.may_use_master_key} /> },
            { label: "Lemmikkejä", value: <YesNo value={request.has_pets} /> },
            ...(mine ? [] : [{ label: "Lähde", value: "Asukkaan tai osakkaan ilmoitus" }]),
          ]}
        />
      </Panel>

      <Panel className="mt-5">
        <SectionTitle>Tapahtumat</SectionTitle>
        <Timeline events={visibleEvents} photoHref={(docId) => `/api/dokumentit/${docId}`} />
      </Panel>

      {mine && open ? (
        <>
          <Panel className="mt-5">
            <SectionTitle>Viesti isännöinnille</SectionTitle>
            <form action={portalComment} className="grid gap-3">
              <input type="hidden" name="id" value={id} />
              <Textarea name="body" required maxLength={5000} rows={3} aria-label="Viesti" />
              <div>
                <Button type="submit" variant="secondary" className="w-full sm:w-auto">
                  Lähetä viesti
                </Button>
              </div>
            </form>
          </Panel>
          <Panel className="mt-5">
            <SectionTitle>Lisää kuvia</SectionTitle>
            <PhotoForm action={portalPhotos} className="grid gap-3">
              <input type="hidden" name="id" value={id} />
              <PhotoInput id="portal_photos" label="Kuvat" />
              <div>
                <Button type="submit" variant="secondary" className="w-full sm:w-auto">
                  Lähetä kuvat
                </Button>
              </div>
            </PhotoForm>
          </Panel>
        </>
      ) : null}
    </>
  );
}
