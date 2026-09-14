/** @jsxRuntime automatic */
/** @jsxImportSource react */
/**
 * Isännöitsijäntodistus (AOYL 7:27 §, VNa 365/2010).
 *
 * LUONNOS: rakenne noudattaa asetuksen liitteen jaottelua (yhtiön tiedot,
 * huoneiston tiedot, taloudelliset tiedot, korjaukset, rajoitukset), mutta
 * juridinen sisältö on Jukan hyväksyttävä. Kunnes
 * `CERTIFICATE_TEMPLATE_APPROVED` on tosi, jokaisella sivulla on
 * luonnosmerkintä.
 *
 * Omistajia ei tulosteta: omistus- ja panttaustiedot ovat HTJ:ssä, ja
 * todistukseen tulee merkintä siitä. Ei henkilötunnuksia.
 */

import { Page, Text, View } from "@react-pdf/renderer";
import { DataTable, DocumentFooter, DocumentHeader, DocumentRoot, DraftBanner, Heading, KeyValues, Muted, Paragraph, pageStyle } from "./components";
import { formatArea, formatDate, formatInteger, orDash } from "./format";
import { QrCode } from "./qr";
import { colors, type as typeScale, weight } from "./theme";

export interface ManagerCertificateData {
  approved: boolean;
  organizationName: string;
  issuedOn: string;
  verifyUrl: string;
  company: {
    name: string;
    businessId: string;
    address: string | null;
    propertyCodes: string[];
    articlesDate: string | null;
    tenure: string | null;
    lessor: string | null;
    leaseEndsOn: string | null;
    propertyArea: string | null;
    insurance: string | null;
    propertyMaintenance: string | null;
    apartmentCount: number;
    commercialCount: number;
    apartmentAreaM2: number;
    commercialAreaM2: number;
    parkingSpaces: string | null;
    totalShares: number | null;
    htjSynced: boolean;
    commonSpaces: string[];
  };
  buildings: {
    label: string | null;
    completedYear: number | null;
    buildingType: string | null;
    floors: number | null;
    material: string | null;
    roof: string | null;
    heating: string | null;
    ventilation: string | null;
    energy: string | null;
  }[];
  unit: {
    label: string;
    kindLabel: string;
    shareRanges: string;
    shareCount: number;
    areaM2: string | null;
    layout: string | null;
    floor: string | null;
    intendedUse: string | null;
    building: string | null;
  };
  finance: {
    charges: { label: string; basis: string; monthly: string }[];
    monthlyTotal: string | null;
    loans: { name: string; lender: string | null; balance: string; dueOn: string | null }[];
    loanShare: { loanName: string; remaining: string; balanceDate: string }[];
    paymentStatus: string | null;
  };
  repairs: {
    done: { year: string; project: string; workType: string }[];
    planned: { year: string; target: string; action: string }[];
  };
  restrictions: string[];
  manager: { name: string | null; email: string | null; phone: string | null };
}

function Section({ number, title }: { number: string; title: string }) {
  return (
    <Heading>
      {number} {title}
    </Heading>
  );
}

