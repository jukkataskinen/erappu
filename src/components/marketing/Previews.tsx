/**
 * Etusivun näkymät: sovelluksen tilat piirrettynä, ei kuvakaappauksia, jotta
 * ne pysyvät terävinä ja kevyinä. Nimet ja yhtiö ovat eRapun demotiedoista
 * (As Oy Esimerkkirinne), eivät oikeita asiakkaita.
 */

function Dot({ tone }: { tone: "moss" | "amber" | "sky" }) {
  const bg = tone === "moss" ? "bg-moss" : tone === "amber" ? "bg-amber" : "bg-sky";
  return <span aria-hidden="true" className={`inline-block h-2 w-2 shrink-0 rounded-full ${bg}`} />;
}

/** Hallituksen kokous: asialista liitteineen ja allekirjoitukset. */
export function MinutesPreview() {
  const items = [
    { n: 1, title: "Kokouksen avaus" },
    { n: 2, title: "Laillisuus ja päätösvaltaisuus", note: "Läsnä 3/3" },
    { n: 3, title: "Julkisivuremontin urakkatarjoukset", note: "Liite 3.1 · Liite 3.2" },
    { n: 4, title: "Muut asiat" },
    { n: 5, title: "Kokouksen päättäminen" },
  ];
  const signers = [
    { name: "Paula Puheenjohtaja", role: "Puheenjohtaja", done: true },
    { name: "Olli Osakas", role: "Hallituksen jäsen", done: true },
    { name: "Sanna Sihteeri", role: "Hallituksen jäsen", done: false },
  ];
  return (
    <div className="rounded-[var(--radius-panel)] border border-line bg-paper p-5" role="img" aria-label="Esimerkki: hallituksen kokouksen asialista ja pöytäkirjan allekirjoitukset">
      <p className="text-xs text-ink/55">As Oy Esimerkkirinne</p>
      <p className="mt-0.5 font-semibold">Hallituksen kokous 24.9.</p>
      <ol className="mt-4 grid gap-2 text-sm">
        {items.map((i) => (
          <li key={i.n} className="flex gap-2">
            <span className="w-6 shrink-0 text-right tabular-nums text-ink/50">{i.n} §</span>
            <span>
              {i.title}
              {i.note ? <span className="block text-xs text-sky">{i.note}</span> : null}
            </span>
          </li>
        ))}
      </ol>
      <div className="mt-5 border-t border-line pt-4">
        <p className="text-xs font-medium text-ink/60">Pöytäkirjan allekirjoitukset</p>
        <ul className="mt-2 grid gap-1.5 text-sm">
          {signers.map((s) => (
            <li key={s.name} className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-2">
                <Dot tone={s.done ? "moss" : "amber"} />
                {s.name}
                <span className="text-xs text-ink/50">{s.role}</span>
              </span>
              <span className={`text-xs ${s.done ? "text-moss" : "text-amber"}`}>{s.done ? "Allekirjoitettu" : "Odottaa"}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/** Asukkaan portaali puhelimessa: huoltopyynnön tila. */
export function PortalPreview() {
  const steps = [
    { label: "Vastaanotettu", time: "ma 8.12", done: true },
    { label: "Huoltomies tilattu", time: "ma 9.40", done: true },
    { label: "Korjattu", time: "", done: false },
  ];
  return (
    <div className="mx-auto w-full max-w-[300px] rounded-[28px] border border-line bg-paper p-3" role="img" aria-label="Esimerkki: huoltopyynnön tila asukkaan puhelimessa">
      <div className="rounded-[20px] bg-cloud p-4">
        <p className="text-xs text-ink/55">Huoltopyyntö · A 4</p>
        <p className="mt-0.5 font-semibold">Keittiön hana vuotaa</p>
        <div className="mt-3 h-24 rounded-xl border border-line bg-paper" aria-hidden="true">
          <svg viewBox="0 0 120 60" className="h-full w-full text-ink/25">
            <path d="M40 40 h40 M60 40 v-18 h18 v6" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" />
            <circle cx="78" cy="36" r="2.5" fill="var(--color-sky)" />
            <circle cx="78" cy="44" r="2" fill="var(--color-sky)" />
          </svg>
        </div>
        <ol className="mt-4 grid gap-2 text-sm">
          {steps.map((s) => (
            <li key={s.label} className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2">
                <Dot tone={s.done ? "moss" : "sky"} />
                {s.label}
              </span>
              <span className="text-xs text-ink/50">{s.time || "tulossa"}</span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

/** Isännöitsijäntodistus: mitä siihen kootaan itsestään. */
export function CertificatePreview() {
  const rows = [
    ["Osakkeet", "427–472 · 46 kpl"],
    ["Hoitovastike", "138 € / kk"],
    ["Lainaosuus", "Ei maksamatonta osuutta"],
    ["Maksutilanne", "Ei erääntyneitä maksuja"],
    ["Liitteet", "Tilinpäätös, PTS, energiatodistus"],
  ];
  return (
    <div className="rounded-[var(--radius-panel)] border border-line bg-paper p-5" role="img" aria-label="Esimerkki: isännöitsijäntodistuksen tiedot">
      <p className="text-xs text-ink/55">As Oy Esimerkkirinne · huoneisto 9</p>
      <p className="mt-0.5 font-semibold">Isännöitsijäntodistus</p>
      <dl className="mt-4 grid gap-2 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-4 border-t border-line pt-2">
            <dt className="text-ink/60">{k}</dt>
            <dd className="text-right">{v}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-4 flex items-center gap-2 text-xs text-moss">
        <Dot tone="moss" /> Sinetöity sähköisesti
      </p>
    </div>
  );
}
