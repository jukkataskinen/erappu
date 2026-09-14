import { Badge, Notice, Table, Td, Th } from "@/components/ui";
import { requireSettingsAccess } from "@/lib/settings/guard";
import { integrationStatuses } from "@/lib/settings/integrations";
import { SettingsHeader } from "../SettingsHeader";

export const metadata = { title: "Asetukset: integraatiot" };

export default async function IntegrationsPage() {
  const ctx = await requireSettingsAccess();
  const items = integrationStatuses();
  return (
    <>
      <SettingsHeader active="integraatiot" organizationName={ctx.org.organizationName} />
      <div className="mb-5">
        <Notice tone="info" title="Vain tila">
          Integraatiot määritetään palvelimen ympäristömuuttujissa. Avaimia tai tunnuksia ei näytetä tässä.
        </Notice>
      </div>
      <Table>
        <thead>
          <tr>
            <Th>Integraatio</Th>
            <Th>Tila</Th>
            <Th>Asetus</Th>
            <Th>Käyttöönotto</Th>
          </tr>
        </thead>
        <tbody>
          {items.map((i) => (
            <tr key={i.key}>
              <Td>
                <p className="font-semibold">{i.label}</p>
                <p className="text-ink/60">{i.description}</p>
              </Td>
              <Td>
                <Badge tone={i.live ? "ok" : "warn"}>{i.statusLabel}</Badge>
              </Td>
              <Td>
                <code className="text-xs">
                  {i.key}={i.mode}
                </code>
              </Td>
              <Td>{i.blocker ?? "–"}</Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </>
  );
}
