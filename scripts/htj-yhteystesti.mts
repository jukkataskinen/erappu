/**
 * HTJ-yhteystesti koeympäristöön: mTLS-varmenne, palomuuri ja
 * järjestelmälupa. Tulostaa vain HTTP-tilan ja MML:n virheviestin, ei
 * vastausten tietosisältöä.
 *
 *   HTJ_CLIENT_CERT_FILE=data/private/htj/<varmenne>.crt \
 *   HTJ_CLIENT_KEY_FILE=data/private/htj/<varmenne>.key \
 *   HTJ_ISANNOINTITAHO=<järjestelmäluvituksesta saatu isännöintitahon tunniste> \
 *   npm run htj:yhteystesti -- <testiyhtiön Y-tunnus>
 *
 * Oletusosoite on koeympäristö (htj-ext-koe.nls.fi). Varmenne ja avain ovat
 * git-ohitetussa kansiossa data/private; niitä ei tulosteta.
 */
process.env.HTJ_BASE_URL ||= "https://htj-ext-koe.nls.fi/htj1/isannointi/v1";

// server-only-moduuli estää tuonnin Next.js:n ulkopuolella; skriptissä se ohitetaan.
const { register } = await import("node:module");
register("data:text/javascript,export async function resolve(s,c,n){return s==='server-only'?{url:'data:text/javascript,',shortCircuit:true}:n(s,c)}");

const { mmlConnectionCheck } = await import("../src/lib/htj/mml.ts");
const bid = process.argv[2];
if (!bid || !/^\d{7}-\d$/.test(bid)) {
  console.error("Anna testiyhtiön Y-tunnus, esim. npm run htj:yhteystesti -- 1234567-8");
  process.exit(1);
}

try {
  const r = await mmlConnectionCheck(bid);
  const meaning =
    r.status === 200
      ? "OK: yhteys ja järjestelmälupa toimivat."
      : r.status === 403
        ? "Varmenne ja palomuuri kunnossa, mutta järjestelmälupa puuttuu tälle yhtiölle."
        : r.status === 400
          ? "Pyyntö hylättiin (otsake tai parametri)."
          : "Odottamaton vastaus.";
  console.log(`HTTP ${r.status}${r.message ? ` – ${r.message}` : ""}\n${meaning}`);
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
