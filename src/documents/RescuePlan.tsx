/** @jsxRuntime automatic */
/** @jsxImportSource react */
/**
 * Taloyhtiön pelastussuunnitelma (pelastuslaki 379/2011 15 §, VNa 407/2011 2 §).
 * Osiot ja vakiotekstit: `src/lib/rescue-plans/content.ts`. Kunnes
 * `RESCUE_PLAN_TEMPLATE_APPROVED` on tosi, asiakirjassa on luonnosmerkintä.
 */

import { Page, Text, View } from "@react-pdf/renderer";
import { Children, type ReactNode } from "react";
import {
  civilDefenceText,
  EMERGENCY_INSTRUCTIONS,
  PLAN_SECTIONS,
  RISK_LEVEL_LABEL,
  sectionNumber,
  SHELTER_LABEL,
  type PlanSectionKey,
  type RescuePlanContent,
} from "@/lib/rescue-plans/content";
import { DataTable, DocumentFooter, DocumentHeader, DocumentRoot, DraftBanner, KeyValues, Muted, Panel, Paragraph, pageStyle, type KeyValue } from "./components";
import { PageDecoration } from "./decorations";
import { formatDate, orDash } from "./format";
import { colors, spacing, type as typeScale, weight } from "./theme";

export interface RescuePlanAttachment {
  number: number;
  title: string;
  pages: number | null;
  status: "attached" | "failed";
  reason?: string;
}

export interface RescuePlanData {
  /** Vakiotekstit hyväksytty (RESCUE_PLAN_TEMPLATE_APPROVED). */
  approved: boolean;
  /** Luonnoksen esikatselu vai valmis versio. */
  status: "draft" | "final";
  organizationName: string;
  businessId: string | null;
  version: number;
  preparedOn: string | null;
  nextReviewOn: string | null;
  /** Asiakirjan päiväys VVVV-KK-PP (determinismi, ks. render.ts). */
  issuedOn: string;
  legalBasis: string;
  content: RescuePlanContent;
  attachments: RescuePlanAttachment[];
}

/** Toimintaohjeliite on aina liite 1; dokumenttiliitteet numeroidaan sen jälkeen. */
export const EMERGENCY_SHEET_NUMBER = 1;

const has = (v: string | null | undefined) => Boolean(v && v.trim());

/** Tyhjät valinnaiset rivit jätetään pois, pakolliset näytetään viivalla. */
function kv(items: (KeyValue & { optional?: boolean })[]): KeyValue[] {
  return items.filter((i) => !i.optional || has(i.value)).map((i) => ({ label: i.label, value: orDash(i.value) }));
}

function Section({ id, children }: { id: PlanSectionKey; children: ReactNode }) {
  const title = PLAN_SECTIONS.find((s) => s.key === id)!.title;
  // Otsikko ja ensimmäinen lohko samaan jakamattomaan näkymään: minPresenceAhead
  // ei estänyt otsikon jäämistä yksin sivun alalaitaan.
  const [first, ...rest] = Children.toArray(children);
  return (
    <View style={{ marginTop: spacing.block + 4 }}>
      <View wrap={false}>
        <View style={{ flexDirection: "row", alignItems: "baseline", borderBottomWidth: 1, borderBottomColor: colors.line, paddingBottom: 3 }}>
          <Text style={{ fontSize: typeScale.heading + 1, fontWeight: weight.bold, color: colors.sky, width: 22 }}>{sectionNumber(id)}</Text>
          <Text style={{ fontSize: typeScale.heading + 1, fontWeight: weight.bold }}>{title}</Text>
        </View>
        {first}
      </View>
      {rest}
    </View>
  );
}

function SubHeading({ children }: { children: ReactNode }) {
  return (
    <Text style={{ fontSize: typeScale.body, fontWeight: weight.bold, marginTop: 10 }} minPresenceAhead={30}>
      {children}
    </Text>
  );
}

