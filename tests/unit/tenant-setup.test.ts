import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { auth0LoginHref, isStaffConnectionSub, PORTAL_CONNECTION, STAFF_CONNECTION } from "@/lib/auth/login-params";
import {
  AUTH0_TUOTANTOMUUTTUJAT,
  PAKOLLISET_OIKEUDET,
  puuttuvatOikeudet,
  tokeninOikeudet,
  ylimaaraisetYhteydet,
  authModeVoidaanVaihtaa,
  lueYmparistoArvo,
  mfaActionKoodi,
  osoitteetPuuttuvat,
  paivitaYmparisto,
  passwordlessAsetukset,
  sidoksetActionille,
  sovellusOsoitteet,
  tenanttiOnTyhja,
  tietokantayhteydenAsetukset,
  vercelMuuttujat,
  vercelSuunnitelma,
  vieraatSovellukset,
} from "@/lib/auth/tenant-setup";

/*
  Asetusskripti ajetaan käsin, harvoin ja jännittyneenä. Nämä testit koskevat
  vahingon estämistä ja hiljaa väärää asetusta, eivät ominaisuutta.
*/
describe("vieraatSovellukset", () => {
  it("hyväksyy tyhjän tenantin ja Auth0:n omat sovellukset", () => {
    expect(vieraatSovellukset([], ["eRappu"])).toEqual([]);
    expect(vieraatSovellukset([{ client_id: "a", name: "Default App" }], ["eRappu"])).toEqual([]);
  });

  /* erappu.eu.auth0.com 2026-09-15, luettu Management API:lla. */
  it("hyväksyy oikean tenantin nykyiset sovellukset", () => {
    const clients = [
      { client_id: "a", name: "Default App" },
      { client_id: "b", name: "Asetusskripti" },
      { client_id: "c", name: "All Applications" },
    ];
    expect(vieraatSovellukset(clients, ["eRappu", "Asetusskripti"])).toEqual([]);
  });

  it("hyväksyy odotetut sovellukset kirjainkoosta riippumatta", () => {
    const clients = [
      { client_id: "a", name: "erappu" },
      { client_id: "b", name: "Asetusskripti" },
    ];
    expect(vieraatSovellukset(clients, ["eRappu", "Asetusskripti"])).toEqual([]);
  });

  it("PYSÄYTTÄÄ, jos tenantissa on muiden projektien sovelluksia", () => {
    const clients = [
      { client_id: "a", name: "eRappu" },
      { client_id: "b", name: "eSinetti" },
      { client_id: "c", name: "Adepta SKOG" },
    ];
    const vieraat = vieraatSovellukset(clients, ["eRappu", "Asetusskripti"]);
    expect(vieraat).toEqual(["Adepta SKOG", "eSinetti"]);
    expect(tenanttiOnTyhja(vieraat)).toBe(false);
  });
});

describe("sovellusOsoitteet", () => {
  const perustat = ["http://localhost:3107", "https://www.erappu.fi/", "https://erappu.vercel.app", "https://www.erappu.fi", ""];

  it("paluuosoite SDK:n reitille jokaiselle perustalle, ilman kaksoiskappaleita ja loppukauttaviivaa", () => {
    const osoitteet = sovellusOsoitteet(perustat);
    expect(osoitteet.callbacks).toEqual([
      "http://localhost:3107/auth/callback",
      "https://www.erappu.fi/auth/callback",
      "https://erappu.vercel.app/auth/callback",
    ]);
    expect(osoitteet.allowed_logout_urls).toEqual(["http://localhost:3107", "https://www.erappu.fi", "https://erappu.vercel.app"]);
    expect(osoitteet.web_origins).toEqual(osoitteet.allowed_logout_urls);
  });

  it("huomaa puuttuvan osoitteen, mutta ei välitä järjestyksestä", () => {
    const halutut = sovellusOsoitteet(perustat);
    expect(osoitteetPuuttuvat({ ...halutut, callbacks: [...halutut.callbacks].reverse() }, halutut)).toBe(false);
    expect(osoitteetPuuttuvat({ ...halutut, web_origins: [] }, halutut)).toBe(true);
    expect(osoitteetPuuttuvat({}, halutut)).toBe(true);
  });
});

