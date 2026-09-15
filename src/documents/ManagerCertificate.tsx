/** @jsxRuntime automatic */
/** @jsxImportSource react */
/**
 * Isännöitsijäntodistus (AOYL 7:27 §, VNa 365/2010, muut. 174/2013 ja 567/2026).
 *
 * LUONNOS: rakenne noudattaa asetuksen jaottelua (3 § yksilöinti, 4 §
 * osakehuoneisto, 5 § kiinteistö ja rakennukset, 6 § talous, 7 § muut
 * tiedot), mutta juridinen sisältö on Jukan hyväksyttävä. Kunnes
 * `CERTIFICATE_TEMPLATE_APPROVED` on tosi, asiakirjassa on luonnosmerkintä.
 *
 * Omistajia ei tulosteta: omistus- ja panttaustiedot ovat HTJ:ssä, ja
 * todistukseen tulee merkintä siitä. Ei henkilötunnuksia.
 */

import { Page, Text, View } from "@react-pdf/renderer";
import type { AttachmentEntry } from "@/lib/certificates/attachments";
import { DataTable, DocumentFooter, DocumentHeader, DocumentRoot, DraftBanner, Heading, KeyValues, Muted, Paragraph, pageStyle } from "./components";
import { formatArea, formatDate, formatInteger, orDash } from "./format";
import { QrCode } from "./qr";
import { colors, type as typeScale, weight } from "./theme";

type LoanLine = {
  name: string; type: string; lender: string; purpose: string; drawnOn: string; principal: string; interest: string; dueOn: string;
  balance: string; balanceDate: string; undrawn: string | null; payable: string;
};

export interface ManagerCertificateData {
  approved: boolean;
  organizationName: string;
  issuedOn: string;
  verifyUrl: string;
  legalBasis: string;
  order: { purpose: string | null; ordererName: string | null; withAttachments: boolean };
  company: {
    name: string;
    businessId: string;
    registeredOn: string | null;
    address: string | null;
    articlesDate: string | null;
    commercialRegisterNote: string | null;
    htjSynced: boolean;
    htjTransferredOn: string | null;
    boardChair: string | null;
    propertyMaintenance: string | null;
    totalShares: number | null;
    sharesApartments: number;
    sharesOther: number;
    vat: string;
    chargesDecidedBy: string | null;
    articlesMaintenanceClause: string | null;
    shareIssueAuthorization: string | null;
    articlesLawsuit: string | null;
    notes: string | null;
    shareCertificates: string;
    energy: string;
  };
  manager: { name: string | null; email: string | null; phone: string | null; office: string; officeAddress: string | null; officePhone: string | null };
  properties: { code: string; parts: string | null; area: string; tenure: string; lease: string | null; buildingRights: string | null }[];
  buildingSummary: { count: string; apartmentArea: string; floorArea: string; volume: string; staircases: string; elevators: string };
  buildings: {
    label: string | null;
    completedYear: number | null;
    buildingType: string | null;
    floors: number | null;
    material: string | null;
    roof: string | null;
    heating: string | null;
    heatDistribution: string | null;
    cooling: string | null;
    ventilation: string | null;
    telecom: string | null;
    elevators: number;
    energy: string | null;
    commonSpaces: string[];
  }[];
  spaces: { label: string; count: string; area: string; shares: string; companyPossession: string }[];
  parking: { built: string | null; hall: number | null; other: number | null; company: number | null; rules: string | null };
  asbestosNote: string | null;
  unit: {
    label: string;
    kindLabel: string;
    shareRanges: string;
    shareCount: number;
    votes: number | null;
    areaM2: string | null;
    areaVerified: string;
    layout: string | null;
    floor: string | null;
    staircase: string | null;
    intendedUse: string | null;
    building: string | null;
    address: string | null;
    htjId: string | null;
    notes: string | null;
  };
  possession: {
    companyPossession: string;
    companyRented: string;
    widowRight: string;
    spousesCommonHome: string;
    otherRestrictions: string | null;
    shortTermRental: string;
  };
  renovationNotices: { received: string; work: string; status: string; completed: string }[];
  renovationNoticesSince: string | null;
  finance: {
    charges: { label: string; basis: string; monthly: string }[];
    monthlyTotal: string | null;
    priceList: { product: string; unitPrice: string; vat: string }[];
    loans: LoanLine[];
    creditLimits: LoanLine[];
    loanShare: { loanName: string; remaining: string; balanceDate: string }[];
    paymentStatus: string | null;
    mortgages: { amount: string; holder: string; registeredOn: string; property: string }[];
    mortgagesTotal: string | null;
    insurances: { type: string; name: string; insurer: string; description: string }[];
  };
  repairs: {
    needsReportOn: string | null;
    planOn: string | null;
    planSummary: string | null;
    decided: { status: string; target: string; action: string; decidedOn: string; year: string; estimate: string }[];
    done: { year: string; project: string; workType: string; by: string }[];
    planned: { year: string; target: string; action: string; estimate: string }[];
  };
  restrictions: string[];
  attachments: AttachmentEntry[];
}

