import { notFound } from "next/navigation";
import { CompanyHeader, loadCompany } from "@/components/CompanyHeader";
import { FormError } from "@/components/FormError";
import { Badge, Button, DefinitionList, Field, Input, LinkButton, Notice, Panel, SectionTitle, Table, Td, Th } from "@/components/ui";
import { requireStaff } from "@/lib/auth/current-user";
import { formatDate, formatDateTime } from "@/lib/format";
import { getBillingSettings } from "@/lib/finance/billing";
import { addDays, dueDateFor } from "@/lib/finance/dates";
import { RUN_STATUS, trimDecimal } from "@/lib/finance/labels";
import { parseScaled, scaledToDecimal } from "@/lib/finance/money";
import { defaultSettlementPeriod } from "@/lib/water/mutations";
import { ReadingChecks, ReadingConfirm, ReadingInput } from "@/components/water/ReadingChecks";
import { issueText, readingIssues } from "@/lib/water/checks";
import { getRound, lastBilledReadings, listMeters, listRoundReadings, previousReadings } from "@/lib/water/queries";
import { REMINDER_DAYS_BEFORE } from "@/lib/water/notifications";
import { METER_KIND, meterSpan } from "@/lib/water/settlement";
import { createSettlementAction, saveReadingsAction, sendReadingMessagesAction, setRoundStatusAction } from "../../actions";

export const metadata = { title: "Lukukierros" };

