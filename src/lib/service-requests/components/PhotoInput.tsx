import { MAX_PHOTOS_PER_SUBMIT } from "../limits";

/** Kuvakenttä. Toimii myös ilman JavaScriptiä (silloin kuvaa ei pienennetä). */
export function PhotoInput({ id = "photos", label = "Kuvat", hint }: { id?: string; label?: string; hint?: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-semibold">
        {label}
      </label>
      <input
        id={id}
        name="photos"
        type="file"
        accept="image/*"
        multiple
        className="block w-full rounded-xl border border-dashed border-line bg-paper px-3.5 py-3 text-sm file:mr-3 file:rounded-full file:border-0 file:bg-cloud file:px-4 file:py-2 file:font-semibold"
      />
      <p className="text-xs text-ink/55">{hint ?? `Enintään ${MAX_PHOTOS_PER_SUBMIT} kuvaa kerralla. Sijaintitieto poistetaan kuvista.`}</p>
    </div>
  );
}
