import { Brand } from "@/components/Brand";
import { Button, LinkButton, Notice, Panel } from "@/components/ui";
import { getCurrentUser } from "@/lib/auth/current-user";
import { auth0LoginHref } from "@/lib/auth/login-params";
import { authMode, devLoginAllowed } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { isInviteTokenShaped, previewInvitation } from "@/lib/invitations";
import { acceptInvite } from "./actions";

// Ei hakukoneisiin, eikä kutsulinkki saa vuotaa Referer-otsakkeessa.
export const metadata = { title: "Kutsu", robots: { index: false, follow: false }, referrer: "no-referrer" as const };
export const dynamic = "force-dynamic";

const ERRORS: Record<string, { title: string; text: string }> = {
  voimassa: { title: "Kutsu ei ole voimassa", text: "Kutsu on vanhentunut, peruttu tai jo käytetty. Pyydä isännöitsijältä uusi kutsu." },
  tunnus: {
    title: "Kutsua ei voi hyväksyä tällä tunnuksella",
    text: "Kirjaudu ulos ja kirjaudu sisään sillä sähköpostiosoitteella, johon kutsu lähetettiin.",
  },
  henkilokunta: {
    title: "Kirjaudu henkilökuntana",
    text: "Henkilökunnan kutsu hyväksytään salasanalla ja todennussovelluksella, ei sähköpostikoodilla. Kirjaudu ulos ja kirjaudu uudelleen tämän sivun painikkeesta.",
  },
};

export default async function InvitationPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ virhe?: string }> }) {
  const { token } = await params;
  const { virhe } = await searchParams;
  const preview = isInviteTokenShaped(token) ? await (await getDb()).asService((tx) => previewInvitation(tx, token)) : null;
  const user = preview ? await getCurrentUser() : null;
  const error = virhe ? ERRORS[virhe] : undefined;

  const returnTo = `/kutsu/${token}`;
  // Portaalikutsu sähköpostikoodilla, henkilökuntakutsu salasanalla ja MFA:lla.
  const loginHref = authMode() === "auth0" ? auth0LoginHref(preview?.kind === "portal" ? "portal" : "staff", returnTo) : "/kirjaudu";

  return (
    <div className="mx-auto flex min-h-dvh max-w-[var(--container-content)] flex-col justify-center px-5 py-10">
      <Brand size={30} />
      {!preview ? (
        <>
          <h1 className="mt-8 text-3xl">Kutsu ei ole voimassa</h1>
          <p className="mt-2 text-ink/70">Kutsu on vanhentunut, peruttu tai jo käytetty, tai linkki on kopioitunut vajaana. Pyydä isännöitsijältä uusi kutsu.</p>
        </>
      ) : (
        <>
          <h1 className="mt-8 text-3xl">{preview.kind === "portal" ? "Kutsu taloyhtiön portaaliin" : "Kutsu eRappuun"}</h1>
          <p className="mt-2 text-ink/70">
            {preview.kind === "portal" ? (
              <>
                {preview.organizationName} kutsuu sinut taloyhtiön <strong>{preview.companyName}</strong> portaaliin.
              </>
            ) : (
              <>
                {preview.organizationName} kutsuu sinut käyttäjäksi roolilla <strong>{preview.roleLabel.toLowerCase()}</strong>.
              </>
            )}
          </p>

          <Panel className="mt-8">
            {error ? (
              <div className="mb-4" role="alert">
                <Notice tone="alert" title={error.title}>
                  {error.text}
                </Notice>
              </div>
            ) : null}

            {user ? (
              <form action={acceptInvite} className="grid gap-4">
                <input type="hidden" name="token" value={token} />
                <p className="text-sm text-ink/70">
                  Olet kirjautunut käyttäjänä <strong>{user.email}</strong>. Kutsu hyväksytään tälle tunnukselle, jos osoite on sama, johon kutsu lähetettiin.
                </p>
                <div className="flex flex-wrap gap-3">
                  <Button>Hyväksy kutsu</Button>
                  <a href="/kirjaudu/ulos" className="inline-flex min-h-[var(--size-touch)] items-center px-3 text-sm text-ink/60 hover:text-ink">
                    Kirjaudu ulos
                  </a>
                </div>
              </form>
            ) : (
              <div className="grid gap-4">
                <p className="text-sm text-ink/70">
                  {preview.kind === "portal"
                    ? "Kirjaudu sillä sähköpostiosoitteella, johon kutsu tuli. Saat kertakäyttöisen koodin sähköpostiisi."
                    : "Kirjaudu sillä sähköpostiosoitteella, johon kutsu tuli. Jos et ole vielä asettanut salasanaa, valitse kirjautumissivulla \"Unohditko salasanan?\"."}
                </p>
                <div>
                  {authMode() === "auth0" ? (
                    <a href={loginHref} className="inline-flex min-h-[var(--size-touch)] items-center justify-center rounded-full bg-ink px-5 text-sm font-semibold text-paper hover:bg-ink-strong">
                      Kirjaudu hyväksyäksesi
                    </a>
                  ) : devLoginAllowed() ? (
                    <LinkButton href={loginHref}>Kirjaudu kehityskäyttäjänä</LinkButton>
                  ) : null}
                </div>
                {authMode() === "dev" ? (
                  <Notice tone="warn" title="Kehityskirjautuminen">
                    Kehityskirjautuminen ei palaa kutsuun automaattisesti. Valitse käyttäjä, jonka sähköposti vastaa kutsua, ja avaa kutsulinkki sen jälkeen uudelleen.
                  </Notice>
                ) : null}
              </div>
            )}
          </Panel>
        </>
      )}
    </div>
  );
}