describe("tietokantayhteys (henkilökunta)", () => {
  it("nostaa politiikan tasolle good, suojaa brute forcelta ja estää rekisteröitymisen", () => {
    const { options, muutokset } = tietokantayhteydenAsetukset({ passwordPolicy: "fair", mfa: { active: true } });
    expect(options).toMatchObject({ passwordPolicy: "good", brute_force_protection: true, disable_signup: true });
    expect(options.mfa).toEqual({ active: true });
    expect(muutokset).toHaveLength(3);
  });

  it("ei heikennä vahvempaa politiikkaa eikä ilmoita muutoksia, kun kaikki on kunnossa", () => {
    const nyt = { passwordPolicy: "excellent", brute_force_protection: true, disable_signup: true };
    const { options, muutokset } = tietokantayhteydenAsetukset(nyt);
    expect(options.passwordPolicy).toBe("excellent");
    expect(muutokset).toEqual([]);
  });

  it("tuntematon tai puuttuva politiikka tulkitaan heikoksi", () => {
    expect(tietokantayhteydenAsetukset({}).options.passwordPolicy).toBe("good");
    expect(tietokantayhteydenAsetukset({ passwordPolicy: "outo" }).options.passwordPolicy).toBe("good");
  });
});

describe("passwordless (portaali)", () => {
  const arvot = { lahettaja: "noreply@erappu.fi", aihe: "aihe", pohja: "<p>{{ code }}</p>" };

  it("kirjoittaa sisäkkäiseen rakenteeseen ja olemassa olevaan template-kenttään", () => {
    const { options, rakenne } = passwordlessAsetukset({ email: { from: "root@auth0.com", template: "vanha" }, totp: { length: 6 } }, arvot);
    expect(rakenne).toBe("options.email");
    expect(options.email).toMatchObject({ from: "noreply@erappu.fi", subject: "aihe", syntax: "liquid", template: arvot.pohja });
    expect(options.totp).toEqual({ length: 6 });
  });

  it("kirjoittaa litteään rakenteeseen body-kenttään", () => {
    const { options, rakenne } = passwordlessAsetukset({ from: "root@auth0.com" }, arvot);
    expect(rakenne).toBe("options");
    expect(options).toMatchObject({ from: "noreply@erappu.fi", body: arvot.pohja });
  });

  /* Portaalikäyttäjän Auth0-tunnus syntyy kutsun jälkeisellä ensimmäisellä kirjautumisella. */
  it("sallii rekisteröitymisen", () => {
    expect(passwordlessAsetukset({ disable_signup: true }, arvot).options.disable_signup).toBe(false);
  });

  it("ei ilmoita muutosta, kun asetukset ovat jo oikein", () => {
    const { options } = passwordlessAsetukset({ from: "x" }, arvot);
    expect(passwordlessAsetukset(options, arvot).muuttuu).toBe(false);
  });

  it("pohjassa ei ole muiden projektien mainintoja", () => {
    const pohja = readFileSync("auth0/kirjautumiskoodi.liquid", "utf8");
    expect(pohja).toContain("{{ code }}");
    expect(pohja).not.toMatch(/reilusoppari|esinetti|skog/i);
  });
});

describe("MFA-Action", () => {
  const CLIENT = "erappuClientId123";

  function aja(event: Record<string, unknown>) {
    const sandbox = { exports: {} as { onExecutePostLogin?: (e: unknown, a: unknown) => Promise<void> } };
    vm.runInNewContext(mfaActionKoodi(CLIENT), sandbox);
    const enable = vi.fn();
    return { enable, run: () => sandbox.exports.onExecutePostLogin!(event, { multifactor: { enable } }) };
  }

  it("vaatii MFA:n henkilökunnalta (tietokantayhteys, eRappu)", async () => {
    const { enable, run } = aja({ client: { client_id: CLIENT }, connection: { strategy: "auth0" }, transaction: { protocol: "oidc-basic-profile" } });
    await run();
    expect(enable).toHaveBeenCalledWith("any", { allowRememberBrowser: false });
  });

  it("ei vaadi MFA:ta portaalin sähköpostikoodikirjautumisessa", async () => {
    const { enable, run } = aja({ client: { client_id: CLIENT }, connection: { strategy: "email" } });
    await run();
    expect(enable).not.toHaveBeenCalled();
  });

  it("ei koske muiden sovellusten kirjautumiseen", async () => {
    const { enable, run } = aja({ client: { client_id: "toinen" }, connection: { strategy: "auth0" } });
    await run();
    expect(enable).not.toHaveBeenCalled();
  });

  it("ei pyydä MFA:ta refresh token -vaihdossa eikä kaadu puuttuviin kenttiin", async () => {
    const refresh = aja({ client: { client_id: CLIENT }, connection: { strategy: "auth0" }, transaction: { protocol: "oauth2-refresh-token" } });
    await refresh.run();
    expect(refresh.enable).not.toHaveBeenCalled();
    const tyhja = aja({});
    await expect(tyhja.run()).resolves.toBeUndefined();
  });

  it("hylkää client_id:n, joka rikkoisi koodin", () => {
    expect(() => mfaActionKoodi('x"; api.access.deny("x")//')).toThrow();
  });
});

