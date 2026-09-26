import { Badge, Button, Field, Select } from "@/components/ui";
import { formatDateTime, formatEur } from "@/lib/format";
import type { LetterJobRow } from "@/lib/letters/jobs";
import { LETTER_JOB_STATUS, POST_CLASS_LABEL } from "@/lib/letters/labels";
import { estimatePrice, LETTER_PRICE_EUR } from "@/lib/postita";
import { cancelLetterJobAction, confirmLetterJobAction, refreshLetterJobAction } from "@/app/(henkilokunta)/kirjeet/actions";

/**
 * Postitan kirjetyöt kokous- ja tiedotesivulla: lataus vedokseksi,
 * vahvistus, peruutus ja tilan päivitys. Sama näkymä molemmissa, jotta
 * paperikirjeen kulku on sama riippumatta siitä, mitä lähetetään.
 */
export function LetterJobs({
  jobs,
  readyCount,
  blocker,
  canManage,
  back,
  uploadAction,
  hidden,
  previewHref,
  mock,
}: {
  jobs: LetterJobRow[];
  readyCount: number;
  blocker: string | null;
  canManage: boolean;
  back: string;
  uploadAction: (formData: FormData) => Promise<void>;
  hidden: Record<string, string>;
  previewHref: string;
  mock: boolean;
}) {
  const visible = jobs.filter((j) => j.status !== "failed" || jobs.indexOf(j) === 0);
  return (
    <div className="mt-4 grid gap-3" id="kirjeet">
      <p className="text-xs text-ink/55">
        Kirjeet postittaa Postita.fi: tulostus mustavalkoisena, isoikkunainen C5-kuori ja postimaksu (Postitan hinta {formatEur(LETTER_PRICE_EUR[2])} 2. lk tai {formatEur(LETTER_PRICE_EUR[1])}
        1. lk kirjeeltä alv 0, lisäsivu 0,16 €). Kirjeet ladataan ensin vahvistamattomina, ja postitus vahvistetaan vasta, kun vedos on tarkistettu. Vahvistetut lähtevät seuraavana
        arkipäivänä.
        {mock ? " Kirjepalvelu on testitilassa: mitään ei tulosteta eikä lähetetä." : ""}
      </p>
      <div className="flex flex-wrap gap-2 text-xs">
        <a href={`${previewHref}?tyyppi=vedos`} target="_blank" rel="noopener" className="inline-flex min-h-9 items-center rounded-full border border-line bg-paper px-4 font-semibold hover:border-ink/30">
          Kirjeiden vedos (PDF)
        </a>
        <a href={`${previewHref}?tyyppi=koe`} target="_blank" rel="noopener" className="inline-flex min-h-9 items-center rounded-full border border-line bg-paper px-4 font-semibold hover:border-ink/30">
          Koetuloste ikkunakuoren tarkistukseen
        </a>
      </div>

      {visible.map((j) => {
        const status = LETTER_JOB_STATUS[j.status];
        return (
          <div key={j.id} className="rounded-xl border border-line bg-cloud/40 p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={status.tone}>{status.label}</Badge>
              <span className="font-semibold">
                {j.letter_count} {j.letter_count === 1 ? "kirje" : "kirjettä"}
              </span>
              <span className="text-ink/60">
                {POST_CLASS_LABEL[j.post_class]}, {j.pages_per_letter} {j.pages_per_letter === 1 ? "sivu" : "sivua"} kirjeessä
                {j.status === "CA" || j.status === "failed"
                  ? ""
                  : j.price !== null
                    ? `, Postita ${formatEur(j.price)} alv 0`
                    : `, Postita arviolta ${formatEur(estimatePrice(j.letter_count, j.pages_per_letter, j.post_class))} alv 0`}
                {j.charge_total_eur !== null && j.status !== "CA" ? `, veloitus yhtiöltä ${formatEur(j.charge_total_eur)} alv 0` : ""}
              </span>
              {j.billing_invoice_id ? <Badge tone="ok">Laskutettu</Badge> : null}
              {j.provider === "mock" ? <Badge>Testitila</Badge> : null}
            </div>
            <p className="mt-1 text-xs text-ink/55">
              Ladattu {formatDateTime(j.created_at)}
              {j.created_by_name ? `, ${j.created_by_name}` : ""}
              {j.confirmed_at ? ` · vahvistettu ${formatDateTime(j.confirmed_at)}${j.confirmed_by_name ? `, ${j.confirmed_by_name}` : ""}` : ""}
              {j.cancelled_at ? ` · peruttu ${formatDateTime(j.cancelled_at)}` : ""}
              {j.provider_job_id && j.provider === "postita" ? ` · Postitan työ ${j.provider_job_id}` : ""}
            </p>
            {canManage && ["NE", "CO", "PR"].includes(j.status) ? (
              <div className="mt-2 flex flex-wrap gap-2">
                {j.status === "NE" ? (
                  <form action={confirmLetterJobAction}>
                    <input type="hidden" name="job_id" value={j.id} />
                    <input type="hidden" name="back" value={back} />
                    <Button>Vahvista postitus</Button>
                  </form>
                ) : null}
                {(j.status === "NE" || j.status === "CO") && !j.billing_invoice_id ? (
                  <form action={cancelLetterJobAction}>
                    <input type="hidden" name="job_id" value={j.id} />
                    <input type="hidden" name="back" value={back} />
                    <Button variant="secondary">Peru kirjeet</Button>
                  </form>
                ) : null}
                {j.provider === "postita" ? (
                  <form action={refreshLetterJobAction}>
                    <input type="hidden" name="job_id" value={j.id} />
                    <input type="hidden" name="back" value={back} />
                    <Button variant="secondary">Päivitä tila</Button>
                  </form>
                ) : null}
              </div>
            ) : null}
            {j.status === "NE" && j.provider === "postita" ? <p className="mt-2 text-xs text-ink/55">Tarkista vedos Postitan palvelussa (postita.fi) ennen vahvistusta.</p> : null}
          </div>
        );
      })}

      {canManage && !blocker ? (
        <form action={uploadAction} className="flex flex-wrap items-end gap-3 rounded-xl border border-line p-3">
          {Object.entries(hidden).map(([name, value]) => (
            <input key={name} type="hidden" name={name} value={value} />
          ))}
          <Field label="Postiluokka" htmlFor="post_class">
            <Select id="post_class" name="post_class" defaultValue="2">
              <option value="2">2. luokka</option>
              <option value="1">1. luokka</option>
            </Select>
          </Field>
          <Button>
            Lataa {readyCount} {readyCount === 1 ? "kirje" : "kirjettä"} Postitaan
          </Button>
          <p className="w-full text-xs text-ink/55">Kirjeet eivät lähde vielä: ne odottavat vahvistusta. Postitus laskutetaan taloyhtiöltä organisaation kirjehinnalla, joka lukitaan vahvistettaessa.</p>
        </form>
      ) : blocker && canManage && readyCount > 0 ? (
        <p className="text-sm text-ink/65">{blocker}</p>
      ) : null}
      {!canManage && readyCount > 0 ? <p className="text-sm text-ink/60">Kirjeet lähettää pääkäyttäjä tai isännöitsijä.</p> : null}
    </div>
  );
}