/** Monirivinen vapaa teksti kappaleiksi. */
function TextBlock({ value, empty }: { value: string; empty?: string }) {
  const paragraphs = value.split(/\n\s*\n|\r?\n/).map((p) => p.trim()).filter(Boolean);
  if (paragraphs.length === 0) return empty ? <Muted style={{ marginTop: 4 }}>{empty}</Muted> : null;
  return (
    <>
      {paragraphs.map((p, i) => (
        <Paragraph key={i}>{p}</Paragraph>
      ))}
    </>
  );
}

function Steps({ steps }: { steps: string[] }) {
  return (
    <View style={{ marginTop: 3 }}>
      {steps.map((step, i) => (
        <View key={i} style={{ flexDirection: "row", marginTop: 2 }} wrap={false}>
          <Text style={{ width: 16, color: colors.inkSoft }}>{i + 1}.</Text>
          <Text style={{ flex: 1 }}>{step}</Text>
        </View>
      ))}
    </View>
  );
}

export function riskConclusionText(content: RescuePlanContent): string {
  if (has(content.riskConclusions)) return content.riskConclusions;
  const selected = content.hazards.filter((h) => h.selected);
  if (selected.length === 0) return "Riskejä ei ole arvioitu.";
  const max = Math.max(...selected.map((h) => h.level));
  const top = selected.filter((h) => h.level === max).map((h) => h.title.toLocaleLowerCase("fi"));
  return `Arvioiduista ${selected.length} vaaratilanteesta suurimmaksi riskiksi (taso ${max}, ${RISK_LEVEL_LABEL[max]}) arvioitiin ${top.join(", ")}. Riskejä pienennetään kohdissa 4 ja 5 kuvatuilla toimenpiteillä, ja asukkaiden toimintaohjeet ovat kohdassa 6.`;
}

