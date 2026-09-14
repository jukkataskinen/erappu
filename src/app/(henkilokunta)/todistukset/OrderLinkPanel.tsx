import { Button, Notice } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { createOrderLinkAction, revokeOrderLinkAction } from "./actions";

/**
 * Yhtiön julkinen todistustilauslinkki. Linkki näytetään vain juuri luotuna
 * (tiiviste kannassa); myöhemmin näkyy vain, että voimassa oleva linkki on.
 */
export function OrderLinkControls({
  companyId,
  back,
  active,
  flashUrl,
  canWrite,
}: {
  companyId: string;
  back: string;
  active: { expiresAt: string | null } | null;
  flashUrl: string | null;
  canWrite: boolean;
}) {
  return (
    <div className="grid gap-2 text-sm">
      {flashUrl ? (
        <Notice tone="ok" title="Uusi tilauslinkki">
          <span className="break-all font-mono text-xs">{flashUrl}</span>
          <span className="mt-1 block">Kopioi linkki nyt. Se näytetään vain kerran, ja vanha linkki lakkasi toimimasta.</span>
        </Notice>
      ) : active ? (
        <p className="text-ink/70">Tilauslinkki on voimassa{active.expiresAt ? ` ${formatDate(active.expiresAt)} asti` : ""}.</p>
      ) : (
        <p className="text-ink/70">Yhtiöllä ei ole voimassa olevaa tilauslinkkiä.</p>
      )}
      {canWrite ? (
        <div className="flex flex-wrap gap-2">
          <form action={createOrderLinkAction}>
            <input type="hidden" name="company_id" value={companyId} />
            <input type="hidden" name="back" value={back} />
            <Button variant="secondary" className="min-h-9 px-4 text-xs">
              {active ? "Luo uusi linkki" : "Luo tilauslinkki"}
            </Button>
          </form>
          {active ? (
            <form action={revokeOrderLinkAction}>
              <input type="hidden" name="company_id" value={companyId} />
              <input type="hidden" name="back" value={back} />
              <Button variant="ghost" className="min-h-9 px-3 text-xs">
                Poista käytöstä
              </Button>
            </form>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