describe("sidoksetActionille", () => {
  it("säilyttää olemassa olevat sidokset ja lisää Actionin loppuun", () => {
    const uudet = sidoksetActionille([{ display_name: "Vanha", action: { id: "a1", name: "Vanha" } }], "a2", "MFA");
    expect(uudet).toEqual([
      { ref: { type: "action_id", value: "a1" }, display_name: "Vanha" },
      { ref: { type: "action_id", value: "a2" }, display_name: "MFA" },
    ]);
  });

  it("palauttaa null, kun Action on jo sidottu", () => {
    expect(sidoksetActionille([{ action: { id: "a2" } }], "a2", "MFA")).toBeNull();
  });
});

describe("paivitaYmparisto", () => {
  /* Skripti ajetaan pääkansiossa, jonka .env.local sisältää Vercelin OIDC-tunnisteen. */
  it("säilyttää muut rivit ja lisää puuttuvat loppuun", () => {
    const ennen = 'VERCEL_OIDC_TOKEN="eyJ.abc"\n';
    const jalkeen = paivitaYmparisto(ennen, { AUTH0_DOMAIN: "erappu.eu.auth0.com", AUTH0_CLIENT_ID: "abc" });
    expect(jalkeen.startsWith(ennen)).toBe(true);
    expect(lueYmparistoArvo(jalkeen, "AUTH0_DOMAIN")).toBe("erappu.eu.auth0.com");
    expect(lueYmparistoArvo(jalkeen, "VERCEL_OIDC_TOKEN")).toBe("eyJ.abc");
    expect(jalkeen).not.toContain("AUTH_MODE");
  });

  it("korvaa olemassa olevan ja kommentoidun rivin, CRLF säilyy", () => {
    const jalkeen = paivitaYmparisto("A=1\r\nAUTH0_DOMAIN=vanha\r\n# AUTH0_CLIENT_ID=\r\n\r\nB=2\r\n", { AUTH0_DOMAIN: "uusi", AUTH0_CLIENT_ID: "abc" });
    expect(jalkeen).toBe("A=1\r\nAUTH0_DOMAIN=uusi\r\nAUTH0_CLIENT_ID=abc\r\n\r\nB=2\r\n");
  });

  it("ei tulkitse arvon dollarimerkkejä korvauskaavaksi", () => {
    expect(paivitaYmparisto("AUTH0_CLIENT_SECRET=x\n", { AUTH0_CLIENT_SECRET: "a$&b$1" })).toBe("AUTH0_CLIENT_SECRET=a$&b$1\n");
  });

  it("toimii tyhjälle tiedostolle", () => {
    expect(paivitaYmparisto("", { AUTH0_SECRET: "s" })).toBe("# Auth0 (kirjoitettu skriptillä auth0-asetukset)\nAUTH0_SECRET=s\n");
  });

  it("lueYmparistoArvo ohittaa kommentoidun ja tyhjän arvon", () => {
    expect(lueYmparistoArvo("# X=1\nX=\n", "X")).toBeNull();
  });
});

