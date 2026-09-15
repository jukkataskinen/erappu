import { Badge, LinkButton, PageHeader, Panel, SectionTitle, Table, Td, Th } from "@/components/ui";
import { requireStaff } from "@/lib/auth/current-user";
import { TEMPLATES } from "@/lib/contract-templates";
import { CONTRACT_CATEGORY_LABEL } from "@/lib/contracts/labels";

export const metadata = { title: "Sopimuspohjat" };

const TYPE_LABEL: Record<string, string> = {
  text: "Teksti",
  textarea: "Pitkä teksti",
  email: "Sähköposti",
  date: "Päivämäärä",
  money: "Euroa",
  boolean: "Kyllä/ei",
  integer: "Kokonaisluku",
  provider: "Palveluntuottaja",
};

const SOURCE_LABEL: Record<string, string> = {
  "company.address": "yhtiön osoite",
  "representative.name": "hallituksen puheenjohtaja tai isännöitsijä",
  "representative.email": "puheenjohtajan tai isännöitsijän sähköposti",
  "provider.name": "palveluntuottajan nimi",
  "provider.email": "palveluntuottajan sähköposti",
};

export default async function TemplatesPage() {
  const ctx = await requireStaff();
  const canWrite = ctx.can("owner", "manager", "assistant");
  return (
    <>
      <PageHeader title="Sopimuspohjat" subtitle="Helposti täytettävät, vuosittain toistuvat sopimukset" back={{ href: "/sopimukset", label: "Sopimukset" }} />
      <div className="grid gap-6">
        {TEMPLATES.map((t) => (
          <Panel key={t.key}>
            <SectionTitle
              actions={
                <div className="flex flex-wrap gap-2">
                  <LinkButton variant="secondary" href={`/sopimukset/pohjat/${t.key}/esikatselu`} target="_blank">Esikatselu (PDF)</LinkButton>
                  {canWrite ? <LinkButton href={`/sopimukset/erat/uusi?pohja=${t.key}`}>Massaluonti</LinkButton> : null}
                </div>
              }
            >
              {t.name}
            </SectionTitle>
            <div className="mb-3 flex flex-wrap gap-2">
              <Badge>{CONTRACT_CATEGORY_LABEL[t.category]}</Badge>
              <Badge>Versio {t.version}</Badge>
              {t.approved ? <Badge tone="ok">Hyväksytty pohja</Badge> : <Badge tone="warn">Luonnos, sisältö tarkistettava</Badge>}
            </div>
            <p className="mb-4 text-sm text-ink/70">{t.description}</p>
            <p className="mb-2 text-sm text-ink/65">
              Kohdat: {t.sections.map((s, i) => `${i + 1}. ${s.heading.charAt(0)}${s.heading.slice(1).toLowerCase()}`).join(", ")}.
            </p>
            <Table>
              <thead>
                <tr>
                  <Th>Kenttä</Th>
                  <Th>Tyyppi</Th>
                  <Th>Täytetään</Th>
                  <Th>Oletus</Th>
                </tr>
              </thead>
              <tbody>
                {t.fields.map((f) => (
                  <tr key={f.key}>
                    <Td>
                      {f.label}
                      {f.required ? "" : <span className="text-ink/55"> (valinnainen)</span>}
                    </Td>
                    <Td>{TYPE_LABEL[f.type]}</Td>
                    <Td>{f.scope === "batch" ? (f.overridable ? "Yhteinen, yhtiölle voi poiketa" : "Yhteinen kaikille yhtiöille") : "Yhtiökohtainen"}</Td>
                    <Td className="text-ink/65">
                      {f.source ? SOURCE_LABEL[f.source] ?? "rekisteristä" : typeof f.default === "boolean" ? (f.default ? "kyllä" : "ei") : typeof f.default === "function" ? "kauden päättyminen" : f.default ?? "–"}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <p className="mt-3 text-xs text-ink/55">Allekirjoittajat eSinetissä: {t.signers.map((s) => s.roleLabel.toLowerCase()).join(" ja ")}, vahva tunnistus.</p>
          </Panel>
        ))}
      </div>
    </>
  );
}
