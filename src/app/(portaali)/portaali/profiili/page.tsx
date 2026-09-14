import Link from "next/link";
import { FormError } from "@/components/FormError";
import { Button, Field, Input, Notice, Panel, SectionTitle } from "@/components/ui";
import { requirePortal } from "@/lib/auth/current-user";
import { listOwnParties } from "@/lib/settings/profile";
import { saveConsent, saveProfile } from "./actions";

export const metadata = { title: "Omat tiedot" };

export default async function ProfilePage({ searchParams }: { searchParams: Promise<{ virhe?: string; ok?: string }> }) {
  const ctx = await requirePortal();
  const { virhe, ok } = await searchParams;
  const { profile, parties } = await ctx.run(async (tx) => {
    const [profile] = await tx.query<{ full_name: string | null; phone: string | null; email: string }>(
      "select full_name, phone, email from er_users where id = er_current_user_id()",
    );
    return { profile, parties: await listOwnParties(tx) };
  });

  return (
    <>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl">Omat tiedot</h1>
        <Link href="/portaali/oma" className="text-sm text-sky">
          Oma huoneisto
        </Link>
      </div>
      <FormError message={virhe} />
      {ok ? (
        <div className="mb-5" role="status">
          <Notice tone="ok" title="Tiedot on tallennettu." />
        </div>
      ) : null}

      <div className="grid gap-6">
        <Panel>
          <SectionTitle>Yhteystiedot</SectionTitle>
          <form action={saveProfile} className="grid gap-4">
            <Field label="Nimi" htmlFor="full_name">
              <Input id="full_name" name="full_name" defaultValue={profile?.full_name ?? ""} autoComplete="name" />
            </Field>
            <Field label="Puhelin" htmlFor="phone">
              <Input id="phone" name="phone" type="tel" defaultValue={profile?.phone ?? ""} autoComplete="tel" />
            </Field>
            <Field label="Sähköposti" htmlFor="email" hint="Kirjautumisen sähköposti. Muutos tehdään isännöitsijän kautta.">
              <Input id="email" value={profile?.email ?? ctx.user.email} readOnly disabled />
            </Field>
            <div>
              <Button variant="secondary">Tallenna</Button>
            </div>
          </form>
        </Panel>

        <Panel>
          <SectionTitle>Sähköinen kokouskutsu</SectionTitle>
          <p className="mb-4 text-sm text-ink/70">
            Suostumuksella yhtiökokouskutsut ja muut osakkaan ilmoitukset voidaan toimittaa sinulle sähköisesti. Suostumuksen voi perua milloin tahansa.
          </p>
          {parties.length === 0 ? (
            <p className="text-sm text-ink/60">Tunnukseesi ei ole liitetty osakkaan tai asukkaan tietoja.</p>
          ) : (
            <ul className="divide-y divide-line">
              {parties.map((p) => (
                <li key={p.id} className="py-3">
                  <form action={saveConsent} className="flex flex-wrap items-center justify-between gap-3">
                    <input type="hidden" name="party_id" value={p.id} />
                    <label className="flex items-center gap-3">
                      <input type="checkbox" name="consent" defaultChecked={p.electronic_notice_consent} className="size-5" />
                      <span>
                        <span className="font-semibold">{p.display_name}</span>
                        {p.companies ? <span className="block text-sm text-ink/60">{p.companies}</span> : null}
                      </span>
                    </label>
                    <Button variant="secondary">Tallenna</Button>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </>
  );
}
