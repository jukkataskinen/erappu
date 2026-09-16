import Link from "next/link";
import { CompanyHeader, loadCompany } from "@/components/CompanyHeader";
import { FormError } from "@/components/FormError";
import { ResponsibilityChart } from "@/components/responsibility/ResponsibilityChart";
import { Badge, Button, Field, Input, Notice, Panel, SectionTitle, Select, Table, Td, Textarea, Th } from "@/components/ui";
import { requireStaff } from "@/lib/auth/current-user";
import { formatDate, formatDateTime } from "@/lib/format";
import { DUTY_NOTES, findItem, GENERAL_DISCLAIMER, ITEMS, LEGAL_SOURCES, RESPONSIBILITIES, RESPONSIBILITY_CONTENT_APPROVED, RESPONSIBILITY_LABEL, ROOMS, URGENT_REPAIR_NOTES } from "@/lib/responsibility/content";
import { EXCEPTION_BASES, EXCEPTION_BASIS_LABEL, mergeExceptions, orphanExceptions } from "@/lib/responsibility/merge";
import { listExceptions } from "@/lib/responsibility/queries";
import { deleteResponsibilityException, saveResponsibilityException } from "./actions";

export const metadata = { title: "Vastuunjako" };

const MESSAGES: Record<string, string> = {
  tallennettu: "Poikkeus tallennettiin. Se näkyy myös yhtiön osakkaille ja asukkaille portaalissa.",
  poistettu: "Poikkeus poistettiin. Kohteessa näytetään taas yleinen tulkinta.",
};

