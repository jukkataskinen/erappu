import Link from "next/link";
import { MarketplacePanel } from "./MarketplacePanel";
import { ProviderShare } from "./ProviderShare";
import { notFound } from "next/navigation";
import { FormError } from "@/components/FormError";
import { Button, DefinitionList, Field, Input, Notice, PageHeader, Panel, SectionTitle, Select, Textarea } from "@/components/ui";
import { requireStaff } from "@/lib/auth/current-user";
import { formatDate, formatDateTime, formatEur } from "@/lib/format";
import { getCompanyMarketplace, getListingForRequest } from "@/lib/marketplace/queries";
import { listStaff } from "@/lib/registry/queries";
import { PhotoForm } from "@/lib/service-requests/components/PhotoForm";
import { PhotoInput } from "@/lib/service-requests/components/PhotoInput";
import { StatusBadge, Timeline, UrgencyBadge, YesNo } from "@/lib/service-requests/components/parts";
import {
  CATEGORIES, CATEGORY_LABEL, COST_LABEL, COST_RESPONSIBILITIES, SOURCE_LABEL, STATUS_LABEL, URGENCIES, URGENCY_LABEL, VISIBILITIES, VISIBILITY_LABEL,
} from "@/lib/service-requests/labels";
import { getRequest, listEvents, listProviders, listShareGroupOptions } from "@/lib/service-requests/queries";
import { FINISHED_STATUSES, staffTransitions } from "@/lib/service-requests/status";
import {
  addRequestComment, addRequestPhotos, orderRequest, reopenRequest, updateRequestAssignment, updateRequestCost, updateRequestStatus,
} from "../actions";

export const metadata = { title: "Huoltopyyntö" };

function VisibilitySelect({ id, defaultValue = "internal" }: { id: string; defaultValue?: string }) {
  return (
    <Select id={id} name="visibility" defaultValue={defaultValue}>
      {VISIBILITIES.map((v) => (
        <option key={v} value={v}>
          {VISIBILITY_LABEL[v]}
        </option>
      ))}
    </Select>
  );
}

