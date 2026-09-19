import Link from "next/link";
import { Badge, EmptyState, LinkButton, Panel } from "@/components/ui";
import { requirePortal } from "@/lib/auth/current-user";
import { CONTACT_STATUS_LABEL_PORTAL, CONTACT_STATUS_TONE_PORTAL, CONTACT_TOPIC_LABEL } from "@/lib/contacts/labels";
import { listPortalThreads } from "@/lib/contacts/queries";
import { formatDate } from "@/lib/format";

export const metadata = { title: "Yhteydenotot" };

export default async function PortalContactsPage() {
  const ctx = await requirePortal();
  const threads = await ctx.run((tx) => listPortalThreads(tx, ctx.user.id));
  const canContact = ctx.user.portal.some((g) => g.role !== "provider");
  const multiCompany = ctx.companies.length > 1;

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl">Yhteydenotot</h1>
        {canContact ? <LinkButton href="/portaali/yhteydenotot/uusi">Uusi yhteydenotto</LinkButton> : null}
      </div>
      <p className="mt-2 max-w-2xl text-sm text-ink/65">
        Kysy isännöinniltä vastikkeista, asiakirjoista, remonteista tai muusta taloyhtiön asiasta. Vastaus tulee tänne, ja saat siitä ilmoituksen sähköpostiin. Viat ja
        vuodot ilmoitetaan{" "}
        <Link href="/portaali/huoltopyynnot/uusi" className="font-semibold text-sky hover:underline">
          huoltopyyntönä
        </Link>
        .
      </p>

      <div className="mt-5">
        {threads.length === 0 ? (
          <EmptyState title="Ei yhteydenottoja">Aloita uusi yhteydenotto, kun haluat kysyä isännöinniltä jotain.</EmptyState>
        ) : (
          <Panel>
            <ul className="divide-y divide-line">
              {threads.map((t) => (
                <li key={t.id}>
                  <Link href={`/portaali/yhteydenotot/${t.id}`} className="flex min-h-[var(--size-touch)] flex-col gap-1 py-3 hover:text-sky">
                    <span className="flex items-start justify-between gap-3">
                      <span className="font-semibold">{t.subject}</span>
                      {t.started_by_staff && t.message_count === 1 && t.status === "answered" ? (
                        <Badge tone="ok">Viesti isännöinniltä</Badge>
                      ) : (
                        <Badge tone={CONTACT_STATUS_TONE_PORTAL[t.status]}>{CONTACT_STATUS_LABEL_PORTAL[t.status]}</Badge>
                      )}
                    </span>
                    <span className="flex flex-wrap gap-x-2 text-sm text-ink/60">
                      <span>{CONTACT_TOPIC_LABEL[t.topic]}</span>
                      {multiCompany || t.unit_label ? (
                        <span>
                          {multiCompany ? t.company_name : ""}
                          {multiCompany && t.unit_label ? ", " : ""}
                          {t.unit_label ?? ""}
                        </span>
                      ) : null}
                      <span>viimeisin viesti {formatDate(t.last_message_at)}</span>
                      <span>{t.message_count === 1 ? "1 viesti" : `${t.message_count} viestiä`}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </Panel>
        )}
      </div>
    </>
  );
}