export function RescuePlan({ data }: { data: RescuePlanData }) {
  const c = data.content;
  const draftText = data.status === "draft" ? "LUONNOS – ei vielä voimassa" : !data.approved ? "LUONNOS – vakiotekstit tarkistettava" : null;
  const hazards = c.hazards.filter((h) => h.selected);
  const contacts: Record<string, string>[] = [
    { role: "Isännöitsijä", name: orDash(c.managerName), phone: orDash(c.managerPhone), email: c.managerEmail },
    { role: "Hallituksen puheenjohtaja", name: orDash(c.chairName), phone: orDash(c.chairPhone), email: "" },
    { role: "Kiinteistöhuolto", name: orDash(c.maintenanceName), phone: orDash(c.maintenancePhone), email: "" },
    ...(has(c.maintenanceEmergencyPhone) ? [{ role: "Huollon päivystys", name: orDash(c.maintenanceName), phone: c.maintenanceEmergencyPhone, email: "" }] : []),
  ];
  const evacuation = EMERGENCY_INSTRUCTIONS.map((i) =>
    i.key === "evacuation" && has(c.assemblyPoint)
      ? { ...i, steps: i.steps.map((s, n) => (n === 1 ? `Kokoonnu kokoontumispaikalle: ${c.assemblyPoint}${has(c.assemblyPointAlt) ? ` (varapaikka: ${c.assemblyPointAlt})` : ""}. Selvitä, puuttuuko joku.` : s)) }
      : i,
  );

  return (
    <DocumentRoot title="Pelastussuunnitelma" subject={c.companyName} date={data.issuedOn}>
      <Page size="A4" style={pageStyle}>
        <PageDecoration />
        <DocumentHeader right={[c.companyName, data.businessId].filter(Boolean).join(" · ")} />
        {draftText ? <DraftBanner text={draftText} /> : null}

        <Text style={{ fontSize: typeScale.title, fontWeight: weight.bold, lineHeight: 1.2 }}>Pelastussuunnitelma</Text>
        <Text style={{ fontSize: typeScale.subtitle, color: colors.inkSoft, marginTop: 4 }}>{[c.companyName, c.address].filter(has).join(", ")}</Text>

        <KeyValues
          columns={3}
          items={[
            { label: "Versio", value: String(data.version) },
            { label: "Laadittu", value: data.preparedOn ? formatDate(data.preparedOn) : "–" },
            { label: "Seuraava tarkistus", value: data.nextReviewOn ? formatDate(data.nextReviewOn) : "–" },
          ]}
        />

        <View style={{ marginTop: 10, borderWidth: 1.5, borderColor: colors.coral, borderRadius: 8, padding: 10 }} wrap={false}>
          <Text style={{ fontSize: typeScale.heading + 2, fontWeight: weight.bold }}>Hätänumero 112</Text>
          <Text style={{ marginTop: 3 }}>
            Osoite hätäilmoitukseen: {orDash(c.address)}
            {has(c.assemblyPoint) ? `  ·  Kokoontumispaikka: ${c.assemblyPoint}` : ""}
          </Text>
        </View>

        <Section id="plan">
          <KeyValues
            items={kv([
              { label: "Laatija", value: c.preparedBy },
              { label: "Hallitus hyväksynyt", value: has(c.boardApprovedOn) ? formatDate(c.boardApprovedOn) : "", optional: true },
            ])}
          />
          <TextBlock value={c.preparationNote} />
          <Muted style={{ marginTop: 6 }}>Säädösperusta: {data.legalBasis}</Muted>
          <Muted style={{ marginTop: 2 }}>
            Asuinrakennukseen, jossa on vähintään kolme asuinhuoneistoa, on laadittava pelastussuunnitelma. Suunnitelmasta vastaa taloyhtiön hallitus.
          </Muted>
        </Section>

        <Section id="property">
          <KeyValues
            items={kv([
              { label: "Taloyhtiö", value: c.companyName },
              { label: "Osoite", value: c.address },
              { label: "Kiinteistötunnus", value: c.propertyCodes },
              { label: "Asuinhuoneistot", value: c.apartments },
              { label: "Asukkaita", value: c.residentsEstimate },
              { label: "Liike- ja toimitilat", value: c.commercialUnits, optional: true },
              { label: "Lämmitys", value: c.heating },
              { label: "Tulisijat", value: c.fireplaces, optional: true },
              { label: "Yhteiset tilat", value: c.commonSpaces, optional: true },
              { label: "Varastot", value: c.storages, optional: true },
              { label: "Autopaikat", value: c.parking, optional: true },
              { label: "Avainjärjestelmä", value: c.keySystem, optional: true },
            ])}
          />
          {c.buildings.length > 0 ? (
            <View wrap={c.buildings.length > 8}>
            <DataTable
              columns={[
                { key: "label", label: "Rakennus", flex: 0.8 },
                { key: "type", label: "Tyyppi", flex: 1.1 },
                { key: "year", label: "Valmistunut", flex: 0.9 },
                { key: "floors", label: "Kerroksia", flex: 0.7 },
                { key: "material", label: "Rakenteet", flex: 1.6 },
                { key: "ventilation", label: "Ilmanvaihto", flex: 1.4 },
              ]}
              rows={c.buildings.map((b) => ({ label: orDash(b.label), type: orDash(b.type), year: orDash(b.completedYear), floors: orDash(b.floors), material: orDash(b.material), ventilation: orDash(b.ventilation) }))}
            />
            </View>
          ) : null}
          <SubHeading>Vaaralliset aineet</SubHeading>
          <TextBlock value={c.hazardousMaterials} empty="Ei kirjattu." />
          {has(c.unusualUse) ? (
            <>
              <SubHeading>Tavanomaisesta poikkeava tai tilapäinen käyttö</SubHeading>
              <TextBlock value={c.unusualUse} />
            </>
          ) : null}
        </Section>

        <Section id="contacts">
          <DataTable
            columns={[
              { key: "role", label: "Tehtävä", flex: 1.3 },
              { key: "name", label: "Nimi", flex: 1.5 },
              { key: "phone", label: "Puhelin", flex: 1.1 },
              { key: "email", label: "Sähköposti", flex: 1.6 },
            ]}
            rows={contacts}
          />
          <SubHeading>Turvallisuushenkilöt</SubHeading>
          <TextBlock value={c.safetyPersons} empty="Hallitus vastaa turvallisuusasioista. Erillisiä turvallisuushenkilöitä ei ole nimetty." />
          <SubHeading>Tärkeät numerot</SubHeading>
          <Paragraph>Hätänumero 112 · Myrkytystietokeskus 0800 147 111</Paragraph>
          <TextBlock value={c.otherContacts} />
        </Section>

        <Section id="hazards">
          <Paragraph>{riskConclusionText(c)}</Paragraph>
          <Muted style={{ marginTop: 4 }}>Riskitaso: 1 lievä, 2 vähäinen, 3 kohtalainen, 4 merkittävä, 5 sietämätön.</Muted>
          {hazards.length === 0 ? <Muted style={{ marginTop: 6 }}>Ei arvioituja vaaratilanteita.</Muted> : null}
          {hazards.map((h) => (
            <Panel key={h.key} style={{ marginTop: 7 }} wrap={false}>
              <View style={{ flexDirection: "row", justifyContent: "space-between" }} wrap={false}>
                <Text style={{ fontWeight: weight.bold, flex: 1 }}>{h.title}</Text>
                <Text style={{ fontSize: typeScale.small, color: colors.inkSoft }}>
                  Riskitaso {h.level} ({RISK_LEVEL_LABEL[h.level]})
                </Text>
              </View>
              {has(h.consequence) ? (
                <Text style={{ fontSize: typeScale.small, color: colors.inkSoft, marginTop: 2 }}>Seuraus: {h.consequence}</Text>
              ) : null}
              {has(h.prevention) ? <Text style={{ marginTop: 3 }}>{h.prevention}</Text> : null}
            </Panel>
          ))}
        </Section>

        <Section id="safety">
          <KeyValues
            columns={1}
            items={kv([
              { label: "Palovaroittimet", value: c.smokeAlarms },
              { label: "Alkusammutusvälineet ja sijainnit", value: c.extinguishers },
              { label: "Poistumistiet", value: c.escapeRoutes },
              { label: "Kokoontumispaikka", value: c.assemblyPoint },
              { label: "Varakokoontumispaikka", value: c.assemblyPointAlt, optional: true },
              { label: "Pelastustie", value: c.rescueRoad },
            ])}
          />
          <SubHeading>Pääsulut ja -kytkimet</SubHeading>
          <DataTable
            columns={[
              { key: "what", label: "Sulku", flex: 1 },
              { key: "where", label: "Sijainti ja käyttö", flex: 3 },
            ]}
            rows={[
              { what: "Vesi", where: orDash(c.shutoffWater) },
              { what: "Sähkö (pääkytkin)", where: orDash(c.shutoffElectricity) },
              { what: "Ilmanvaihto", where: orDash(c.shutoffVentilation) },
              { what: "Lämmitys", where: orDash(c.shutoffHeating) },
            ]}
          />
          <SubHeading>Tilojen järjestys ja varastointi</SubHeading>
          <TextBlock value={c.storageRules} empty="Ei kirjattu." />
          <SubHeading>Tulityöt</SubHeading>
          <TextBlock value={c.hotWork} empty="Ei kirjattu." />
          <SubHeading>Huollot ja tarkastukset</SubHeading>
          <TextBlock value={c.inspections} empty="Ei kirjattu." />
        </Section>

        <Section id="instructions">
          {evacuation.map((i) => (
            <View key={i.key} wrap={false}>
              <SubHeading>{i.title}</SubHeading>
              <Steps steps={i.steps} />
            </View>
          ))}
          {has(c.extraInstructions) ? (
            <>
              <SubHeading>Yhtiön omat ohjeet</SubHeading>
              <TextBlock value={c.extraInstructions} />
            </>
          ) : null}
        </Section>

        <Section id="civil_defence">
          <KeyValues
            items={kv([
              { label: "Väestönsuoja", value: SHELTER_LABEL[c.shelter] },
              { label: "Sijainti", value: c.shelterLocation, optional: c.shelter === "none" },
              { label: "Suojapaikkoja", value: c.shelterCapacity, optional: true },
              { label: "Vastuuhenkilö", value: c.shelterResponsible, optional: c.shelter === "none" },
            ])}
          />
          {civilDefenceText(c.shelter).map((p, i) => (
            <Paragraph key={i}>{p}</Paragraph>
          ))}
          <TextBlock value={c.shelterNotes} />
        </Section>

        <Section id="communication">
          <SubHeading>Tiedottaminen</SubHeading>
          <TextBlock value={c.communication} empty="Ei kirjattu." />
          <SubHeading>Koulutus ja harjoittelu</SubHeading>
          <TextBlock value={c.training} empty="Ei kirjattu." />
        </Section>

        <Section id="maintenance">
          <KeyValues
            columns={3}
            items={[
              { label: "Versio", value: String(data.version) },
              { label: "Laadittu", value: data.preparedOn ? formatDate(data.preparedOn) : "–" },
              { label: "Seuraava tarkistus", value: data.nextReviewOn ? formatDate(data.nextReviewOn) : "–" },
            ]}
          />
          <TextBlock value={c.updateProcedure} empty="Hallitus tarkistaa suunnitelman vuosittain." />
          <Muted style={{ marginTop: 6 }}>
            Suunnitelma pidetään ajan tasalla, ja siitä tiedotetaan asukkaille. Suunnitelma toimitetaan pelastusviranomaiselle pyynnöstä.
          </Muted>
        </Section>

        <Section id="attachments">
          {data.attachments.length === 0 && !has(c.attachmentNotes) ? <Muted style={{ marginTop: 4 }}>Ei liitteitä.</Muted> : null}
          {data.attachments.map((a) => (
            <Text key={a.number} style={{ marginTop: 3 }}>
              Liite {a.number}: {a.title}
              {a.status === "attached" ? (a.pages ? ` (${a.pages} s.)` : "") : ` – ei voitu liittää${a.reason ? `: ${a.reason}` : ""}`}
            </Text>
          ))}
          <TextBlock value={c.attachmentNotes} />
        </Section>

        <DocumentFooter left={`${data.organizationName} · ${c.companyName} · pelastussuunnitelma v${data.version}`} />
      </Page>
      {/* Liite 1 on aina mukana: ilmoitustaululle tulostettava toimintaohje. */}
      <EmergencySheet data={data} number={EMERGENCY_SHEET_NUMBER} />
    </DocumentRoot>
  );
}

