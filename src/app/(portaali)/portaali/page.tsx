import { Badge, LinkButton, Panel } from "@/components/ui";
import { requirePortal } from "@/lib/auth/current-user";
import * as huolto from "@/widgets/huolto";
import * as htj from "@/widgets/htj";
import * as talous from "@/widgets/talous";
import * as viestinta from "@/widgets/viestinta";
import * as kokoukset from "@/widgets/kokoukset";
import * as arki from "@/widgets/arki";
import { WaterReadingNotice } from "./WaterReadingNotice";

export const metadata = { title: "Portaali" };

const ROLE = { board: "Hallitus", owner: "Osakas", resident: "Asukas", provider: "Palveluntuottaja" } as const;

export default async function PortalHome() {
  const ctx = await requirePortal();
  return (
    <>
      <h1 className="text-2xl">Hei{ctx.user.fullName ? `, ${ctx.user.fullName.split(" ")[0]}` : ""}</h1>
      <div className="mt-4">
        <WaterReadingNotice ctx={ctx} />
      </div>
      <div className="mt-4 grid gap-3">
        {ctx.companies.map((c) => (
          <Panel key={c.id}>
            <p className="font-semibold">{c.name}</p>
            <div className="mt-2 flex flex-wrap gap-1">
              {c.roles.map((r) => (
                <Badge key={r} tone={r === "board" ? "info" : "neutral"}>
                  {ROLE[r]}
                </Badge>
              ))}
            </div>
          </Panel>
        ))}
      </div>
      <div className="mt-6">
        <LinkButton href="/portaali/huoltopyynnot/uusi" className="w-full sm:w-auto">
          Tee huoltopyyntö
        </LinkButton>
      </div>
      <div className="mt-6 grid gap-4">
        <huolto.PortalHomeWidget ctx={ctx} />
        <viestinta.PortalHomeWidget ctx={ctx} />
        <kokoukset.PortalHomeWidget ctx={ctx} />
        <arki.PortalHomeWidget ctx={ctx} />
        <talous.PortalHomeWidget ctx={ctx} />
        <htj.PortalHomeWidget ctx={ctx} />
      </div>
    </>
  );
}