describe("Vercel", () => {
  it("lukee muuttujien nimet env ls -tulosteesta", () => {
    const tuloste = [
      "> Environment Variables found for team/erappu [300ms]",
      "",
      " name                 value         environments        created",
      " AUTH_MODE            Encrypted     Production          12d ago",
      " POSTGRES_URL         Encrypted     Production          12d ago",
    ].join("\n");
    const nimet = vercelMuuttujat(tuloste);
    expect(nimet.has("AUTH_MODE")).toBe(true);
    expect(nimet.has("POSTGRES_URL")).toBe(true);
  });

  it("ei korvaa olemassa olevaa ilman lippua eikä lisää tyhjää arvoa", () => {
    const suunnitelma = vercelSuunnitelma(new Set(["AUTH0_DOMAIN"]), ["AUTH0_DOMAIN", "AUTH0_CLIENT_ID", "AUTH0_CLIENT_SECRET"], { AUTH0_DOMAIN: "d", AUTH0_CLIENT_ID: "c", AUTH0_CLIENT_SECRET: null }, false);
    expect(suunnitelma.map((t) => `${t.tyyppi}:${t.nimi}`)).toEqual(["ohita:AUTH0_DOMAIN", "lisaa:AUTH0_CLIENT_ID", "ohita:AUTH0_CLIENT_SECRET"]);
  });

  it("korvaa olemassa olevan lipulla", () => {
    expect(vercelSuunnitelma(new Set(["AUTH0_DOMAIN"]), ["AUTH0_DOMAIN"], { AUTH0_DOMAIN: "d" }, true)[0].tyyppi).toBe("korvaa");
  });

  it("AUTH_MODE vaihdetaan vain, kun kaikki Auth0-muuttujat ovat tuotannossa", () => {
    expect(authModeVoidaanVaihtaa(new Set(["AUTH_MODE", "AUTH0_DOMAIN"]))).toMatchObject({ voidaan: false });
    expect(authModeVoidaanVaihtaa(new Set(AUTH0_TUOTANTOMUUTTUJAT)).voidaan).toBe(true);
    expect(AUTH0_TUOTANTOMUUTTUJAT).toEqual(expect.arrayContaining(["AUTH0_DOMAIN", "AUTH0_CLIENT_ID", "AUTH0_CLIENT_SECRET", "AUTH0_SECRET"]));
  });
});

describe("oikeudet ja yhteydet", () => {
  const token = (scope: string) => `x.${Buffer.from(JSON.stringify({ scope })).toString("base64url")}.y`;

  it("löytää puuttuvat oikeudet tokenista ennen muutoksia", () => {
    const kaikki = tokeninOikeudet(token(PAKOLLISET_OIKEUDET.join(" ")));
    expect(puuttuvatOikeudet(kaikki, PAKOLLISET_OIKEUDET)).toEqual([]);
    const vajaa = tokeninOikeudet(token("read:clients update:connections"));
    expect(puuttuvatOikeudet(vajaa, PAKOLLISET_OIKEUDET)).toContain("update:connections_options");
    expect(puuttuvatOikeudet(tokeninOikeudet("ei-jwt"), ["read:clients"])).toEqual(["read:clients"]);
  });

  it("Googlen kirjautuminen on ylimääräinen yhteys eRapulle", () => {
    const yhteydet = [{ name: "email" }, { name: "google-oauth2" }, { name: "Username-Password-Authentication" }];
    expect(ylimaaraisetYhteydet(yhteydet, [STAFF_CONNECTION, PORTAL_CONNECTION])).toEqual(["google-oauth2"]);
  });
});

describe("kirjautumislinkit", () => {
  it("henkilökunnan kutsu vain tietokantayhteyden tunnisteella", () => {
    expect(isStaffConnectionSub("auth0|65f0")).toBe(true);
    expect(isStaffConnectionSub("email|65f0")).toBe(false);
    expect(isStaffConnectionSub("google-oauth2|1")).toBe(false);
  });

  it("portaali sähköpostikoodilla, henkilökunta tietokantayhteydellä", () => {
    expect(PORTAL_CONNECTION).toBe("email");
    expect(STAFF_CONNECTION).toBe("Username-Password-Authentication");
    expect(auth0LoginHref("portal")).toBe("/auth/login?connection=email&ui_locales=fi");
    expect(auth0LoginHref("staff", "/kutsu/abc")).toBe("/auth/login?connection=Username-Password-Authentication&ui_locales=fi&returnTo=%2Fkutsu%2Fabc");
  });

  it("ei päästä ulkoista paluuosoitetta", () => {
    expect(auth0LoginHref("staff", "https://paha.example")).not.toContain("returnTo");
    expect(auth0LoginHref("staff", "//paha.example")).not.toContain("returnTo");
  });
});
