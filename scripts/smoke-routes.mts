import { createHmac } from "node:crypto";

/**
 * Savutesti käynnissä olevaa kehityspalvelinta vasten: käy läpi henkilökunnan
 * ja portaalin pääsivut kehityskirjautumisella ja raportoi virheet.
 *
 *   npx tsx scripts/smoke-routes.mts http://localhost:3107 dev|jukka dev|osakas
 *
 * Kehitystilan istuntoeväste allekirjoitetaan samalla avaimella kuin
 * sovelluksessa (SESSION_SECRET tai kehityksen oletusavain).
 */
const base = process.argv[2] ?? "http://localhost:3000";
const staffSub = process.argv[3] ?? "dev|jukka";
const portalSub = process.argv[4] ?? "dev|osakas";

const key = process.env.SESSION_SECRET ? Buffer.from(process.env.SESSION_SECRET, "base64") : Buffer.alloc(32, 7);
const cookieFor = (sub: string) => `erappu_dev_session=${encodeURIComponent(`${sub}.${createHmac("sha256", key).update(sub).digest("base64url")}`)}`;

async function get(path: string, sub: string) {
  const started = Date.now();
  const res = await fetch(base + path, { headers: { cookie: cookieFor(sub) }, redirect: "manual" });
  const text = res.status === 200 ? await res.text() : "";
  const error = /Application error|Unhandled Runtime Error|Internal Server Error|"digest"/.test(text);
  return { path, status: res.status, error, ms: Date.now() - started, text };
}

const results: { path: string; status: number; error: boolean; ms: number }[] = [];
const check = async (path: string, sub: string) => {
  const r = await get(path, sub);
  results.push(r);
  console.log(`${r.status}${r.error ? " VIRHE" : ""}\t${r.ms} ms\t${path}`);
  return r.text;
};

const list = await check("/taloyhtiot", staffSub);
const companyIds = [...new Set([...list.matchAll(/\/taloyhtiot\/([0-9a-f-]{36})/g)].map((m) => m[1]))];
const cid = companyIds[0];
const units = cid ? await check(`/taloyhtiot/${cid}/huoneistot`, staffSub) : "";
const gid = [...units.matchAll(/\/huoneistot\/([0-9a-f-]{36})/g)].map((m) => m[1])[0];

for (const p of [
  "/tyopoyta", "/haku?q=rinne", "/huoltopyynnot", "/huoltopyynnot/uusi", "/palveluntuottajat", "/htj", "/talous", "/kokoukset",
  "/tiedotteet", "/tiedotteet/uusi", "/tiedotteet/lahetykset", "/dokumentit", "/vuosikello", "/vuosikello/uusi", "/varaukset",
  "/sopimukset", "/sopimukset/uusi", "/kulutus", "/asetukset", "/asetukset/organisaatio",
]) await check(p, staffSub);

const certificates = await check("/todistukset", staffSub);
const orderId = [...certificates.matchAll(/\/todistukset\/([0-9a-f-]{36})/g)].map((m) => m[1])[0];
if (orderId) await check(`/todistukset/${orderId}`, staffSub);

if (cid) {
  for (const tab of [
    "", "/perustiedot", "/muokkaa", "/osakkaat", "/hallitus", "/kiinteisto", "/huolto", "/talous", "/korjaukset", "/kokoukset", "/dokumentit", "/htj", "/htj/yhteenveto",
    "/tiedotteet", "/vuosikello", "/varaukset", "/sopimukset", "/kulutus", "/todistukset",
  ]) {
    await check(`/taloyhtiot/${cid}${tab}`, staffSub);
  }
  if (gid) {
    await check(`/taloyhtiot/${cid}/huoneistot/${gid}`, staffSub);
    await check(`/taloyhtiot/${cid}/talous/huoneisto/${gid}`, staffSub);
  }
  const loans = await check(`/taloyhtiot/${cid}/talous`, staffSub);
  const loanId = [...loans.matchAll(/\/talous\/lainat\/([0-9a-f-]{36})/g)].map((m) => m[1])[0];
  if (loanId) await check(`/taloyhtiot/${cid}/talous/lainat/${loanId}`, staffSub);
  const buildings = await check(`/taloyhtiot/${cid}/kiinteisto`, staffSub);
  const buildingId = [...buildings.matchAll(/kiinteisto\?muokkaa=([0-9a-f-]{36})/g)].map((m) => m[1])[0];
  if (buildingId) await check(`/taloyhtiot/${cid}/kiinteisto?muokkaa=${buildingId}`, staffSub);
}

for (const p of [
  "/portaali", "/portaali/huoltopyynnot", "/portaali/huoltopyynnot/uusi", "/portaali/tiedotteet", "/portaali/dokumentit", "/portaali/varaukset",
  "/portaali/kokoukset", "/portaali/talous", "/portaali/muutostyot", "/portaali/muutostyot/uusi", "/portaali/oma", "/portaali/profiili",
]) await check(p, portalSub);

const bad = results.filter((r) => r.error || r.status >= 400);
console.log(`\n${results.length} sivua, ${bad.length} virhettä.`);
if (bad.length) process.exitCode = 1;
