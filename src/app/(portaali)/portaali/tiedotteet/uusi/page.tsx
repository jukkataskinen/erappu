import Link from "next/link";
import { redirect } from "next/navigation";
import { FormError } from "@/components/FormError";
import { Button, Field, Input, Panel, Select, Textarea } from "@/components/ui";
import { requirePortal } from "@/lib/auth/current-user";
import { AUDIENCE_LABEL, AUDIENCE_ROLES } from "@/lib/announcements/labels";
import { createBoardDraft } from "../actions";

export const metadata = { title: "Tiedoteluonnos" };

export default async function BoardDraftPage({ searchParams }: { searchParams: Promise<{ virhe?: string }> }) {
  const ctx = await requirePortal();
  const boardCompanies = ctx.companies.filter((c) => c.roles.includes("board"));
  if (boardCompanies.length === 0) redirect("/portaali/tiedotteet");
  const { virhe } = await searchParams;

  return (
    <>
      <Link href="/portaali/tiedotteet" className="mb-3 inline-block text-sm text-ink/60 hover:text-ink">
        ← Tiedotteet
      </Link>
      <h1 className="text-2xl">Tiedoteluonnos</h1>
      <p className="mb-5 mt-1 text-ink/65">Luonnos menee isännöitsijälle, joka tarkistaa sen ja julkaisee tiedotteen.</p>
      <FormError message={virhe} />
      <Panel>
        <form action={createBoardDraft} className="grid gap-4">
          {boardCompanies.length === 1 ? (
            <input type="hidden" name="company_id" value={boardCompanies[0].id} />
          ) : (
            <Field label="Taloyhtiö" htmlFor="company_id">
              <Select id="company_id" name="company_id" defaultValue="" required>
                <option value="" disabled>
                  Valitse yhtiö
                </option>
                {boardCompanies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Field label="Otsikko" htmlFor="title">
            <Input id="title" name="title" maxLength={200} required />
          </Field>
          <Field label="Teksti" htmlFor="body" hint="Älä kirjoita henkilötunnuksia tai yksittäisen asukkaan asioita.">
            <Textarea id="body" name="body" rows={8} maxLength={20000} required />
          </Field>
          <fieldset>
            <legend className="mb-2 text-sm font-semibold">Kenelle</legend>
            <div className="flex flex-wrap gap-4">
              {AUDIENCE_ROLES.map((r) => (
                <label key={r} className="flex min-h-[var(--size-touch)] items-center gap-2 text-sm">
                  <input type="checkbox" name="audience_roles" value={r} defaultChecked={r !== "board"} className="size-5" />
                  {AUDIENCE_LABEL[r]}
                </label>
              ))}
            </div>
          </fieldset>
          <label className="flex min-h-[var(--size-touch)] items-center gap-2 text-sm">
            <input type="checkbox" name="email" defaultChecked className="size-5" />
            Ehdota lähetettäväksi myös sähköpostina
          </label>
          <Field label="Voimassa asti (valinnainen)" htmlFor="valid_until">
            <Input id="valid_until" name="valid_until" type="date" />
          </Field>
          <div>
            <Button className="w-full sm:w-auto">Lähetä isännöitsijälle</Button>
          </div>
        </form>
      </Panel>
    </>
  );
}
