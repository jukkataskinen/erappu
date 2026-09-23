import { notFound } from "next/navigation";
import { Brand } from "@/components/Brand";
import { FormError } from "@/components/FormError";
import { Button, DefinitionList, Field, Input, Notice, Panel, SectionTitle, Textarea } from "@/components/ui";
import { getDb } from "@/lib/db";
import { formatDate, formatDateTime, formatEur, isoDateHelsinki } from "@/lib/format";
import { PhotoForm } from "@/lib/service-requests/components/PhotoForm";
import { PhotoInput } from "@/lib/service-requests/components/PhotoInput";
import { PhotoGrid, StatusBadge, Timeline, UrgencyBadge, YesNo } from "@/lib/service-requests/components/parts";
import { CATEGORY_LABEL } from "@/lib/service-requests/labels";
import { listProviderEvents, listProviderPhotos, resolveProviderTask } from "@/lib/service-requests/links";
import { isOpen, providerTransition } from "@/lib/service-requests/status";
import { providerAcknowledge, providerComment, providerCost, providerPhotos, providerStatus } from "./actions";

export const metadata = { title: "Työtilaus" };
export const dynamic = "force-dynamic";

export default async function ProviderTaskPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ virhe?: string }> }) {
  const { token } = await params;
  const { virhe } = await searchParams;
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) notFound();
  const db = await getDb();
  const data = await db.asService(async (tx) => {
    const task = await resolveProviderTask(tx, token);
    if (!task) return null;
    const [events, photos] = await Promise.all([listProviderEvents(tx, task.requestId), listProviderPhotos(tx, task.requestId, task.organizationId)]);
    return { task, events, photos };
  });
  if (!data) {
    return (
      <div className="mx-auto max-w-xl px-5 py-10">
        <Brand />
        <h1 className="mt-6 text-2xl">Linkki ei ole voimassa</h1>
        <p className="mt-2 text-ink/70">Tehtävälinkki on vanhentunut tai korvattu uudella tilauksella. Ota yhteys isännöintiin.</p>
      </div>
    );
  }
  const { task, events, photos } = data;
  const canPromise = isOpen(task.status);
  const canStart = providerTransition(task.status, "start") !== null;
  const canComplete = providerTransition(task.status, "complete") !== null;
  const closed = task.status === "closed" || task.status === "rejected";
  const today = isoDateHelsinki();
  const photoHref = (id: string) => `/tehtava/${token}/kuva/${id}`;

  return (
    <div className="mx-auto flex min-h-dvh max-w-2xl flex-col px-5 py-8">
      <Brand />
      <p className="mt-6 text-sm text-ink/60">Työtilaus {task.providerName} · #{task.number}</p>
      <h1 className="mt-1 text-2xl">{task.title}</h1>
      <div className="mt-2 flex flex-wrap gap-2">
        <StatusBadge status={task.status} />
        <UrgencyBadge urgency={task.urgency} />
      </div>
      <div className="mt-5">
        <FormError message={virhe} />
      </div>

      <Panel>
        <SectionTitle>Kohde</SectionTitle>
        <DefinitionList
          items={[
            { label: "Yhtiö", value: task.companyName },
            { label: "Osoite", value: task.address },
            { label: "Huoneisto tai tila", value: task.unitLabel },
            { label: "Aihe", value: CATEGORY_LABEL[task.category] },
            { label: "Saa käyttää yleisavainta", value: <YesNo value={task.mayUseMasterKey} /> },
            { label: "Lemmikkejä", value: <YesNo value={task.hasPets} /> },
            {
              label: "Ilmoittajan puhelin",
              value: task.reporterPhone ? <a href={`tel:${task.reporterPhone.replace(/[^+0-9]/g, "")}`} className="text-sky underline">{task.reporterPhone}</a> : "–",
            },
            { label: "Määräaika", value: task.dueOn ? formatDate(task.dueOn) : "–" },
            { label: "Kirjattu kustannus", value: formatEur(task.costEur) },
            { label: "Kuitattu", value: task.acknowledgedAt ? formatDateTime(task.acknowledgedAt) : "Ei vielä" },
            { label: "Lupasit tehdä viimeistään", value: task.promisedOn ? formatDate(task.promisedOn) : "Ei vielä kerrottu" },
          ]}
        />
        {task.description ? <p className="mt-4 whitespace-pre-wrap break-words">{task.description}</p> : null}
        {photos.length ? (
          <div className="mt-4">
            <PhotoGrid ids={photos.map((p) => p.id)} href={photoHref} />
          </div>
        ) : null}
      </Panel>

      {closed ? (
        <div className="mt-6">
          <Notice tone="neutral" title="Tehtävä on suljettu">
            Kirjauksia ei voi enää tehdä. Ota tarvittaessa yhteys isännöintiin.
          </Notice>
        </div>
      ) : (
        <>
          <Panel className="mt-6">
            <SectionTitle>{task.promisedOn ? "Aikataulu" : "Vastaanotto"}</SectionTitle>
            <form action={providerAcknowledge} className="grid gap-3">
              <input type="hidden" name="token" value={token} />
              <Field
                label="Työ tehdään viimeistään"
                htmlFor="promised_on"
                hint="Pakollinen. Päivä näkyy isännöinnille ja ilmoittajalle. Jos aikataulu muuttuu, anna tästä uusi päivä."
              >
                <Input id="promised_on" name="promised_on" type="date" required min={today} defaultValue={task.promisedOn ?? ""} disabled={!canPromise} />
              </Field>
              <Textarea name="note" maxLength={500} rows={2} aria-label="Tarkennus aikatauluun" placeholder="Vapaaehtoinen tarkennus, esim. käyn aamupäivällä" disabled={!canPromise} />
              <div>
                <Button type="submit" variant={task.acknowledgedAt ? "secondary" : "primary"} disabled={!canPromise}>
                  {task.acknowledgedAt ? "Päivitä aikataulu" : "Vastaanotettu"}
                </Button>
              </div>
            </form>
          </Panel>

          <Panel className="mt-6">
            <SectionTitle>Työn kulku</SectionTitle>
            <form action={providerStatus} className="grid gap-2 sm:grid-cols-2">
              <input type="hidden" name="token" value={token} />
              <Button type="submit" name="action" value="start" variant="secondary" disabled={!canStart}>
                Aloitettu
              </Button>
              <Button type="submit" name="action" value="complete" disabled={!canComplete}>
                Valmis
              </Button>
            </form>
          </Panel>

          <Panel className="mt-6">
            <SectionTitle>Kommentti isännöinnille</SectionTitle>
            <form action={providerComment} className="grid gap-3">
              <input type="hidden" name="token" value={token} />
              <Textarea name="body" required maxLength={5000} rows={3} aria-label="Kommentti" placeholder="Esim. osa tilattu, käynti ensi viikolla" />
              <div>
                <Button type="submit" variant="secondary">
                  Lähetä kommentti
                </Button>
              </div>
            </form>
          </Panel>

          <Panel className="mt-6">
            <SectionTitle>Kustannus</SectionTitle>
            <form action={providerCost} className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
              <input type="hidden" name="token" value={token} />
              <Field label="Summa euroina (sis. alv)" htmlFor="cost_eur">
                <Input id="cost_eur" name="cost_eur" inputMode="decimal" required />
              </Field>
              <Button type="submit" variant="secondary">
                Kirjaa
              </Button>
            </form>
          </Panel>

          <Panel className="mt-6">
            <SectionTitle>Kuvat</SectionTitle>
            <PhotoForm action={providerPhotos} className="grid gap-3">
              <input type="hidden" name="token" value={token} />
              <PhotoInput id="provider_photos" label="Lisää kuvia" />
              <div>
                <Button type="submit" variant="secondary">
                  Lähetä kuvat
                </Button>
              </div>
            </PhotoForm>
          </Panel>
        </>
      )}

      <Panel className="mt-6">
        <SectionTitle>Historia</SectionTitle>
        <Timeline events={events.map((e) => ({ ...e, actor_name: e.provider_actor ? "Palveluntuottaja" : "Isännöinti" }))} />
      </Panel>
      <p className="mt-6 text-xs text-ink/50">Älä välitä tätä linkkiä eteenpäin. Linkki on henkilökohtainen tätä tilausta varten.</p>
    </div>
  );
}