function Section({ number, title }: { number: string; title: string }) {
  return (
    <Heading>
      {number} {title}
    </Heading>
  );
}

function SubHeading({ children }: { children: string }) {
  return (
    <Text style={{ marginTop: 10, fontWeight: weight.medium }} minPresenceAhead={30}>
      {children}
    </Text>
  );
}

const ATTACHMENT_STATUS: Record<AttachmentEntry["status"], string> = {
  attached: "Liitetty",
  missing: "Ei saatavilla",
  failed: "Ei voitu liittää",
  available: "Saatavilla isännöitsijältä",
};

function pagesText(e: AttachmentEntry): string {
  if (e.status === "attached") return e.pages ? `${e.pages} s.` : "–";
  if (e.status === "failed") return e.reason ? `Ei voitu liittää: ${e.reason}` : ATTACHMENT_STATUS.failed;
  return ATTACHMENT_STATUS[e.status];
}

export function ManagerCertificate({ data }: { data: ManagerCertificateData }) {
  const c = data.company;
  const u = data.unit;
  const f = data.finance;
  const r = data.repairs;
  const draft = !data.approved;
  const orderLine = [data.order.purpose ? `Käyttötarkoitus: ${data.order.purpose}` : null, data.order.ordererName ? `Tilaaja: ${data.order.ordererName}` : null].filter(Boolean).join(" · ");
  const commonSpaceRows = data.buildings.filter((b) => b.commonSpaces.length > 0).map((b) => ({ building: orDash(b.label), spaces: b.commonSpaces.join(", ") }));

  return (
    <DocumentRoot title="Isännöitsijäntodistus" subject={`${c.name}, ${u.label}`} date={data.issuedOn}>
      <Page size="A4" style={pageStyle}>
        <DocumentHeader right={`${c.name} · ${c.businessId}`} />
        {draft ? <DraftBanner text="LUONNOS – sisältö tarkistettava" /> : null}
        <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: typeScale.title, fontWeight: weight.bold, lineHeight: 1.25 }}>Isännöitsijäntodistus</Text>
            <Muted style={{ marginTop: 3 }}>
              {c.name}, huoneisto {u.label} · annettu {formatDate(data.issuedOn)}
            </Muted>
            <Muted style={{ marginTop: 2 }}>{data.legalBasis}</Muted>
            {orderLine ? <Muted style={{ marginTop: 2 }}>{orderLine}</Muted> : null}
            <Muted style={{ marginTop: 2 }}>{data.order.withAttachments ? "Todistus liitteineen" : "Todistus ilman liitteitä"}</Muted>
          </View>
          <View style={{ alignItems: "center", marginLeft: 12 }}>
            <QrCode value={data.verifyUrl} size={64} />
            <Text style={{ fontSize: typeScale.label, color: colors.inkFaint }}>Tarkista aitous</Text>
          </View>
        </View>
        {!data.order.withAttachments ? (
          <Paragraph style={{ marginTop: 8, fontSize: typeScale.small }}>
            Todistus on annettu tilaajan pyynnöstä ilman tilinpäätös-, toimintakertomus- ja talousarvioliitteitä (VNa 365/2010 2 § 4 mom.). Liiteluettelossa on
            mainittu isännöitsijältä saatavilla olevat asiakirjat.
          </Paragraph>
        ) : null}

        <Section number="I" title="Yhtiö ja isännöinti" />
        <KeyValues
          items={[
            { label: "Yhtiö", value: c.name },
            { label: "Y-tunnus", value: c.businessId },
            { label: "Rekisteröintipäivä", value: formatDate(c.registeredOn) },
            { label: "Kiinteistön osoite", value: orDash(c.address) },
            { label: "Yhtiöjärjestyksen päiväys", value: formatDate(c.articlesDate) },
            { label: "Kaupparekisterimerkintä", value: orDash(c.commercialRegisterNote) },
            { label: "Isännöitsijä", value: orDash(data.manager.name) },
            { label: "Isännöintitoimisto", value: [data.manager.office, data.manager.officeAddress].filter(Boolean).join(", ") },
            { label: "Isännöitsijän yhteystiedot", value: [data.manager.email, data.manager.phone ?? data.manager.officePhone].filter(Boolean).join(" · ") || "–" },
            { label: "Hallituksen puheenjohtaja", value: orDash(c.boardChair) },
            { label: "Kiinteistönhoito", value: orDash(c.propertyMaintenance) },
            { label: "Osakeluettelo HTJ:ssä", value: c.htjTransferredOn ? formatDate(c.htjTransferredOn) : c.htjSynced ? "Kyllä" : "Ei merkitty" },
          ]}
        />

        <Section number="II" title="Osakehuoneisto" />
        <KeyValues
          items={[
            { label: "Huoneisto", value: u.label },
            { label: "Laji", value: u.kindLabel },
            { label: "Osakkeiden numerot", value: u.shareRanges },
            { label: "Osakkeiden lukumäärä", value: formatInteger(u.shareCount) },
            { label: "Äänimäärä", value: orDash(u.votes) },
            { label: "Käyttötarkoitus (yhtiöjärjestys)", value: orDash(u.intendedUse) },
            { label: "Pinta-ala (yhtiöjärjestys)", value: formatArea(u.areaM2) },
            { label: "Pinta-ala tarkistusmitattu", value: u.areaVerified },
            { label: "Huoneistotyyppi", value: orDash(u.layout) },
            { label: "Rakennus, porras, kerros", value: [u.building, u.staircase, u.floor ? `${u.floor}. krs` : null].filter(Boolean).join(", ") || "–" },
            { label: "Huoneiston osoite", value: orDash(u.address ?? c.address) },
            { label: "HTJ-osakeryhmätunnus", value: orDash(u.htjId) },
          ]}
        />
        <SubHeading>Hallinta ja rajoitukset</SubHeading>
        <KeyValues
          items={[
            { label: "Otettu yhtiön hallintaan", value: data.possession.companyPossession },
            { label: "Vuokrattu yhtiön toimesta", value: data.possession.companyRented },
            { label: "Lesken hallintaoikeus", value: data.possession.widowRight },
            { label: "Puolisoiden yhteinen koti", value: data.possession.spousesCommonHome },
            { label: "Lunastuslauseke ja yhtiöjärjestyksen rajoitukset", value: data.restrictions.length ? data.restrictions.join(", ") : "Ei kirjattuja" },
            { label: "Muut käyttö- ja luovutusrajoitukset", value: orDash(data.possession.otherRestrictions) },
            { label: "Kunnossapitovastuu ja muutostyöt yhtiöjärjestyksessä", value: c.articlesMaintenanceClause ?? "Ei laista poikkeavia kirjattuja määräyksiä" },
            { label: "Lyhytvuokraus", value: data.possession.shortTermRental },
          ]}
        />
        <SubHeading>Vastikkeet</SubHeading>
        <DataTable
          columns={[
            { key: "label", label: "Vastike", flex: 2 },
            { key: "basis", label: "Peruste", flex: 2 },
            { key: "monthly", label: "€/kk", flex: 1, align: "right" },
          ]}
          rows={f.charges}
          emptyText="Voimassa olevia vastikeperusteita ei ole kirjattu."
        />
        {f.monthlyTotal ? <Text style={{ marginTop: 4, textAlign: "right", fontWeight: weight.bold }}>Yhteensä {f.monthlyTotal} / kk</Text> : null}
        <SubHeading>Osakeryhmän lainaosuus</SubHeading>
        <DataTable
          columns={[
            { key: "loanName", label: "Laina", flex: 3 },
            { key: "remaining", label: "Lainaosuus", flex: 1, align: "right" },
            { key: "balanceDate", label: "Päivämäärä", flex: 1 },
          ]}
          rows={f.loanShare.map((l) => ({ ...l, balanceDate: formatDate(l.balanceDate) }))}
          emptyText="Osakeryhmällä ei ole maksamatonta lainaosuutta."
        />
        <Paragraph style={{ marginTop: 8 }}>
          <Text style={{ fontWeight: weight.medium }}>Maksutilanne: </Text>
          {f.paymentStatus ?? "Tietoa ei ole saatavilla. Tarkista maksutilanne isännöitsijältä."}
        </Paragraph>
        <SubHeading>Huoneiston lisätiedot</SubHeading>
        <Paragraph>{u.notes ?? "Yhtiön tiedossa ei ole huoneiston käyttöön tai käyttökustannuksiin olennaisesti vaikuttavia vikoja tai puutteita."}</Paragraph>
        <SubHeading>Osakkaan kunnossapito- ja muutostyöilmoitukset</SubHeading>
        <Muted>
          {data.renovationNoticesSince
            ? `Yhtiön tiedossa olevat ilmoitukset isännöinnin alkamisesta ${formatDate(data.renovationNoticesSince)} alkaen.`
            : "Yhtiön tiedossa olevat, isännöintiin kirjatut ilmoitukset."}
        </Muted>
        <DataTable
          columns={[
            { key: "received", label: "Ilmoitettu", flex: 1 },
            { key: "work", label: "Työ", flex: 2.4 },
            { key: "status", label: "Tila", flex: 1.4 },
            { key: "completed", label: "Valmistunut", flex: 1 },
          ]}
          rows={data.renovationNotices}
          emptyText="Ei kirjattuja ilmoituksia."
        />

        <Section number="III" title="Kiinteistö ja rakennukset" />
        <DataTable
          columns={[
            { key: "code", label: "Kiinteistötunnus", flex: 1.3 },
            { key: "area", label: "Pinta-ala", flex: 0.9 },
            { key: "tenure", label: "Hallinta", flex: 0.7 },
            { key: "details", label: "Tarkennukset", flex: 3 },
          ]}
          rows={data.properties.map((p) => ({
            code: p.code,
            area: p.area,
            tenure: p.tenure,
            details: [p.parts, p.lease, p.buildingRights ? `Rakennusoikeus: ${p.buildingRights}` : null].filter(Boolean).join("\n") || "–",
          }))}
          emptyText="Kiinteistötietoja ei ole kirjattu."
        />
        <SubHeading>Rakennukset yhteensä</SubHeading>
        <KeyValues
          columns={3}
          items={[
            { label: "Rakennuksia", value: data.buildingSummary.count },
            { label: "Huoneistoala", value: data.buildingSummary.apartmentArea },
            { label: "Kerrosala", value: data.buildingSummary.floorArea },
            { label: "Porrashuoneita", value: data.buildingSummary.staircases },
            { label: "Tilavuus", value: data.buildingSummary.volume },
            { label: "Hissejä", value: data.buildingSummary.elevators },
          ]}
        />
        <DataTable
          columns={[
            { key: "label", label: "Rakennus", flex: 0.8 },
            { key: "year", label: "Valm.", flex: 0.6 },
            { key: "type", label: "Talotyyppi", flex: 1 },
            { key: "floors", label: "Krs", flex: 0.4, align: "right" },
            { key: "material", label: "Rakennusaine", flex: 1 },
            { key: "roof", label: "Katto ja kate", flex: 1.1 },
            { key: "energy", label: "Energia", flex: 0.7 },
          ]}
          rows={data.buildings.map((b) => ({
            label: orDash(b.label),
            year: orDash(b.completedYear),
            type: orDash(b.buildingType),
            floors: orDash(b.floors),
            material: orDash(b.material),
            roof: orDash(b.roof),
            energy: orDash(b.energy),
          }))}
          emptyText="Rakennustietoja ei ole kirjattu."
        />
        {data.buildings.length > 0 ? (
          <DataTable
            columns={[
              { key: "label", label: "Rakennus", flex: 0.8 },
              { key: "heating", label: "Lämmitys", flex: 1 },
              { key: "distribution", label: "Lämmönjako", flex: 1 },
              { key: "cooling", label: "Jäähdytys", flex: 0.8 },
              { key: "ventilation", label: "Ilmanvaihto", flex: 1 },
              { key: "telecom", label: "Tietoliikenne", flex: 1.4 },
              { key: "elevators", label: "Hissit", flex: 0.5, align: "right" },
            ]}
            rows={data.buildings.map((b) => ({
              label: orDash(b.label),
              heating: orDash(b.heating),
              distribution: orDash(b.heatDistribution),
              cooling: orDash(b.cooling),
              ventilation: orDash(b.ventilation),
              telecom: orDash(b.telecom),
              elevators: String(b.elevators),
            }))}
          />
        ) : null}
        <SubHeading>Tilat ja osakkeet</SubHeading>
        <DataTable
          columns={[
            { key: "label", label: "Tila", flex: 2 },
            { key: "count", label: "Kpl", flex: 0.6, align: "right" },
            { key: "area", label: "Pinta-ala", flex: 1, align: "right" },
            { key: "shares", label: "Osakkeet", flex: 1, align: "right" },
            { key: "companyPossession", label: "Yhtiön hallinnassa", flex: 1.2, align: "right" },
          ]}
          rows={data.spaces}
          emptyText="Osakeryhmiä ei ole kirjattu."
        />
        <Muted style={{ marginTop: 4 }}>
          Osakkeita yhteensä {formatInteger(c.totalShares)}, joista asuinhuoneistojen {formatInteger(c.sharesApartments)} ja muiden tilojen {formatInteger(c.sharesOther)}.
        </Muted>
        <SubHeading>Autopaikat ja yhteiset tilat</SubHeading>
        <KeyValues
          items={[
            { label: "Autopaikkoja", value: orDash(data.parking.built) },
            { label: "Hallipaikat / muut", value: `${orDash(data.parking.hall)} / ${orDash(data.parking.other)}` },
            { label: "Yhtiön hallinnassa", value: orDash(data.parking.company) },
            { label: "Jakosäännöt", value: orDash(data.parking.rules) },
          ]}
        />
        <DataTable
          columns={[
            { key: "building", label: "Rakennus", flex: 1 },
            { key: "spaces", label: "Yhteiset tilat", flex: 4 },
          ]}
          rows={commonSpaceRows}
          emptyText="Yhteisiä tiloja ei ole kirjattu."
        />
        {data.asbestosNote ? (
          <Paragraph style={{ marginTop: 8 }}>
            <Text style={{ fontWeight: weight.medium }}>Asbesti: </Text>
            {data.asbestosNote}
          </Paragraph>
        ) : null}

        <Section number="IV" title="Kunnossapito ja korjaukset" />
        <KeyValues
          items={[
            { label: "Kunnossapitotarveselvitys", value: r.needsReportOn ? `Annettu ${formatDate(r.needsReportOn)}` : "Ei kirjattu" },
            { label: "Kunnossapitosuunnitelma", value: r.planOn ? `Hyväksytty ${formatDate(r.planOn)}` : "Ei hyväksyttyä suunnitelmaa" },
          ]}
        />
        {r.planSummary ? <Paragraph style={{ marginTop: 6 }}>Suunnitelman pääasiallinen sisältö: {r.planSummary}</Paragraph> : null}
        <SubHeading>Päätetyt ja käynnissä olevat korjaukset</SubHeading>
        <DataTable
          columns={[
            { key: "status", label: "Vaihe", flex: 0.9 },
            { key: "work", label: "Kohde ja toimenpide", flex: 2.6 },
            { key: "decidedOn", label: "Päätetty", flex: 0.9 },
            { key: "year", label: "Ajoitus", flex: 0.6 },
            { key: "estimate", label: "Arvio", flex: 1, align: "right" },
          ]}
          rows={r.decided.map((d) => ({ status: d.status, work: `${d.target}: ${d.action}`, decidedOn: d.decidedOn, year: d.year, estimate: d.estimate }))}
          emptyText="Ei päätettyjä tai käynnissä olevia korjauksia."
        />
        <SubHeading>Kunnossapitotarveselvitys (seuraavat 5 vuotta)</SubHeading>
        <DataTable
          columns={[
            { key: "year", label: "Vuosi", flex: 0.6 },
            { key: "target", label: "Kohde", flex: 1.6 },
            { key: "action", label: "Toimenpide", flex: 2.4 },
            { key: "estimate", label: "Arvio", flex: 1, align: "right" },
          ]}
          rows={r.planned}
          emptyText="Ei kirjattuja tarpeita."
        />
        <SubHeading>Suoritetut kunnossapito- ja muutostyöt</SubHeading>
        <DataTable
          columns={[
            { key: "year", label: "Vuosi", flex: 0.6 },
            { key: "project", label: "Työ", flex: 3 },
            { key: "workType", label: "Laji", flex: 1.4 },
            { key: "by", label: "Tekijä", flex: 0.7 },
          ]}
          rows={r.done}
          emptyText="Ei kirjattuja töitä."
        />

        <Section number="V" title="Talous" />
        <KeyValues
          items={[
            { label: "Vastikkeen määrää", value: c.chargesDecidedBy ?? "Yhtiöjärjestyksen mukaan" },
            { label: "Arvonlisäverovelvollinen", value: c.vat },
            { label: "Kiinnitykset yhteensä", value: orDash(f.mortgagesTotal) },
          ]}
        />
        <SubHeading>Vastikkeet ja käyttökorvaukset</SubHeading>
        <DataTable
          columns={[
            { key: "product", label: "Tuote", flex: 2 },
            { key: "unitPrice", label: "Yksikköhinta", flex: 1.6, align: "right" },
            { key: "vat", label: "", flex: 0.7 },
          ]}
          rows={f.priceList}
          emptyText="Voimassa olevia vastikkeita ei ole kirjattu."
        />
        <SubHeading>Yhtiön lainat</SubHeading>
        {f.loans.length === 0 ? <Muted>Yhtiöllä ei ole kirjattuja lainoja.</Muted> : null}
        {f.loans.map((l, i) => (
          <KeyValues
            key={i}
            columns={3}
            items={[
              { label: "Laina", value: l.name },
              { label: "Lainatyyppi", value: l.type },
              { label: "Lainanantaja", value: l.lender },
              { label: "Käyttötarkoitus", value: l.purpose },
              { label: "Nostettu", value: l.drawnOn },
              { label: "Alkuperäinen pääoma", value: l.principal },
              { label: "Korko", value: l.interest },
              { label: "Viimeinen eräpäivä", value: l.dueOn },
              { label: "Osakas voi maksaa osuutensa", value: l.payable },
              { label: "Jäljellä", value: l.balance },
              { label: "Saldopäivä", value: l.balanceDate },
              { label: "Nostamatta", value: l.undrawn ?? "–" },
            ]}
          />
        ))}
        {f.creditLimits.length > 0 ? (
          <>
            <SubHeading>Luottolimiitit</SubHeading>
            <DataTable
              columns={[
                { key: "name", label: "Limiitti", flex: 2 },
                { key: "lender", label: "Myöntäjä", flex: 1.6 },
                { key: "principal", label: "Limiitti", flex: 1, align: "right" },
                { key: "balance", label: "Käytössä", flex: 1, align: "right" },
                { key: "interest", label: "Korko", flex: 1.6 },
              ]}
              rows={f.creditLimits.map((l) => ({ name: l.name, lender: l.lender, principal: l.principal, balance: l.balance, interest: l.interest }))}
            />
          </>
        ) : null}
        <SubHeading>Kiinnitykset</SubHeading>
        <DataTable
          columns={[
            { key: "amount", label: "Määrä", flex: 1, align: "right" },
            { key: "holder", label: "Haltija / vakuus", flex: 2.4 },
            { key: "property", label: "Kiinteistö", flex: 1.2 },
            { key: "registeredOn", label: "Vahvistettu", flex: 1 },
          ]}
          rows={f.mortgages}
          emptyText={f.mortgagesTotal ? "Kiinnityksiä ei ole eritelty." : "Kiinnityksiä ei ole kirjattu."}
        />
        <SubHeading>Vakuutukset</SubHeading>
        <DataTable
          columns={[
            { key: "type", label: "Tyyppi", flex: 1.4 },
            { key: "name", label: "Nimi", flex: 1.4 },
            { key: "insurer", label: "Vakuutusyhtiö", flex: 1.2 },
            { key: "description", label: "Kuvaus", flex: 2 },
          ]}
          rows={f.insurances}
          emptyText="Vakuutustietoja ei ole kirjattu."
        />

        <Section number="VI" title="Muut tiedot" />
        <KeyValues
          columns={1}
          items={[
            { label: "Osakekirjat", value: c.shareCertificates },
            { label: "Energiatodistus", value: c.energy },
            { label: "Osakeanti- ja optiovaltuutukset", value: c.shareIssueAuthorization ?? "Ei voimassa olevia valtuutuksia" },
            { label: "Kanne yhtiöjärjestyksen määräyksen muuttamiseksi", value: c.articlesLawsuit ?? "Ei yhtiön tiedossa olevaa kannetta" },
            { label: "Yhtiön lisätiedot", value: c.notes ?? "Ei muita yhtiön taloudelliseen tilaan tai huoneiston käyttöön olennaisesti vaikuttavia seikkoja." },
          ]}
        />

        <Heading>Huoneistotietojärjestelmä</Heading>
        <Paragraph>
          {c.htjSynced
            ? "Yhtiö ja osakeryhmä kuuluvat huoneistotietojärjestelmään. Omistaja- ja panttaustiedot sekä osakeryhmään kirjatut rajoitukset tarkistetaan huoneistotietojärjestelmästä."
            : "Huomautus: yhtiön tietoja ei ole vielä täsmäytetty huoneistotietojärjestelmään. Omistaja- ja panttaustiedot tarkistetaan huoneistotietojärjestelmästä (Maanmittauslaitos)."}
        </Paragraph>

        <Heading>Liiteluettelo</Heading>
        {!data.order.withAttachments ? <Muted>Asiakirjat eivät ole tämän todistuksen liitteinä. Saatavilla olevat asiakirjat voi tilata isännöitsijältä.</Muted> : null}
        <DataTable
          columns={[
            { key: "number", label: "Nro", flex: 0.4 },
            { key: "label", label: "Asiakirja", flex: 2 },
            { key: "date", label: "Päiväys / vuosi", flex: 1 },
            { key: "pages", label: data.order.withAttachments ? "Sivut" : "Saatavuus", flex: 1.8 },
          ]}
          rows={data.attachments.map((e) => ({ number: String(e.number), label: e.label, date: orDash(e.dateText), pages: pagesText(e) }))}
          emptyText="Ei liitteitä."
        />

        <View style={{ marginTop: 20 }} wrap={false}>
          <Text>{formatDate(data.issuedOn)}</Text>
          <Text style={{ marginTop: 6, fontWeight: weight.bold }}>{orDash(data.manager.name)}</Text>
          <Muted>Isännöitsijä, {data.organizationName}</Muted>
          <Muted>{[data.manager.email, data.manager.phone].filter(Boolean).join(" · ")}</Muted>
          <Muted style={{ marginTop: 4 }}>Todistus varmennetaan sähköisellä sinetillä (eSinetti). Aitouden voi tarkistaa osoitteessa {data.verifyUrl}.</Muted>
        </View>
        <DocumentFooter left={`Isännöitsijäntodistus · ${c.name} · ${u.label}${draft ? " · LUONNOS" : ""}`} />
      </Page>
    </DocumentRoot>
  );
}