export default async function ServiceRequestPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ virhe?: string; tilattu?: string; tori?: string }> }) {
  const ctx = await requireStaff();
  const { id } = await params;
  const { virhe, tilattu, tori } = await searchParams;
  const request = await ctx.run((tx) => getRequest(tx, id));
  if (!request || request.organization_id !== ctx.org.organizationId) notFound();

  const [events, providers, staff, groups, links, listing, marketplace] = await ctx.run((tx) =>
    Promise.all([
      listEvents(tx, id),
      listProviders(tx, ctx.org.organizationId),
      listStaff(tx, ctx.org.organizationId),
      listShareGroupOptions(tx, ctx.org.organizationId),
      tx.query<{ expires_at: string | Date | null; last_used_at: string | Date | null; created_at: string | Date }>(
        `select expires_at, last_used_at, created_at from er_access_links
          where subject_table = 'er_service_requests' and subject_id = $1 and purpose = 'provider_task' and revoked_at is null
          order by created_at desc limit 1`,
        [id],
      ),
      getListingForRequest(tx, id),
      getCompanyMarketplace(tx, request.company_id),
    ]),
  );
  const canWrite = ctx.can("owner", "manager", "assistant");
  const canCost = canWrite || ctx.can("accountant");
  const finished = FINISHED_STATUSES.includes(request.status);
  const transitions = staffTransitions(request.status).filter((s) => !(finished && s === "received"));
  const companyGroups = groups.filter((g) => g.company_id === request.company_id);
  const provider = providers.find((p) => p.id === request.provider_id);
  const link = links[0];

  return (
    <>
      <PageHeader
        back={{ href: "/huoltopyynnot", label: "Huoltopyynnöt" }}
        title={
          <span>
            <span className="text-ink/45">#{request.number}</span> {request.title}
          </span>
        }
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge status={request.status} />
            <UrgencyBadge urgency={request.urgency} hideNormal={false} />
            <Link href={`/taloyhtiot/${request.company_id}/huolto`} className="hover:text-sky">
              {request.company_name}
            </Link>
            {request.unit_label ? <span>· {request.unit_label}</span> : null}
          </span>
        }
      />
      <FormError message={virhe} />
      {tilattu ? (
        <div className="mb-5">
          <Notice tone="ok" title="Tilaus on jonossa">
            Palveluntuottaja saa sähköpostiin tehtävälinkin, joka on voimassa 30 päivää.
          </Notice>
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[1.5fr_1fr]">
        <div className="grid content-start gap-6">
          <Panel>
            <SectionTitle>Tiedot</SectionTitle>
            {request.description ? <p className="mb-4 whitespace-pre-wrap break-words">{request.description}</p> : null}
            <DefinitionList
              items={[
                { label: "Aihe", value: CATEGORY_LABEL[request.category] },
                { label: "Lähde", value: SOURCE_LABEL[request.source] ?? request.source },
                { label: "Ilmoittaja", value: request.reporter_name ?? "–" },
                { label: "Yhteystiedot", value: [request.reporter_phone, request.reporter_email].filter(Boolean).join(" · ") || "–" },
                { label: "Yleisavaimella", value: <YesNo value={request.may_use_master_key} /> },
                { label: "Lemmikkejä", value: <YesNo value={request.has_pets} /> },
                { label: "Saapui", value: formatDateTime(request.created_at) },
                { label: "Määräaika", value: request.due_on ? <span className={request.overdue ? "font-semibold text-coral" : ""}>{formatDate(request.due_on)}</span> : "–" },
                { label: "Palveluntuottajan lupaus", value: request.provider_promised_on ? `Työ tehdään viimeistään ${formatDate(request.provider_promised_on)}` : "–" },
                { label: "Valmistui", value: formatDateTime(request.completed_at) },
                { label: "Suljettu", value: formatDateTime(request.closed_at) },
                { label: "Avattu uudelleen", value: request.reopened_count ? `${request.reopened_count} kertaa` : "–" },
                { label: "Kustannus", value: `${formatEur(request.cost_eur)} (${COST_LABEL[request.cost_responsibility]})` },
              ]}
            />
          </Panel>

          <Panel>
            <SectionTitle>Tapahtumat</SectionTitle>
            <Timeline events={events} photoHref={(docId) => `/api/dokumentit/${docId}`} showVisibility />
          </Panel>

          <Panel>
            <SectionTitle>Kommentti</SectionTitle>
            <form action={addRequestComment} className="grid gap-3">
              <input type="hidden" name="id" value={id} />
              <Textarea name="body" required maxLength={5000} rows={3} aria-label="Kommentti" />
              <div className="flex flex-wrap items-end gap-3">
                <Field label="Näkyvyys" htmlFor="comment_visibility">
                  <VisibilitySelect id="comment_visibility" />
                </Field>
                <Button variant="secondary" type="submit">
                  Lisää kommentti
                </Button>
              </div>
              <p className="text-xs text-ink/55">
                Ilmoittaja ja hallitus näkevät vain näkyvyydellä &quot;{VISIBILITY_LABEL.reporter}&quot; kirjatut. Palveluntuottaja näkee
                tehtävälinkissä vain &quot;{VISIBILITY_LABEL.provider}&quot;-kommentit.
              </p>
            </form>
          </Panel>

          <Panel>
            <SectionTitle>Lisää kuvia</SectionTitle>
            <PhotoForm action={addRequestPhotos} className="grid gap-3">
              <input type="hidden" name="id" value={id} />
              <PhotoInput id="staff_photos" label="Kuvat" />
              <div className="flex flex-wrap items-end gap-3">
                <Field label="Näkyvyys" htmlFor="photo_visibility">
                  <Select id="photo_visibility" name="photo_visibility" defaultValue="reporter">
                    <option value="reporter">Ilmoittaja, hallitus ja palveluntuottaja</option>
                    <option value="internal">Vain henkilökunta</option>
                  </Select>
                </Field>
                <Button variant="secondary" type="submit">
                  Lähetä kuvat
                </Button>
              </div>
            </PhotoForm>
          </Panel>
        </div>

        <div className="grid content-start gap-6">
          {canWrite ? (
            <Panel>
              <SectionTitle>Tila</SectionTitle>
              {request.status === "closed" || request.status === "rejected" ? (
                <form action={reopenRequest} className="grid gap-3">
                  <input type="hidden" name="id" value={id} />
                  <p className="text-sm text-ink/70">Pyyntö on {STATUS_LABEL[request.status].toLowerCase()}. Pyyntöä ei voi poistaa, mutta sen voi avata uudelleen.</p>
                  <Field label="Syy uudelleenavaukselle" htmlFor="reopen_comment" hint="Näkyy ilmoittajalle">
                    <Textarea id="reopen_comment" name="comment" required minLength={3} maxLength={5000} rows={2} />
                  </Field>
                  <div>
                    <Button variant="secondary" type="submit">
                      Avaa uudelleen
                    </Button>
                  </div>
                </form>
              ) : (
                <form action={updateRequestStatus} className="grid gap-3">
                  <input type="hidden" name="id" value={id} />
                  <Field label="Uusi tila" htmlFor="status">
                    <Select id="status" name="status" defaultValue={transitions[0]}>
                      {transitions.map((s) => (
                        <option key={s} value={s}>
                          {STATUS_LABEL[s]}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Kommentti (vapaaehtoinen)" htmlFor="status_comment">
                    <Textarea id="status_comment" name="comment" maxLength={5000} rows={2} />
                  </Field>
                  <Field label="Kommentin näkyvyys" htmlFor="status_visibility">
                    <VisibilitySelect id="status_visibility" defaultValue="reporter" />
                  </Field>
                  <p className="text-xs text-ink/55">Ilmoittaja saa sähköpostin tilamuutoksesta, jos osoite on tiedossa.</p>
                  <div>
                    <Button type="submit">Vaihda tila</Button>
                  </div>
                </form>
              )}
            </Panel>
          ) : null}

          {canWrite ? (
            <Panel>
              <SectionTitle>Käsittely</SectionTitle>
              <form action={updateRequestAssignment} className="grid gap-3">
                <input type="hidden" name="id" value={id} />
                <Field label="Vastuuhenkilö" htmlFor="assignee_user_id">
                  <Select id="assignee_user_id" name="assignee_user_id" defaultValue={request.assignee_user_id ?? ""}>
                    <option value="">Ei vastuuhenkilöä</option>
                    {staff.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Palveluntuottaja" htmlFor="provider_id">
                  <Select id="provider_id" name="provider_id" defaultValue={request.provider_id ?? ""}>
                    <option value="">Ei palveluntuottajaa</option>
                    {providers.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Määräaika" htmlFor="due_on">
                    <Input id="due_on" name="due_on" type="date" defaultValue={request.due_on ?? ""} />
                  </Field>
                  <Field label="Kiireellisyys" htmlFor="urgency">
                    <Select id="urgency" name="urgency" defaultValue={request.urgency}>
                      {URGENCIES.map((u) => (
                        <option key={u} value={u}>
                          {URGENCY_LABEL[u]}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </div>
                <Field label="Aihe" htmlFor="category">
                  <Select id="category" name="category" defaultValue={request.category}>
                    {CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {CATEGORY_LABEL[c]}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Huoneisto" htmlFor="share_group_id" hint={request.unit_text ? `Ilmoittajan antama: ${request.unit_text}` : undefined}>
                  <Select id="share_group_id" name="share_group_id" defaultValue={request.share_group_id ?? ""}>
                    <option value="">Ei huoneistoa</option>
                    {companyGroups.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.unit_label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <div>
                  <Button variant="secondary" type="submit">
                    Tallenna
                  </Button>
                </div>
              </form>
            </Panel>
          ) : null}

          <MarketplacePanel
            requestId={id}
            urgent={request.urgency === "urgent"}
            finished={finished}
            company={marketplace}
            listing={listing}
            canWrite={canWrite}
            message={tori}
            categoryLabel={CATEGORY_LABEL[request.category]}
          />

          {canWrite ? (
            <Panel>
              <SectionTitle>Tilaus palveluntuottajalle</SectionTitle>
              {!provider ? (
                <p className="text-sm text-ink/65">Valitse ensin palveluntuottaja käsittelytiedoista.</p>
              ) : (
                <form action={orderRequest} className="grid gap-3">
                  <input type="hidden" name="id" value={id} />
                  <p className="text-sm">
                    <span className="font-semibold">{provider.name}</span>
                    <span className="block text-ink/60">{provider.email ?? "Sähköpostiosoite puuttuu"}</span>
                  </p>
                  {request.ordered_at ? (
                    <p className="text-xs text-ink/60">
                      Tilattu {formatDateTime(request.ordered_at)}
                      {request.provider_acknowledged_at ? `, kuitattu ${formatDateTime(request.provider_acknowledged_at)}` : ", ei vielä kuitattu"}.
                      {request.provider_promised_on ? ` Palveluntuottaja tekee työn viimeistään ${formatDate(request.provider_promised_on)}.` : ""}
                      {link ? ` Linkki voimassa ${formatDate(link.expires_at)} asti${link.last_used_at ? `, avattu viimeksi ${formatDateTime(link.last_used_at)}` : ""}.` : ""}
                    </p>
                  ) : null}
                  <p className="text-xs text-ink/55">
                    Palveluntuottaja saa linkin, jossa näkyvät osoite, huoneisto, kuvaus, avain- ja lemmikkitiedot sekä ilmoittajan puhelin. Uusi tilaus mitätöi aiemman linkin.
                  </p>
                  <div>
                    <Button type="submit" disabled={!provider.email || finished}>
                      {request.ordered_at ? "Lähetä tilaus uudelleen sähköpostilla" : "Lähetä tilaus sähköpostilla"}
                    </Button>
                  </div>
                </form>
              )}
              {provider ? (
                <div className="mt-3 border-t border-line pt-3">
                  <ProviderShare requestId={id} providerPhone={provider.phone} disabled={finished} ordered={!!request.ordered_at} />
                </div>
              ) : null}
            </Panel>
          ) : null}

          {canCost ? (
            <Panel>
              <SectionTitle>Kustannus</SectionTitle>
              <form action={updateRequestCost} className="grid gap-3">
                <input type="hidden" name="id" value={id} />
                <Field label="Kustannusvastuu" htmlFor="cost_responsibility">
                  <Select id="cost_responsibility" name="cost_responsibility" defaultValue={request.cost_responsibility}>
                    {COST_RESPONSIBILITIES.map((c) => (
                      <option key={c} value={c}>
                        {COST_LABEL[c]}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Summa (€, sis. alv)" htmlFor="cost_eur">
                  <Input id="cost_eur" name="cost_eur" inputMode="decimal" defaultValue={request.cost_eur ? String(Number(request.cost_eur)).replace(".", ",") : ""} />
                </Field>
                <div>
                  <Button variant="secondary" type="submit">
                    Tallenna kustannus
                  </Button>
                </div>
              </form>
            </Panel>
          ) : null}
        </div>
      </div>
    </>
  );
}
