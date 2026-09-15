import { Brand } from "@/components/Brand";
import { FormError } from "@/components/FormError";
import { Button, Field, Input, Notice, Panel, Select } from "@/components/ui";
import { CERTIFICATE_EXPRESS_PRICE_EUR, CERTIFICATE_KIND, CERTIFICATE_PRICE_EUR } from "@/lib/certificates/pricing";
import { getDb } from "@/lib/db";
import { formatEur } from "@/lib/format";
import { resolveAccessLink } from "@/lib/security/access-links";
import { submitCertificateOrder } from "./actions";
import { PurposeFields } from "@/components/certificates/PurposeFields";

export const metadata = { title: "Tilaa isännöitsijäntodistus", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * Julkinen tilauslomake. Linkki ratkaistaan palvelun roolilla, ja sivulle
 * näytetään vain yhtiön nimi ja huoneistotunnukset: ei omistajia eikä muita
 * henkilötietoja.
 */
export default async function CertificateOrderPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ virhe?: string; valmis?: string }> }) {
  const { token } = await params;
  const { virhe, valmis } = await searchParams;
  const db = await getDb();
  const data = await db.asService(async (tx) => {
    const link = await resolveAccessLink(tx, token, "certificate_order");
    if (!link || link.subjectTable !== "er_housing_companies") return null;
    const [company] = await tx.query<{ name: string; city: string | null; org_name: string }>(
      `select c.name, c.city, o.name as org_name from er_housing_companies c join er_organizations o on o.id = c.organization_id
        where c.id = $1 and c.organization_id = $2`,
      [link.subjectId, link.organizationId],
    );
    if (!company) return null;
    const groups = await tx.query<{ id: string; unit_label: string }>(
      "select id, unit_label from er_share_groups where company_id = $1 and removed_on is null order by length(unit_label), unit_label",
      [link.subjectId],
    );
    return { company, groups };
  });

  return (
    <div className="mx-auto flex min-h-dvh max-w-xl flex-col px-5 py-10">
      <Brand size={26} />
      {!data ? (
        <div className="mt-8">
          <Notice tone="alert" title="Linkki ei ole voimassa">
            Tilauslinkki on vanhentunut tai poistettu käytöstä. Pyydä uusi linkki isännöitsijältä.
          </Notice>
        </div>
      ) : valmis ? (
        <div className="mt-8">
          <h1 className="text-2xl">Kiitos tilauksesta</h1>
          <p className="mt-2 text-ink/70">Tilaus on vastaanotettu. Saat vahvistuksen sähköpostiisi, ja ilmoitamme, kun todistus on valmis.</p>
        </div>
      ) : (
        <>
          <h1 className="mt-8 text-2xl sm:text-3xl">Tilaa isännöitsijäntodistus</h1>
          <p className="mt-2 text-ink/70">
            {data.company.name}
            {data.company.city ? `, ${data.company.city}` : ""} · isännöinti {data.company.org_name}
          </p>
          <div className="mt-6">
            <FormError message={virhe} />
          </div>
          <Panel>
            <form action={submitCertificateOrder} className="grid gap-4">
              <input type="hidden" name="token" value={token} />
              <div className="hidden" aria-hidden>
                <label htmlFor="website">Jätä tyhjäksi</label>
                <input id="website" name="website" tabIndex={-1} autoComplete="off" />
              </div>
              <Field label="Huoneisto" htmlFor="share_group_id">
                <Select id="share_group_id" name="share_group_id" required defaultValue="">
                  <option value="" disabled>
                    Valitse huoneisto
                  </option>
                  {data.groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.unit_label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Todistus" htmlFor="kind">
                <Select id="kind" name="kind" defaultValue="manager_certificate">
                  {Object.entries(CERTIFICATE_KIND).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </Select>
              </Field>
              <PurposeFields />
              <Field label="Nimi" htmlFor="orderer_name">
                <Input id="orderer_name" name="orderer_name" required autoComplete="name" />
              </Field>
              <Field label="Sähköposti" htmlFor="orderer_email">
                <Input id="orderer_email" name="orderer_email" type="email" required autoComplete="email" />
              </Field>
              <Field label="Puhelin" htmlFor="orderer_phone">
                <Input id="orderer_phone" name="orderer_phone" type="tel" autoComplete="tel" />
              </Field>
              <div className="rounded-xl border border-line bg-cloud/60 p-4 text-sm">
                <p>
                  Hinta <span className="font-semibold">{formatEur(CERTIFICATE_PRICE_EUR)}</span>, pikatoimitus{" "}
                  <span className="font-semibold">{formatEur(CERTIFICATE_EXPRESS_PRICE_EUR)}</span>.
                </p>
                <label className="mt-3 flex items-center gap-2">
                  <input type="checkbox" name="express" /> Pikatoimitus
                </label>
              </div>
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" name="terms" required className="mt-1" />
                <span>Hyväksyn, että todistus laskutetaan hinnaston mukaan ja että tietojani käytetään tilauksen käsittelyyn.</span>
              </label>
              <div>
                <Button>Lähetä tilaus</Button>
              </div>
            </form>
          </Panel>
          <p className="mt-4 text-xs text-ink/55">Todistuksen omistaja- ja panttaustiedot tarkistetaan huoneistotietojärjestelmästä.</p>
        </>
      )}
    </div>
  );
}