export default async function ReadingRoundPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; roundId: string }>;
  searchParams: Promise<{ virhe?: string; tallennettu?: string; viestit?: string; ilman?: string }>;
}) {
  const ctx = await requireStaff();
  const { id, roundId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(roundId)) notFound();
  const company = await loadCompany(ctx, id);
  const { virhe, tallennettu, viestit, ilman } = await searchParams;

  const data = await ctx.run(async (tx) => {
    const round = await getRound(tx, id, roundId);
    if (!round) return null;
    const [meters, readings, lastBilled, period, settings, previous] = await Promise.all([
      listMeters(tx, id),
      listRoundReadings(tx, roundId),
      lastBilledReadings(tx, id, round.settlement_run_id ?? undefined),
      defaultSettlementPeriod(tx, id, round.read_on),
      getBillingSettings(tx, id),
      previousReadings(tx, id, round.read_on),
    ]);
    return { round, meters, readings, lastBilled, period, settings, previous };
  });
  if (!data) notFound();
  const { round, meters, readings, lastBilled, period, settings, previous } = data;
  const canWrite = ctx.can("owner", "manager", "assistant", "accountant");
  const locked = Boolean(round.settlement_run_id);
  const editable = canWrite && !locked;

  const byMeter = new Map(readings.map((r) => [r.meter_id, r]));
  // Kierroksella näytetään mittarit, jotka olivat käytössä lukemapäivänä, ja vaihdetut, joiden loppulukemaa ei ole vielä laskutettu.
  const rows = meters
    .filter((m) => m.installed_on <= round.read_on)
    .filter((m) => !m.removed_on || !(lastBilled.get(m.id) && lastBilled.get(m.id)!.on >= m.removed_on))
    .map((m) => {
      const r = byMeter.get(m.id);
      const span = meterSpan(m, round.read_on, r ? { value: r.reading, on: r.read_on } : null, lastBilled.get(m.id) ?? null);
      const start = lastBilled.get(m.id) ?? {
        value: m.start_reading,
        on: m.installed_on,
      };
      return { m, r, span, start };
    });
  const activeCount = rows.filter((x) => !x.m.removed_on).length;
  const readCount = rows.filter((x) => !x.m.removed_on && x.r).length;
  const portalCount = readings.filter((r) => r.source === "portal").length;
  const nextMonth = addDays(`${round.read_on.slice(0, 7)}-01`, 45).slice(0, 7);
  const defaultDue = settings ? dueDateFor(`${nextMonth}-01`, settings.due_day) : "";
  const hidden = (
    <>
      <input type="hidden" name="company_id" value={id} />
      <input type="hidden" name="round_id" value={roundId} />
    </>
  );

  return (
    <>
      <CompanyHeader company={company} active="talous" sub={`Lukukierros ${formatDate(round.read_on)}`} />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-xl">Vesimittarien lukemat {formatDate(round.read_on)}</h2>
          {round.status === "open" ? <Badge tone="info">Auki</Badge> : <Badge tone="neutral">Suljettu</Badge>}
          {round.status === "open" && round.portal_open ? <Badge tone="ok">Portaali-ilmoitus käytössä</Badge> : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <LinkButton variant="ghost" href={`/taloyhtiot/${id}/talous/vesi`}>
            Takaisin vesilaskutukseen
          </LinkButton>
          {editable ? (
            <>
              <form action={setRoundStatusAction}>
                {hidden}
                <input type="hidden" name="portal_open" value={round.portal_open ? "false" : "true"} />
                <Button variant="ghost">{round.portal_open ? "Sulje portaali-ilmoitus" : "Avaa portaali-ilmoitus"}</Button>
              </form>
              <form action={setRoundStatusAction}>
                {hidden}
                <input type="hidden" name="status" value={round.status === "open" ? "closed" : "open"} />
                <Button variant="ghost">{round.status === "open" ? "Sulje kierros" : "Avaa kierros"}</Button>
              </form>
            </>
          ) : null}
        </div>
      </div>
      <FormError message={virhe} />
      {viestit !== undefined ? (
        <div className="mb-4">
          <Notice tone={Number(viestit) > 0 ? "ok" : "warn"}>
            {Number(viestit) > 0 ? `Viestejä lähetetty ${viestit}.` : "Vastaanottajia ei löytynyt."}
            {Number(ilman) > 0 ? ` ${ilman} henkilöltä puuttuu sähköpostiosoite.` : ""}
          </Notice>
        </div>
      ) : null}
      {tallennettu !== undefined ? (
        <div className="mb-4">
          <Notice tone="ok">{Number(tallennettu) > 0 ? `Tallennettu ${tallennettu} lukemaa.` : "Ei muutoksia."}</Notice>
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[2fr_1fr]">
        <Panel>
          <SectionTitle>
            Lukemat {readCount}/{activeCount}
            {portalCount > 0 ? <span className="ml-2 text-sm font-normal text-ink/60">({portalCount} portaalista)</span> : null}
          </SectionTitle>
          {rows.length === 0 ? (
            <p className="text-sm text-ink/65">Yhtiöllä ei ole mittareita tälle päivälle. Lisää mittarit vesilaskutuksen sivulla.</p>
          ) : (
            <form action={saveReadingsAction}>
              <ReadingChecks>
                {hidden}
                <Table>
                  <thead>
                    <tr>
                      <Th>Huoneisto</Th>
                      <Th>Mittari</Th>
                      <Th numeric>Vanha lukema</Th>
                      <Th numeric>Uusi lukema</Th>
                      <Th numeric>Kulutus m³</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(({ m, r, span, start }) => (
                      <tr key={m.id} className="align-top">
                        <Td className="font-semibold">{m.unit_label}</Td>
                        <Td>
                          <p>{METER_KIND[m.kind]}</p>
                          <p className="text-xs text-ink/55">{m.meter_number ? `nro ${m.meter_number}` : ""}</p>
                        </Td>
                        <Td numeric>
                          {trimDecimal(start.value)}
                          <p className="text-xs text-ink/55">{formatDate(start.on)}</p>
                        </Td>
                        <Td numeric>
                          {m.removed_on ? (
                            <>
                              {trimDecimal(m.final_reading)}
                              <p className="text-xs text-ink/55">vaihdettu {formatDate(m.removed_on)}</p>
                            </>
                          ) : (
                            <>
                              <input type="hidden" name={`original_${m.id}`} value={r ? trimDecimal(r.reading) : ""} />
                              <ReadingInput
                                meterId={m.id}
                                previous={previous.get(m.id)?.value ?? null}
                                name={`reading_${m.id}`}
                                aria-label={`${m.unit_label} ${METER_KIND[m.kind].toLowerCase()} uusi lukema`}
                                inputMode="decimal"
                                defaultValue={r ? trimDecimal(r.reading) : ""}
                                disabled={!editable}
                                className="ml-auto w-28 text-right"
                              />
                              {r ? (
                                <p className="mt-1 text-xs text-ink/55" title={formatDateTime(r.updated_at)}>
                                  {r.source === "portal" ? "portaalista" : "kirjattu"}
                                  {r.entered_by_name ? `, ${r.entered_by_name}` : ""}
                                </p>
                              ) : null}
                              {r && previous.get(m.id) && readingIssues(previous.get(m.id)!.value, r.reading).length > 0 ? (
                                <p className="mt-1 max-w-xs text-left text-xs text-coral">
                                  {issueText(readingIssues(previous.get(m.id)!.value, r.reading)[0], trimDecimal(previous.get(m.id)!.value), r.reading)}
                                </p>
                              ) : null}
                            </>
                          )}
                        </Td>
                        <Td numeric>
                          {span.ok ? (
                            trimDecimal(span.consumption)
                          ) : span.reason === "negative" ? (
                            <span className="text-coral">
                              {trimDecimal(scaledToDecimal(parseScaled(span.end!.value, 3) - parseScaled(span.start!.value, 3), 3))}
                            </span>
                          ) : (
                            <span className="text-ink/40">–</span>
                          )}
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
                {editable ? (
                  <div className="mt-4 grid gap-3">
                    <ReadingConfirm />
                    <div className="flex flex-wrap items-center gap-3">
                      <Button>Tallenna lukemat</Button>
                      <p className="text-xs text-ink/55">Tyhjennetty kenttä poistaa lukeman. Kirjaamasi lukema korvaa osakkaan portaalissa ilmoittaman.</p>
                    </div>
                  </div>
                ) : null}
              </ReadingChecks>
            </form>
          )}
        </Panel>

        <div className="grid content-start gap-6">
          <Panel>
            <SectionTitle>Lukupyyntö asukkaille</SectionTitle>
            <DefinitionList
              items={[
                { label: "Ilmoitettava viimeistään", value: formatDate(round.report_by) },
                {
                  label: "Lukupyyntö",
                  value: round.notified_at
                    ? `${formatDateTime(round.notified_at)}, ${round.notified_count ?? 0} viestiä`
                    : round.portal_open
                      ? `Lähtee automaattisesti ${formatDate(round.read_on)}`
                      : "Ei lähetetä (portaali-ilmoitus suljettu)",
                },
                {
                  label: "Muistutus puuttuville",
                  value: round.reminded_at
                    ? `${formatDateTime(round.reminded_at)}, ${round.reminded_count ?? 0} viestiä`
                    : round.portal_open
                      ? `Lähtee automaattisesti ${formatDate(addDays(round.report_by, -REMINDER_DAYS_BEFORE))}`
                      : "–",
                },
              ]}
            />
            <p className="mt-3 text-xs text-ink/55">Viesti menee huoneiston asukkaille, tai osakkaille, jos asukkaita ei ole kirjattu. Linkki vie portaalin lukemalomakkeeseen.</p>
            {editable && round.status === "open" ? (
              <div className="mt-3 flex flex-wrap gap-2">
                <form action={sendReadingMessagesAction}>
                  {hidden}
                  <input type="hidden" name="kind" value="request" />
                  <Button variant="secondary">{round.notified_at ? "Lähetä pyyntö uudelleen" : "Lähetä pyyntö nyt"}</Button>
                </form>
                {readCount < activeCount ? (
                  <form action={sendReadingMessagesAction}>
                    {hidden}
                    <input type="hidden" name="kind" value="reminder" />
                    <Button variant="ghost">Muistuta puuttuvia ({activeCount - readCount} mittaria)</Button>
                  </form>
                ) : null}
              </div>
            ) : null}
          </Panel>
          <Panel>
            <SectionTitle>Tasauslasku</SectionTitle>
            {locked ? (
              <div className="grid gap-3 text-sm">
                <p>
                  Kierroksesta on tehty tasauslaskutus:{" "}
                  <Badge tone={RUN_STATUS[round.settlement_status ?? "draft"]?.tone ?? "neutral"}>
                    {RUN_STATUS[round.settlement_status ?? "draft"]?.label}
                  </Badge>
                </p>
                <div>
                  <LinkButton variant="secondary" href={`/taloyhtiot/${id}/talous/ajot/${round.settlement_run_id}`}>
                    Avaa laskutusajo
                  </LinkButton>
                </div>
                <p className="text-xs text-ink/55">Lukemia voi muuttaa vasta, kun laskutusajo on peruttu.</p>
              </div>
            ) : canWrite ? (
              <form action={createSettlementAction} className="grid gap-3">
                {hidden}
                <p className="text-sm text-ink/65">
                  Laskulle tulee mittareittain vanha ja uusi lukema, kulutus ja hinta sekä kauden vesiennakot miinusrivinä. Ajo tulee luonnokseksi
                  laskutusajoihin.
                </p>
                {readCount < activeCount ? (
                  <Notice tone="warn">{activeCount - readCount} mittarilta puuttuu lukema. Niitä ei laskuteta tällä kierroksella.</Notice>
                ) : null}
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Ennakkokausi alkaa" htmlFor="period_start">
                    <Input id="period_start" name="period_start" type="date" defaultValue={period.start} required />
                  </Field>
                  <Field label="päättyy" htmlFor="period_end">
                    <Input id="period_end" name="period_end" type="date" defaultValue={period.end} required />
                  </Field>
                </div>
                <Field label="Eräpäivä" htmlFor="due_on">
                  <Input id="due_on" name="due_on" type="date" defaultValue={defaultDue} />
                </Field>
                <div>
                  <Button disabled={!settings}>Luo tasauslasku</Button>
                </div>
                {!settings ? <p className="text-xs text-coral">Tallenna ensin yhtiön laskutusasetukset.</p> : null}
              </form>
            ) : (
              <p className="text-sm text-ink/65">Tasauslaskua ei ole tehty.</p>
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}
