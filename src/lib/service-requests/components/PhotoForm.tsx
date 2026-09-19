"use client";

import { useState, useTransition, type FormEvent, type ReactNode } from "react";

/**
 * Lomake, joka pienentää valitut kuvat selaimessa ennen lähetystä.
 *
 * Puhelimen kuva on 3–8 Mt, ja palvelintoiminnon oletusraja on 1 Mt.
 * Canvasin kautta piirretty JPEG on noin 200–400 kt, se kääntyy oikein päin
 * ja siitä putoaa EXIF (sijainti). HEIC muuttuu samalla JPEG:ksi. Palvelin
 * tarkistaa ja siivoaa kuvan silti uudelleen, koska tämän voi ohittaa.
 */

const MAX_EDGE = 1600;
const QUALITY = 0.8;

async function compress(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas");
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", QUALITY));
    if (!blob) throw new Error("toBlob");
    return blob;
  } finally {
    bitmap.close();
  }
}

export function PhotoForm({
  action,
  children,
  className,
  field = "photos",
  fieldPrefix,
}: {
  action: (formData: FormData) => Promise<void>;
  children: ReactNode;
  className?: string;
  field?: string;
  /** Myös kentät, joiden nimi alkaa tällä (esim. "photo_" + mittarin id). */
  fieldPrefix?: string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const data = new FormData(event.currentTarget, submitter);
    const keys = [...new Set([...data.keys()].filter((k) => k === field || (fieldPrefix !== undefined && k.startsWith(fieldPrefix))))];
    try {
      for (const key of keys) {
        const files = data.getAll(key).filter((v): v is File => v instanceof File && v.size > 0);
        data.delete(key);
        for (const file of files) {
          let blob: Blob = file;
          try {
            blob = await compress(file);
          } catch {
            // Selain ei osannut purkaa kuvaa: lähetetään sellaisenaan, palvelin päättää.
          }
          data.append(key, blob, blob === file ? file.name : "kuva.jpg");
        }
      }
    } catch {
      setError("Kuvien käsittely ei onnistunut. Yritä uudelleen.");
      return;
    }
    startTransition(async () => {
      await action(data);
    });
  }

  return (
    <form action={action} onSubmit={onSubmit} className={className}>
      <fieldset disabled={pending} className="contents">
        {children}
      </fieldset>
      {pending ? <p className="mt-2 text-sm text-ink/60" aria-live="polite">Lähetetään…</p> : null}
      {error ? (
        <p role="alert" className="mt-2 text-sm text-coral">
          {error}
        </p>
      ) : null}
    </form>
  );
}
