# eRapun käyttöönotto tuotantoon

Tarkistuslista. Kohdat, jotka vaativat tunnuksia tai sopimuksia, ovat myös `BLOCKERS.md`:ssä.

## 1. Supabase
1. Luo projekti `erappu` EU-alueelle (Frankfurt tai Tukholma) Adepta Tilat Oy:n tilille. **Ei** jaettuun kasamaster/PPR-projektiin.
2. Aja migraatiot järjestyksessä `supabase/migrations/*.sql` (Supabase CLI: `supabase db push`). Älä aja `supabase/local/`-kansiota.
3. Ota käyttöön **Third-party auth → Auth0** ja anna Auth0-tenantin domain. Supabase lukee silloin Auth0:n JWT:n, ja `auth.jwt() ->> 'sub'` toimii RLS-funktioissa.
4. Luo yksityinen Storage-bucket `documents`.
5. Kopioi Session pooler -yhteysosoite muuttujaan `DATABASE_URL` ja aseta `DB_DRIVER=postgres`.
6. Varmista RLS: jokaisessa `er_`-taulussa RLS päällä (`select relname from pg_class where relname like 'er_%' and not relrowsecurity` palauttaa 0 riviä).

## 2. Auth0 (portfolion tenant)
1. Uusi Regular Web Application `eRappu`. Callback `https://app.erappu.fi/auth/callback`, logout `https://app.erappu.fi`.
2. Henkilökunta: Username-Password + MFA pakollinen. Portaali: Passwordless Email, tenantin Authentication Profile **Identifier First** (muuten `connection=email` ohitetaan hiljaa).
3. Action, joka lisää tokeniin `role: "authenticated"` Supabasea varten.
4. Muuttujat `AUTH_MODE=auth0`, `AUTH0_DOMAIN`, `AUTH0_CLIENT_ID`, `AUTH0_CLIENT_SECRET`, `AUTH0_SECRET` (32 bittiä), `APP_BASE_URL`.

## 3. Vercel
1. Projekti repoon, region `arn1` (Tukholma).
2. Ympäristömuuttujat `.env.example`:n mukaan. `SESSION_SECRET`, `LINK_TOKEN_SECRET`, `FIELD_ENCRYPTION_KEY`, `HETU_PEPPER`, `CRON_SECRET` satunnaisina (`node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`).
3. Cron: `/api/cron/viestit` 10 min välein, `/api/cron/muistutukset` klo 07 ja `/api/cron/htj` klo 03 (Europe/Helsinki), otsake `Authorization: Bearer $CRON_SECRET`.

## 4. Sähköposti (Resend)
Verkkotunnus `erappu.fi`, SPF/DKIM/DMARC, `EMAIL_MODE=resend`, `RESEND_API_KEY`, `EMAIL_FROM`.

## 5. eSinetti
Organisaatio Adepta Tilat Oy:lle (Adepta Oy myy palvelun), API-avain `ESINETTI_API_KEY`, webhook `https://www.erappu.fi/api/esinetti/webhook` ja salaisuus `ESINETTI_WEBHOOK_SECRET`, `ESINETTI_MODE=http`. Vaiheittainen ohje ja tarkistuslista: [esinetti-kayttoonotto.md](esinetti-kayttoonotto.md). Yhteystesti `npm run esinetti:yhteystesti`.

## 6. HTJ (Maanmittauslaitos)
Testiympäristö → järjestelmälupa → tietoturvaliite → vakiosopimus → tuotantovarmenne. Varmenne base64-muodossa muuttujiin `HTJ_CLIENT_CERT_BASE64`, `HTJ_CLIENT_KEY_BASE64`, `HTJ_CLIENT_KEY_PASSPHRASE`, sitten `HTJ_MODE=mml`.

## 7. Tietojen siirto
1. Aja `npm run access:export` Jukan koneella.
2. Tuonti tuotantokantaan: sama `scripts/access/import-access.mts` `DB_DRIVER=postgres`-tilassa (lisättävä: skripti käyttää nyt paikallista PGliteä).
3. Käy laaturaportti läpi, korjaa osakevälit ja vastikkeet, hae yhtiöt HTJ:stä ja hyväksy erot.
4. Access-tiedosto vain lukukäyttöön; henkilötunnukset poistetaan tai tiedosto arkistoidaan salattuna.

## 8. Ennen ensimmäistä ulkopuolista asiakasta
Ulkoinen tietoturvatestaus, DPA- ja käyttöehtopohjat, tietosuojaseloste, varmuuskopion palautusharjoitus.
