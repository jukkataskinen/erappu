# eRappu

Isännöintijärjestelmä: taloyhtiöt, HTJ, huoltopyynnöt, talous, kokoukset ja portaali. Rakennusohje Claude Codelle on `CLAUDE.md`:ssä, tehtävät `PLAN.md`:ssä ja esteet `BLOCKERS.md`:ssä.

## Paikallinen käyttö

```bash
npm install
npm run db:reset        # tyhjä paikallinen kanta (.data/pglite)
npm run db:seed:demo    # kuvitteellinen Demo Isännöinti Oy
npm run access:export   # Access → data/private/access-export.json (vain Jukan koneella)
npm run access:import   # 11 asiakasyhtiötä kantaan + data/private/access-import-report.md
npm run dev             # http://localhost:3000, kirjautuminen valitsemalla käyttäjä
```

Kehityspalvelin ja skriptit käyttävät samaa PGlite-kantaa, joten pysäytä palvelin ennen skriptien ajoa.

## Tarkistukset

```bash
npm run lint
npm run typecheck
npm run test
```

## Tuotantoon tarvittavat (BLOCKERS.md)

Oma Supabase-projekti (`DB_DRIVER=postgres`), Auth0-sovellus (`AUTH_MODE=auth0`), MML:n HTJ-sopimus ja varmenne (`HTJ_MODE=mml`), eSinetti-tenant (`ESINETTI_MODE=http`), Resend (`EMAIL_MODE=resend`), Vercel.
