/**
 * Integraatioiden tila asetussivulle. Luetaan vain tilamuuttujat
 * (HTJ_MODE jne.), ei koskaan avaimia tai osoitteita, jotta näkymä ei voi
 * vuotaa salaisuuksia.
 */

export interface IntegrationStatus {
  key: string;
  label: string;
  description: string;
  mode: string;
  live: boolean;
  statusLabel: "Jäljitelmä" | "Käytössä";
  blocker: string | null;
}

interface Spec {
  key: string;
  label: string;
  description: string;
  defaultMode: string;
  liveModes: string[];
  blocker: string;
}

const SPECS: Spec[] = [
  { key: "HTJ_MODE", label: "HTJ (Maanmittauslaitos)", description: "Osakeluettelot ja HTJ2-ilmoitukset", defaultMode: "mock", liveModes: ["mml"], blocker: "BLOCKERS 1: MML-sopimus ja varmenne" },
  { key: "ESINETTI_MODE", label: "eSinetti", description: "Sähköiset allekirjoitukset ja sinetöinti", defaultMode: "mock", liveModes: ["http"], blocker: "BLOCKERS 3: eSinetti-tenant ja API-avain" },
  { key: "EMAIL_MODE", label: "Sähköposti", description: "Kutsut, tiedotteet ja ilmoitukset", defaultMode: "console", liveModes: ["resend"], blocker: "BLOCKERS 2: tuotantoympäristö" },
  { key: "STORAGE_DRIVER", label: "Tiedostovarasto", description: "Dokumentit ja liitteet", defaultMode: "local", liveModes: ["supabase"], blocker: "BLOCKERS 2: tuotantoympäristö" },
  { key: "AUTH_MODE", label: "Kirjautuminen", description: "Henkilökunta ja portaali (Auth0)", defaultMode: "dev", liveModes: ["auth0"], blocker: "BLOCKERS 2: Auth0-sovellus" },
];

export function integrationStatuses(env: Record<string, string | undefined> = process.env): IntegrationStatus[] {
  return SPECS.map((s) => {
    const raw = env[s.key]?.trim();
    const mode = raw && raw.length > 0 ? raw : s.defaultMode;
    const live = s.liveModes.includes(mode);
    return {
      key: s.key,
      label: s.label,
      description: s.description,
      // Tila näytetään vain, jos se on tunnettu arvo; muuten arvoa ei kaiuteta.
      mode: live || mode === s.defaultMode ? mode : "tuntematon",
      live,
      statusLabel: live ? "Käytössä" : "Jäljitelmä",
      blocker: live ? null : s.blocker,
    };
  });
}