export function ManagerCertificate({ data }: { data: ManagerCertificateData }) {
  const c = data.company;
  const u = data.unit;
  const draft = !data.approved;
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
            <Muted style={{ marginTop: 2 }}>Asunto-osakeyhtiölaki 7:27 § ja valtioneuvoston asetus 365/2010</Muted>
          </View>
          <View style={{ alignItems: "center", marginLeft: 12 }}>
            <QrCode value={data.verifyUrl} size={64} />
            <Text style={{ fontSize: typeScale.label, color: colors.inkFaint }}>Tarkista aitous</Text>
          </View>
        </View>

        <Section number="I" title="Yhtiön tiedot" />
        <KeyValues
          items={[
            { label: "Yhtiö", value: c.name },
            { label: "Y-tunnus", value: c.businessId },
            { label: "Osoite", value: orDash(c.address) },
            { label: "Kiinteistötunnus", value: c.propertyCodes.join(", ") || "–" },
            { label: "Yhtiöjärjestyksen päiväys", value: formatDate(c.articlesDate) },
            { label: "Tontti", value: c.tenure === "own" ? "Oma" : c.tenure === "lease" ? `Vuokra${c.lessor ? `, ${c.lessor}` : ""}${c.leaseEndsOn ? `, päättyy ${formatDate(c.leaseEndsOn)}` : ""}` : "–" },
            { label: "Tontin pinta-ala", value: orDash(c.propertyArea) },
            { label: "Osakkeita yhteensä", value: formatInteger(c.totalShares) },
            { label: "Asuinhuoneistot", value: `${c.apartmentCount} kpl, ${formatArea(c.apartmentAreaM2)}` },
            { label: "Liikehuoneistot", value: c.commercialCount ? `${c.commercialCount} kpl, ${formatArea(c.commercialAreaM2)}` : "Ei" },
            { label: "Autopaikat", value: orDash(c.parkingSpaces) },
            { label: "Yhteiset tilat", value: c.commonSpaces.join(", ") || "–" },
            { label: "Vakuutus", value: orDash(c.insurance) },
            { label: "Kiinteistönhoito", value: orDash(c.propertyMaintenance) },
          ]}
        />
        <DataTable
          columns={[
            { key: "label", label: "Rakennus", flex: 1 },
            { key: "year", label: "Valmistunut", flex: 0.8 },
            { key: "type", label: "Talotyyppi", flex: 1 },
            { key: "floors", label: "Kerroksia", flex: 0.7, align: "right" },
            { key: "material", label: "Rakennusaine", flex: 1 },
            { key: "roof", label: "Katto", flex: 1 },
            { key: "heating", label: "Lämmitys", flex: 1 },
            { key: "ventilation", label: "Ilmanvaihto", flex: 1 },
            { key: "energy", label: "Energia", flex: 0.8 },
          ]}
          rows={data.buildings.map((b) => ({
            label: orDash(b.label),
            year: orDash(b.completedYear),
            type: orDash(b.buildingType),
            floors: orDash(b.floors),
            material: orDash(b.material),
            roof: orDash(b.roof),
            heating: orDash(b.heating),
            ventilation: orDash(b.ventilation),
            energy: orDash(b.energy),
          }))}
          emptyText="Rakennustietoja ei ole kirjattu."
        />

        <Section number="II" title="Osakeryhmän ja huoneiston tiedot" />
        <KeyValues
          items={[
            { label: "Huoneisto", value: u.label },
            { label: "Laji", value: u.kindLabel },
            { label: "Osakkeiden numerot", value: u.shareRanges },
            { label: "Osakkeiden lukumäärä", value: formatInteger(u.shareCount) },
            { label: "Pinta-ala", value: formatArea(u.areaM2) },
            { label: "Huoneistotyyppi", value: orDash(u.layout) },
            { label: "Kerros", value: orDash(u.floor) },
            { label: "Käyttötarkoitus", value: orDash(u.intendedUse) },
            { label: "Rakennus", value: orDash(u.building) },
          ]}
        />

        <Section number="III" title="Taloudelliset tiedot" />
        <DataTable
          columns={[
            { key: "label", label: "Vastike", flex: 2 },
            { key: "basis", label: "Peruste", flex: 2 },
            { key: "monthly", label: "€/kk", flex: 1, align: "right" },
          ]}
          rows={data.finance.charges}
          emptyText="Voimassa olevia vastikeperusteita ei ole kirjattu."
        />
        {data.finance.monthlyTotal ? (
          <Text style={{ marginTop: 4, textAlign: "right", fontWeight: weight.bold }}>Yhteensä {data.finance.monthlyTotal} / kk</Text>
        ) : null}
        <Text style={{ marginTop: 10, fontWeight: weight.medium }}>Yhtiön lainat</Text>
        <DataTable
          columns={[
            { key: "name", label: "Laina", flex: 2 },
            { key: "lender", label: "Lainanantaja", flex: 2 },
            { key: "balance", label: "Jäljellä", flex: 1, align: "right" },
            { key: "dueOn", label: "Erääntyy", flex: 1 },
          ]}
          rows={data.finance.loans.map((l) => ({ name: l.name, lender: orDash(l.lender), balance: l.balance, dueOn: formatDate(l.dueOn) }))}
          emptyText="Yhtiöllä ei ole kirjattuja lainoja."
        />
        <Text style={{ marginTop: 10, fontWeight: weight.medium }}>Osakeryhmän lainaosuus</Text>
        <DataTable
          columns={[
            { key: "loanName", label: "Laina", flex: 3 },
            { key: "remaining", label: "Lainaosuus", flex: 1, align: "right" },
            { key: "balanceDate", label: "Päivämäärä", flex: 1 },
          ]}
          rows={data.finance.loanShare.map((l) => ({ ...l, balanceDate: formatDate(l.balanceDate) }))}
          emptyText="Osakeryhmällä ei ole maksamatonta lainaosuutta."
        />
        <Paragraph style={{ marginTop: 8 }}>
          <Text style={{ fontWeight: weight.medium }}>Maksutilanne: </Text>
          {data.finance.paymentStatus ?? "Tietoa ei ole saatavilla. Tarkista maksutilanne isännöitsijältä."}
        </Paragraph>

        <Section number="IV" title="Korjaukset" />
        <Text style={{ fontWeight: weight.medium }}>Tehdyt kunnossapito- ja muutostyöt (10 vuotta)</Text>
        <DataTable
          columns={[
            { key: "year", label: "Vuosi", flex: 0.6 },
            { key: "project", label: "Työ", flex: 3 },
            { key: "workType", label: "Laji", flex: 1.4 },
          ]}
          rows={data.repairs.done}
          emptyText="Ei kirjattuja töitä."
        />
        <Text style={{ marginTop: 10, fontWeight: weight.medium }}>Kunnossapitotarveselvitys (5 vuotta)</Text>
        <DataTable
          columns={[
            { key: "year", label: "Vuosi", flex: 0.6 },
            { key: "target", label: "Kohde", flex: 1.6 },
            { key: "action", label: "Toimenpide", flex: 2.8 },
          ]}
          rows={data.repairs.planned}
          emptyText="Ei kirjattuja tarpeita."
        />

        <Section number="V" title="Käyttö- ja luovutusrajoitukset" />
        <Paragraph>{data.restrictions.length ? data.restrictions.join(", ") : "Yhtiöjärjestyksessä ei ole lunastuslauseketta tai muita kirjattuja rajoituksia."}</Paragraph>

        <Heading>Huoneistotietojärjestelmä</Heading>
        <Paragraph>
          {c.htjSynced
            ? "Yhtiö ja osakeryhmä kuuluvat huoneistotietojärjestelmään. Omistaja- ja panttaustiedot tarkistetaan huoneistotietojärjestelmästä."
            : "Huomautus: yhtiön tietoja ei ole vielä täsmäytetty huoneistotietojärjestelmään. Omistaja- ja panttaustiedot tarkistetaan huoneistotietojärjestelmästä (Maanmittauslaitos)."}
        </Paragraph>

        <View style={{ marginTop: 20 }} wrap={false}>
          <Text>{formatDate(data.issuedOn)}</Text>
          <Text style={{ marginTop: 6, fontWeight: weight.bold }}>{orDash(data.manager.name)}</Text>
          <Muted>Isännöitsijä, {data.organizationName}</Muted>
          <Muted>{[data.manager.email, data.manager.phone].filter(Boolean).join(" · ")}</Muted>
        </View>
        <DocumentFooter left={`Isännöitsijäntodistus · ${c.name} · ${u.label}${draft ? " · LUONNOS" : ""}`} />
      </Page>
    </DocumentRoot>
  );
}
