import { notFound } from "next/navigation";
import { Brand } from "@/components/Brand";
import { FormError } from "@/components/FormError";
import { Button, Field, Input, Notice, Panel, Select, Textarea } from "@/components/ui";
import { getDb } from "@/lib/db";
import { CATEGORIES, CATEGORY_LABEL } from "@/lib/service-requests/labels";
import { emergencyContactForCompany, resolvePublicForm } from "@/lib/service-requests/links";
import { submitPublicRequest } from "./actions";

export const metadata = { title: "Huoltopyyntö" };
export const dynamic = "force-dynamic";

export default async function PublicRequestPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ virhe?: string; kiitos?: string }> }) {
  const { token } = await params;
  const { virhe, kiitos } = await searchParams;
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) notFound();
  const db = await getDb();
  const data = await db.asService(async (tx) => {
    const target = await resolvePublicForm(tx, token);
    if (!target) return null;
    return { target, emergency: await emergencyContactForCompany(tx, target) };
  });
  if (!data) notFound();
  const { target, emergency } = data;
  const thanks = kiitos && /^\d{1,9}$/.test(kiitos) ? kiitos : null;

  return (
    <div className="mx-auto flex min-h-dvh max-w-xl flex-col px-5 py-8">
      <Brand />
      <h1 className="mt-6 text-2xl">Huoltopyyntö</h1>
      <p className="mt-1 text-ink/70">{target.companyName}</p>

      <div className="mt-5">
        <Notice tone="alert" title="Vesivuoto tai muu kiireellinen vaara">
          Soita heti päivystykseen{emergency ? (
            <>
              : <a href={`tel:${emergency.phone.replace(/[^+0-9]/g, "")}`} className="font-semibold underline">{emergency.phone}</a> ({emergency.name})
            </>
          ) : " (numero porraskäytävän ilmoitustaululla)"}. Sulje vesi, jos pystyt. Lomake käsitellään virka-aikana.
        </Notice>
      </div>

      {thanks ? (
        <Panel className="mt-6">
          <p className="text-lg font-semibold">Kiitos, pyyntö #{thanks} on vastaanotettu</p>
          <p className="mt-2 text-sm text-ink/70">Isännöinti käsittelee pyynnön. Jos annoit sähköpostiosoitteen, saat tiedon, kun tila muuttuu.</p>
        </Panel>
      ) : (
        <Panel className="mt-6">
          <FormError message={virhe} />
          <form action={submitPublicRequest} className="grid gap-4">
            <input type="hidden" name="token" value={token} />
            {/* Roskapostiansa: piilotettu ihmisiltä ja ruudunlukijoilta. */}
            <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
              <label htmlFor="website">Jätä tyhjäksi</label>
              <input id="website" name="website" tabIndex={-1} autoComplete="off" />
            </div>
            <Field label="Aihe" htmlFor="category">
              <Select id="category" name="category" required defaultValue="">
                <option value="" disabled>
                  Valitse aihe
                </option>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_LABEL[c]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Mikä on vialla?" htmlFor="description">
              <Textarea id="description" name="description" required minLength={5} maxLength={5000} rows={5} placeholder="Esim. kylpyhuoneen lattiakaivo haisee ja vesi valuu hitaasti" />
            </Field>
            <Field label="Huoneisto tai tila" htmlFor="unit_text" hint="Esim. B 12, sauna, pihakeinu">
              <Input id="unit_text" name="unit_text" required maxLength={60} />
            </Field>
            <Field label="Nimi" htmlFor="reporter_name">
              <Input id="reporter_name" name="reporter_name" required maxLength={200} autoComplete="name" />
            </Field>
            <Field label="Puhelin" htmlFor="reporter_phone" hint="Huoltomies voi soittaa ennen käyntiä">
              <Input id="reporter_phone" name="reporter_phone" type="tel" maxLength={40} autoComplete="tel" />
            </Field>
            <Field label="Sähköposti" htmlFor="reporter_email" hint="Saat vahvistuksen ja tiedon tilamuutoksista">
              <Input id="reporter_email" name="reporter_email" type="email" maxLength={254} autoComplete="email" />
            </Field>
            <p className="text-xs text-ink/55">Tietojasi käytetään vain tämän huoltopyynnön käsittelyyn.</p>
            <Button type="submit" className="w-full">
              Lähetä pyyntö
            </Button>
          </form>
        </Panel>
      )}
    </div>
  );
}
