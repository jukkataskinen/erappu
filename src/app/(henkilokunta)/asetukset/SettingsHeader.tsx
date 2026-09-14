import { FormError } from "@/components/FormError";
import { Notice, PageHeader, Tabs } from "@/components/ui";

const TABS = [
  { key: "henkilokunta", href: "/asetukset", label: "Henkilökunta" },
  { key: "organisaatio", href: "/asetukset/organisaatio", label: "Organisaatio" },
  { key: "portaali", href: "/asetukset/portaali", label: "Portaalikäyttäjät" },
  { key: "integraatiot", href: "/asetukset/integraatiot", label: "Integraatiot" },
  { key: "loki", href: "/asetukset/loki", label: "Tapahtumaloki" },
];

/** Onnistumisilmoitukset kiinteinä koodeina, jotta osoiteriville ei päädy sisältöä. */
const OK: Record<string, string> = {
  kutsu: "Kutsu on lähetetty.",
  uudelleen: "Kutsu on lähetetty uudelleen uudella linkillä. Vanha linkki ei enää toimi.",
  peruttu: "Kutsu on peruttu.",
  rooli: "Rooli on vaihdettu.",
  poistettu: "Käyttäjä on poistettu organisaatiosta.",
  tallennettu: "Tiedot on tallennettu.",
};

export function SettingsHeader({ active, organizationName, virhe, ok }: { active: string; organizationName: string; virhe?: string; ok?: string }) {
  return (
    <>
      <PageHeader title="Asetukset" subtitle={organizationName} />
      <Tabs items={TABS} active={active} />
      <FormError message={virhe} />
      {ok && OK[ok] ? (
        <div className="mb-5" role="status">
          <Notice tone="ok" title={OK[ok]} />
        </div>
      ) : null}
    </>
  );
}
