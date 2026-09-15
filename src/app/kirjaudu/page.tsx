import { redirect } from "next/navigation";
import { Brand } from "@/components/Brand";
import { Button, Notice, Panel } from "@/components/ui";
import { getCurrentUser } from "@/lib/auth/current-user";
import { auth0LoginHref } from "@/lib/auth/login-params";
import { authMode, devLoginAllowed } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { devLogin } from "@/app/actions/session";

export const metadata = { title: "Kirjaudu" };
export const dynamic = "force-dynamic";

// Tavallinen linkki eikä LinkButton: /auth/login on middlewaren reitti, jota Next ei saa esihakea.
const LOGIN_LINK =
  "mt-4 inline-flex min-h-[var(--size-touch)] items-center justify-center rounded-full bg-ink px-5 text-sm font-semibold text-paper hover:bg-ink-strong";

const ROLE = {
  "org:owner": "pääkäyttäjä", "org:manager": "isännöitsijä", "org:accountant": "kirjanpitäjä", "org:assistant": "assistentti",
  "portal:board": "hallitus", "portal:owner": "osakas", "portal:resident": "asukas", "portal:provider": "palveluntuottaja",
} as Record<string, string>;

export default async function LoginPage() {
  if (authMode() === "auth0") {
    /*
     * Ei suoraa ohjausta Auth0:aan: henkilökunta ja portaali käyttävät eri
     * yhteyttä, eikä Auth0 tiedä etukäteen, kumpi käyttäjä on. Ilman valintaa
     * asukas päätyisi salasanalomakkeelle, jolla hänellä ei ole tunnusta.
     */
    if (await getCurrentUser()) redirect("/");
    return (
      <div className="mx-auto flex min-h-dvh max-w-[var(--container-content)] flex-col justify-center px-5 py-10">
        <Brand size={30} />
        <h1 className="mt-8 text-3xl">Kirjaudu eRappuun</h1>
        <p className="mt-2 text-ink/70">Taloyhtiöt, HTJ, huoltopyynnöt ja portaali samassa paikassa.</p>
        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          <Panel>
            <h2 className="text-lg">Asukas, osakas tai hallitus</h2>
            <p className="mt-1 text-sm text-ink/70">Saat kertakäyttöisen koodin sähköpostiisi.</p>
            <a href={auth0LoginHref("portal")} className={LOGIN_LINK}>
              Kirjaudu portaaliin
            </a>
          </Panel>
          <Panel>
            <h2 className="text-lg">Isännöintitoimisto</h2>
            <p className="mt-1 text-sm text-ink/70">Salasana ja todennussovelluksen koodi.</p>
            <a href={auth0LoginHref("staff")} className={LOGIN_LINK}>
              Kirjaudu henkilökuntana
            </a>
          </Panel>
        </div>
      </div>
    );
  }

  const users = devLoginAllowed()
    ? await (await getDb()).asService((tx) =>
        tx.query<{ id: string; email: string; full_name: string | null; roles: string | null }>(
          `select u.id, u.email, u.full_name,
                  concat_ws(', ',
                    (select string_agg(distinct 'org:' || m.role, ', ') from er_org_members m where m.user_id = u.id),
                    (select string_agg(distinct 'portal:' || p.role, ', ') from er_portal_access p where p.user_id = u.id and p.ends_on is null)) as roles
             from er_users u order by u.full_name nulls last, u.email`,
        ),
      )
    : [];

  return (
    <div className="mx-auto flex min-h-dvh max-w-[var(--container-content)] flex-col justify-center px-5 py-10">
      <Brand size={30} />
      <h1 className="mt-8 text-3xl">Kirjaudu eRappuun</h1>
      <p className="mt-2 text-ink/70">Taloyhtiöt, HTJ, huoltopyynnöt ja portaali samassa paikassa.</p>

      {devLoginAllowed() ? (
        <Panel className="mt-8">
          <Notice tone="warn" title="Kehityskirjautuminen">
            Valitse käyttäjä. Tuotannossa kirjautuminen tehdään Auth0:lla, eikä tätä näkymää ole.
          </Notice>
          {users.length === 0 ? (
            <p className="mt-4 text-sm text-ink/70">
              Kannassa ei ole käyttäjiä. Aja <code>npm run db:seed:demo</code>.
            </p>
          ) : (
            <ul className="mt-4 divide-y divide-line">
              {users.map((u) => (
                <li key={u.id}>
                  <form action={devLogin} className="flex items-center justify-between gap-3 py-2.5">
                    <input type="hidden" name="userId" value={u.id} />
                    <div className="min-w-0">
                      <p className="truncate font-semibold">{u.full_name ?? u.email}</p>
                      <p className="truncate text-sm text-ink/55">
                        {u.email}
                        {u.roles ? ` · ${u.roles.split(", ").map((r) => ROLE[r] ?? r).join(", ")}` : ""}
                      </p>
                    </div>
                    <Button variant="secondary">Kirjaudu</Button>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      ) : (
        <Notice tone="alert" title="Kirjautuminen ei ole käytössä">
          Kirjautumistapaa ei ole määritetty.
        </Notice>
      )}
    </div>
  );
}