export default async function ResponsibilityPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ virhe?: string; tila?: string; muokkaa?: string }>;
}) {
  const ctx = await requireStaff();
  const { id } = await params;
  const sp = await searchParams;
  const company = await loadCompany(ctx, id);
  const exceptions = await ctx.run((tx) => listExceptions(tx, id));
  const items = mergeExceptions(exceptions);
  const orphans = orphanExceptions(exceptions);
  const canWrite = ctx.can("owner", "manager", "assistant");
  const editing = sp.muokkaa ? exceptions.find((e) => e.item_key === sp.muokkaa) : undefined;
  const editingItem = sp.muokkaa ? findItem(sp.muokkaa) : undefined;

  return (
    <>
      <CompanyHeader company={company} active="vastuunjako" />
      <FormError message={sp.virhe} />
      <div className="grid gap-6">
        {sp.tila && MESSAGES[sp.tila] ? <Notice tone="ok" title={MESSAGES[sp.tila]} /> : null}
        {!RESPONSIBILITY_CONTENT_APPROVED ? (
          <Notice tone="warn" title="Tulkinnat odottavat tarkistusta">
            Kohteiden tekstit on kirjoitettu asunto-osakeyhtiölain 4 luvun pohjalta, mutta niitä ei ole vielä tarkistettu isännöinnissä. Portaalissa taulukko näkyy jo osakkaille.
          </Notice>
        ) : null}
        <Notice tone="info" title="Yleinen tulkinta, yhtiöjärjestys voi poiketa">
          {GENERAL_DISCLAIMER} Sama taulukko näkyy osakkaille ja asukkaille portaalissa ja huoltopyyntölomakkeen linkistä.
        </Notice>

        <Panel>
          <SectionTitle>Vastuunjakotaulukko</SectionTitle>
          <ResponsibilityChart items={items} />
        </Panel>

        <Panel id="poikkeukset">
          <SectionTitle actions={exceptions.length > 0 ? <Badge tone="warn">{exceptions.length} kpl</Badge> : null}>Yhtiökohtaiset poikkeukset</SectionTitle>
          <p className="mb-4 text-sm text-ink/70">
            Kirjaa poikkeus, kun yhtiöjärjestys määrää vastuusta toisin tai yhtiökokous on päättänyt teettää osakkaalle kuuluvan työn yhtiön kustannuksella (AOYL 4:1 §). Poikkeus näkyy taulukossa korostettuna perusteluineen.
          </p>

          {orphans.length > 0 ? (
            <div className="mb-4">
              <Notice tone="warn" title="Osa poikkeuksista viittaa kohteisiin, joita taulukossa ei enää ole">
                Ne eivät näy taulukossa. Tarkista ja poista: {orphans.map((o) => o.item_key).join(", ")}.
              </Notice>
            </div>
          ) : null}

          {exceptions.length === 0 ? (
            <p className="text-sm text-ink/60">Yhtiölle ei ole kirjattu poikkeuksia. Taulukko näyttää lain mukaisen yleisen jaon.</p>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Kohde</Th>
                  <Th>Yleinen</Th>
                  <Th>Tässä yhtiössä</Th>
                  <Th>Peruste</Th>
                  <Th>Muokattu</Th>
                  {canWrite ? <Th /> : null}
                </tr>
              </thead>
              <tbody>
                {exceptions.map((e) => {
                  const item = findItem(e.item_key);
                  return (
                    <tr key={e.id}>
                      <Td>
                        <span className="font-semibold">{item?.label ?? e.item_key}</span>
                        {item ? <span className="block text-xs text-ink/55">{ROOMS.find((r) => r.key === item.room)?.label}</span> : null}
                        <span className="mt-1 block max-w-md whitespace-pre-line text-sm text-ink/70">{e.note}</span>
                      </Td>
                      <Td>{item ? RESPONSIBILITY_LABEL[item.responsibility] : "–"}</Td>
                      <Td>
                        <Badge tone="warn">{RESPONSIBILITY_LABEL[e.responsibility]}</Badge>
                      </Td>
                      <Td>
                        {EXCEPTION_BASIS_LABEL[e.basis]}
                        {e.decided_on ? <span className="block text-xs text-ink/55">{formatDate(e.decided_on)}</span> : null}
                      </Td>
                      <Td>
                        <span className="text-sm">{formatDateTime(e.updated_at)}</span>
                        {e.updated_by_name ? <span className="block text-xs text-ink/55">{e.updated_by_name}</span> : null}
                      </Td>
                      {canWrite ? (
                        <Td>
                          <div className="flex flex-wrap items-center gap-2">
                            {item ? (
                              <Link href={`?muokkaa=${e.item_key}#poikkeuslomake`} className="text-sm font-semibold text-sky hover:underline">
                                Muokkaa
                              </Link>
                            ) : null}
                            <form action={deleteResponsibilityException}>
                              <input type="hidden" name="company_id" value={id} />
                              <input type="hidden" name="item_key" value={e.item_key} />
                              <Button variant="ghost" className="px-2 text-sm">
                                Poista
                              </Button>
                            </form>
                          </div>
                        </Td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          )}

          {canWrite ? (
            <form id="poikkeuslomake" action={saveResponsibilityException} className="mt-6 grid gap-4 border-t border-line pt-5">
              <h3 className="text-base">{editing ? "Muokkaa poikkeusta" : "Lisää poikkeus"}</h3>
              <input type="hidden" name="company_id" value={id} />
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Kohde" htmlFor="item_key" hint={editingItem ? `Yleinen tulkinta: ${RESPONSIBILITY_LABEL[editingItem.responsibility]} (${editingItem.law})` : "Jos kohteella on jo poikkeus, tallennus korvaa sen."}>
                  <Select id="item_key" name="item_key" required defaultValue={editingItem?.key ?? ""}>
                    <option value="" disabled>
                      Valitse kohde
                    </option>
                    {ROOMS.map((room) => (
                      <optgroup key={room.key} label={room.label}>
                        {ITEMS.filter((i) => i.room === room.key).map((i) => (
                          <option key={i.key} value={i.key}>
                            {i.label} (yleinen: {RESPONSIBILITY_LABEL[i.responsibility].toLowerCase()})
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </Select>
                </Field>
                <Field label="Vastuu tässä yhtiössä" htmlFor="responsibility">
                  <Select id="responsibility" name="responsibility" required defaultValue={editing?.responsibility ?? ""}>
                    <option value="" disabled>
                      Valitse
                    </option>
                    {RESPONSIBILITIES.map((r) => (
                      <option key={r} value={r}>
                        {RESPONSIBILITY_LABEL[r]}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Peruste" htmlFor="basis">
                  <Select id="basis" name="basis" required defaultValue={editing?.basis ?? "articles"}>
                    {EXCEPTION_BASES.map((b) => (
                      <option key={b} value={b}>
                        {EXCEPTION_BASIS_LABEL[b]}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Päätös- tai voimaantulopäivä" htmlFor="decided_on" hint="Vapaaehtoinen. Esimerkiksi yhtiökokouksen tai yhtiöjärjestyksen muutoksen rekisteröinnin päivä.">
                  <Input id="decided_on" name="decided_on" type="date" defaultValue={editing?.decided_on ?? ""} />
                </Field>
              </div>
              <Field label="Perustelu osakkaille" htmlFor="note" hint="Näkyy portaalissa. Kerro yhtiöjärjestyksen kohta tai päätöksen sisältö lyhyesti.">
                <Textarea id="note" name="note" required maxLength={1000} rows={3} defaultValue={editing?.note ?? ""} placeholder="Esim. Yhtiöjärjestyksen 4 §: osakas vastaa huoneistonsa parvekelasien kunnossapidosta." />
              </Field>
              <div className="flex flex-wrap gap-2">
                <Button type="submit">Tallenna poikkeus</Button>
                {editing ? (
                  <Link href="?#poikkeukset" className="inline-flex min-h-[var(--size-touch)] items-center px-3 text-sm font-semibold text-ink/70 hover:text-ink">
                    Peruuta
                  </Link>
                ) : null}
              </div>
            </form>
          ) : (
            <p className="mt-4 text-sm text-ink/60">Poikkeuksia voivat muokata pääkäyttäjä, isännöitsijä ja avustaja.</p>
          )}
        </Panel>

        <Panel>
          <SectionTitle>Ilmoitusvelvollisuudet ja lähteet</SectionTitle>
          <ul className="grid list-disc gap-1.5 pl-5 text-sm text-ink/80">
            {DUTY_NOTES.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
          <h3 className="mt-5 text-base font-semibold">Kiireellinen vika tai viivästynyt korjaus</h3>
          <ul className="mt-2 grid list-disc gap-1.5 pl-5 text-sm text-ink/80">
            {URGENT_REPAIR_NOTES.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
          <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-ink/50">Lähteet</p>
          <ul className="mt-1 grid gap-1 text-sm text-ink/70">
            {LEGAL_SOURCES.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </Panel>
      </div>
    </>
  );
}