/**
 * Liite: Toimintaohjeet hälytystilanteissa. Yksi sivu, joka tulostetaan myös
 * porrashuoneen ilmoitustaululle. Sisältö on sama kuin osiossa 6, mutta
 * tiivistettynä ja yhtiön omilla tiedoilla (osoite, kokoontumispaikka, numerot).
 */
const SHEET_ORDER = ["fire", "fire_blocked", "water", "power", "first_aid", "shelter_in", "evacuation"];

function SheetCard({ title, steps }: { title: string; steps: string[] }) {
  return (
    // Kortti saa jakautua sivuvaihdossa: muuten pitkä kortti jättäisi puolen sivun tyhjäksi.
    <View style={{ width: "50%", paddingRight: 12, marginTop: 8 }}>
      <Text style={{ fontSize: typeScale.body, fontWeight: weight.bold }} minPresenceAhead={26}>{title}</Text>
      {steps.map((s, i) => (
        <View key={i} style={{ flexDirection: "row", marginTop: 1.5 }}>
          <Text style={{ width: 10, color: colors.sky }}>·</Text>
          <Text style={{ flex: 1, fontSize: typeScale.small }}>{s}</Text>
        </View>
      ))}
    </View>
  );
}

export function EmergencySheet({ data, number }: { data: RescuePlanData; number: number }) {
  const c = data.content;
  const cards = SHEET_ORDER.map((key) => EMERGENCY_INSTRUCTIONS.find((i) => i.key === key)).filter((i): i is (typeof EMERGENCY_INSTRUCTIONS)[number] => Boolean(i));
  const call = EMERGENCY_INSTRUCTIONS.find((i) => i.key === "emergency_call");
  const numbers: KeyValue[] = kv([
    { label: "Hätänumero", value: "112" },
    { label: "Myrkytystietokeskus", value: "0800 147 111" },
    // Ilman numeroa rivi jätetään pois: Toivakan yhtiöissä kiinteistönhuolto on talkoita (Jukka 22.9.2026).
    { label: has(c.maintenanceName) ? c.maintenanceName : "Kiinteistöhuolto", value: c.maintenanceEmergencyPhone || c.maintenancePhone, optional: true },
    { label: has(c.managerName) ? `Isännöitsijä ${c.managerName}` : "Isännöitsijä", value: c.managerPhone },
    { label: "Vesisulku", value: c.shutoffWater, optional: true },
    { label: "Sähköpääkeskus", value: c.shutoffElectricity, optional: true },
  ]);

  return (
    <Page size="A4" style={pageStyle}>
      <PageDecoration />
      <DocumentHeader right={`Liite ${number} · pelastussuunnitelma`} />
      {data.approved ? null : <DraftBanner text="LUONNOS – vakiotekstit tarkistettava" />}
      <Text style={{ fontSize: typeScale.title, fontWeight: weight.bold, lineHeight: 1.25 }}>Toimintaohjeet hälytystilanteissa</Text>
      <Muted style={{ marginTop: 2 }}>
        {c.companyName}
        {has(c.address) ? ` · ${c.address}` : ""}
      </Muted>

      <Panel style={{ marginTop: 8, paddingVertical: 8, flexDirection: "row", alignItems: "center" }} wrap={false}>
        <Text style={{ fontSize: 30, fontWeight: weight.bold, color: colors.sky, width: 70 }}>112</Text>
        <View style={{ flex: 1 }}>
          <Text style={{ fontWeight: weight.bold }}>Hätäilmoitus</Text>
          {(call?.steps ?? []).map((s, i) => (
            <Text key={i} style={{ fontSize: typeScale.small, marginTop: 1 }}>
              {s}
            </Text>
          ))}
          <Text style={{ fontSize: typeScale.small, marginTop: 3, fontWeight: weight.bold }}>
            Osoite hätäpuheluun: {orDash(c.address)}
          </Text>
          <Text style={{ fontSize: typeScale.small, fontWeight: weight.bold }}>
            Kokoontumispaikka: {orDash(c.assemblyPoint)}
            {has(c.assemblyPointAlt) ? ` (vara: ${c.assemblyPointAlt})` : ""}
          </Text>
        </View>
      </Panel>

      <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
        {cards.map((i) => (
          <SheetCard key={i.key} title={i.title} steps={i.steps} />
        ))}
      </View>

      <Text style={{ fontSize: typeScale.heading, fontWeight: weight.bold, marginTop: 10 }} minPresenceAhead={60}>Tärkeät numerot ja sulkujen sijainnit</Text>
      <KeyValues columns={2} items={numbers} />
      {has(c.extraInstructions) ? (
        <>
          <Text style={{ fontSize: typeScale.heading, fontWeight: weight.bold, marginTop: 12 }}>Yhtiön omat ohjeet</Text>
          <TextBlock value={c.extraInstructions} />
        </>
      ) : null}
      <Muted style={{ marginTop: 8 }}>
        Tämä sivu on tarkoitettu tulostettavaksi porrashuoneen ilmoitustaululle. Koko pelastussuunnitelma on saatavilla isännöitsijältä ja asukasportaalista.
      </Muted>
      <DocumentFooter left={`${c.companyName} · toimintaohjeet hälytystilanteissa · liite ${number}`} />
    </Page>
  );
}
