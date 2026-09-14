import Link from "next/link";
import { FormError } from "@/components/FormError";
import { Button, EmptyState, Field, Input, Select, Textarea } from "@/components/ui";
import { requirePortal } from "@/lib/auth/current-user";
import { WORK_TYPE_LABELS } from "@/lib/maintenance/work-types";
import { submitRenovationNotice } from "../actions";

export const metadata = { title: "Uusi muutostyöilmoitus" };

export default async function NewRenovationNoticePage({ searchParams }: { searchParams: Promise<{ virhe?: string }> }) {
  const ctx = await requirePortal();
  const { virhe } = await searchParams;
  const units = [...new Map(ctx.user.portal.filter((g) => g.role === "owner" && g.shareGroupId).map((g) => [g.shareGroupId, g])).values()];

  return (
    <>
      <Link href="/portaali/muutostyot" className="text-sm text-ink/60 hover:text-ink">
        ← Muutostyöt
      </Link>
      <h1 className="mt-2 text-2xl">Muutostyöilmoitus</h1>
      <p className="mt-2 text-sm text-ink/65">Kerro, mitä aiot tehdä. Isännöitsijä käsittelee ilmoituksen ja voi pyytää lisätietoja tai asettaa työlle ehtoja.</p>
      <div className="mt-5">
        <FormError message={virhe} />
      </div>
      {units.length === 0 ? (
        <EmptyState title="Ei huoneistoa">Muutostyöilmoituksen voi tehdä vain huoneiston osakas.</EmptyState>
      ) : (
        <form action={submitRenovationNotice} className="grid gap-4">
          <Field label="Huoneisto" htmlFor="share_group_id">
            <Select id="share_group_id" name="share_group_id" required defaultValue={units.length === 1 ? units[0].shareGroupId! : ""}>
              {units.length > 1 ? (
                <option value="" disabled>
                  Valitse
                </option>
              ) : null}
              {units.map((u) => (
                <option key={u.shareGroupId} value={u.shareGroupId!}>
                  {u.companyName}, {u.unitLabel}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Työlaji" htmlFor="work_type">
            <Select id="work_type" name="work_type" defaultValue="">
              <option value="">Valitse</option>
              {WORK_TYPE_LABELS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Kuvaus" htmlFor="description" hint="Mitä tehdään, missä tiloissa, kuka tekee työn ja tarvitaanko esim. vedenkatkoa.">
            <Textarea id="description" name="description" required minLength={10} maxLength={4000} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Aloitus" htmlFor="planned_start">
              <Input id="planned_start" name="planned_start" type="date" />
            </Field>
            <Field label="Valmistuu" htmlFor="planned_end">
              <Input id="planned_end" name="planned_end" type="date" />
            </Field>
          </div>
          <p className="text-xs text-ink/55">Liitä suunnitelmat tai urakoitsijan tiedot tarvittaessa isännöitsijän pyynnöstä.</p>
          <div>
            <Button className="w-full sm:w-auto">Lähetä ilmoitus</Button>
          </div>
        </form>
      )}
    </>
  );
}
