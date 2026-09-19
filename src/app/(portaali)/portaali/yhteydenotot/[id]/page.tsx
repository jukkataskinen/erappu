import Link from "next/link";
import { notFound } from "next/navigation";
import { ReplyForm, ThreadView } from "@/components/contacts/ThreadView";
import { FormError } from "@/components/FormError";
import { Badge, Notice, Panel, SectionTitle } from "@/components/ui";
import { requirePortal } from "@/lib/auth/current-user";
import { CONTACT_STATUS_LABEL_PORTAL, CONTACT_STATUS_TONE_PORTAL, CONTACT_TOPIC_LABEL } from "@/lib/contacts/labels";
import { getThread, listThreadEntries } from "@/lib/contacts/queries";
import { replyContact } from "../actions";

export const metadata = { title: "Yhteydenotto" };

export default async function PortalContactPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ virhe?: string; tila?: string }> }) {
  const ctx = await requirePortal();
  const { id } = await params;
  const { virhe, tila } = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const thread = await ctx.run((tx) => getThread(tx, id));
  // RLS näyttää portaalissa vain omat ketjut; henkilökuntaan kuuluva näkisi muitakin.
  if (!thread || thread.participant_user_id !== ctx.user.id) notFound();
  const entries = await ctx.run((tx) => listThreadEntries(tx, id, ctx.user.id));

  return (
    <>
      <Link href="/portaali/yhteydenotot" className="text-sm text-ink/60 hover:text-ink">
        ← Yhteydenotot
      </Link>
      <h1 className="mt-2 text-2xl">{thread.subject}</h1>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-ink/60">
        <Badge tone={CONTACT_STATUS_TONE_PORTAL[thread.status]}>{CONTACT_STATUS_LABEL_PORTAL[thread.status]}</Badge>
        <span>{CONTACT_TOPIC_LABEL[thread.topic]}</span>
        <span>
          {thread.company_name}
          {thread.unit_label ? `, huoneisto ${thread.unit_label}` : ""}
        </span>
      </div>

      <div className="mt-4 grid max-w-3xl gap-4">
        <FormError message={virhe} />
        {tila === "lahetetty" ? (
          <Notice tone="ok" title="Viesti lähetettiin isännöinnille.">
            Saat sähköpostiin ilmoituksen, kun isännöinti vastaa.
          </Notice>
        ) : null}

        <Panel id="viestit">
          <SectionTitle>Viestit</SectionTitle>
          <ThreadView entries={entries} viewer="portal" />
        </Panel>

        <Panel>
          <ReplyForm
            action={replyContact}
            threadId={thread.id}
            label={thread.status === "closed" ? "Kirjoita uusi viesti" : "Vastaa"}
            hint={thread.status === "closed" ? "Yhteydenotto on merkitty käsitellyksi. Uusi viesti avaa sen uudelleen." : undefined}
          />
        </Panel>
      </div>
    </>
  );
}
