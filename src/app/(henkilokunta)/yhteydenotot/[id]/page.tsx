import Link from "next/link";
import { notFound } from "next/navigation";
import { ReplyForm, ThreadView } from "@/components/contacts/ThreadView";
import { FormError } from "@/components/FormError";
import { Badge, Button, DefinitionList, Notice, PageHeader, Panel, SectionTitle } from "@/components/ui";
import { requireStaff } from "@/lib/auth/current-user";
import { CONTACT_STATUS_LABEL, CONTACT_STATUS_TONE, CONTACT_TOPIC_LABEL } from "@/lib/contacts/labels";
import { getThread, listThreadEntries } from "@/lib/contacts/queries";
import { formatDateTime } from "@/lib/format";
import { staffReply, staffSetClosed } from "../actions";

export const metadata = { title: "Yhteydenotto" };

const MESSAGES: Record<string, string> = {
  vastattu: "Vastaus lähetettiin. Kysyjä saa ilmoituksen sähköpostiin.",
  "vastattu-suljettu": "Vastaus lähetettiin ja yhteydenotto merkittiin käsitellyksi.",
  suljettu: "Yhteydenotto merkittiin käsitellyksi.",
  avattu: "Yhteydenotto avattiin uudelleen.",
  lahetetty: "Viesti lähetettiin. Vastaanottaja saa ilmoituksen sähköpostiin ja näkee viestin portaalissa.",
};

export default async function StaffContactPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ virhe?: string; tila?: string }> }) {
  const ctx = await requireStaff();
  const { id } = await params;
  const { virhe, tila } = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const thread = await ctx.run((tx) => getThread(tx, id));
  if (!thread || thread.organization_id !== ctx.org.organizationId) notFound();
  const entries = await ctx.run((tx) => listThreadEntries(tx, id, thread.participant_user_id));
  const canWrite = ctx.can("owner", "manager", "assistant", "accountant");

  return (
    <>
      <PageHeader
        title={thread.subject}
        back={{ href: "/yhteydenotot", label: "Yhteydenotot" }}
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-2">
            <Badge tone={CONTACT_STATUS_TONE[thread.status]}>{CONTACT_STATUS_LABEL[thread.status]}</Badge>
            {CONTACT_TOPIC_LABEL[thread.topic]}
          </span>
        }
      />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="grid content-start gap-5">
          <FormError message={virhe} />
          {tila && MESSAGES[tila] ? <Notice tone="ok" title={MESSAGES[tila]} /> : null}
          <Panel>
            <SectionTitle>Viestit</SectionTitle>
            <ThreadView entries={entries} viewer="staff" />
          </Panel>
          {canWrite ? (
            <Panel>
              <ReplyForm action={staffReply} threadId={thread.id} label="Vastaa" hint="Kysyjä saa sähköpostiin ilmoituksen vastauksesta. Viestin sisältöä ei lähetetä sähköpostissa." submitLabel="Lähetä vastaus" />
            </Panel>
          ) : null}
        </div>
        <aside className="grid content-start gap-5">
          <Panel>
            <SectionTitle>Tiedot</SectionTitle>
            <DefinitionList
              items={[
                {
                  label: "Taloyhtiö",
                  value: (
                    <Link href={`/taloyhtiot/${thread.company_id}`} className="text-sky hover:underline">
                      {thread.company_name}
                    </Link>
                  ),
                },
                {
                  label: "Huoneisto",
                  value: thread.share_group_id ? (
                    <Link href={`/taloyhtiot/${thread.company_id}/huoneistot/${thread.share_group_id}`} className="text-sky hover:underline">
                      {thread.unit_label}
                    </Link>
                  ) : (
                    "Yhtiötä koskeva asia"
                  ),
                },
                { label: "Kysyjä", value: thread.creator_name ?? "–" },
                { label: "Aloitettu", value: formatDateTime(thread.created_at) },
              ]}
            />
          </Panel>
          {canWrite ? (
            <Panel>
              <form action={staffSetClosed} className="grid gap-2">
                <input type="hidden" name="thread_id" value={thread.id} />
                <input type="hidden" name="closed" value={thread.status === "closed" ? "0" : "1"} />
                <Button type="submit" variant="secondary">
                  {thread.status === "closed" ? "Avaa uudelleen" : "Merkitse käsitellyksi"}
                </Button>
                <p className="text-xs text-ink/55">
                  {thread.status === "closed" ? "Kysyjän uusi viesti avaa yhteydenoton myös automaattisesti." : "Käsitelty poistuu avoimien listalta. Kysyjän uusi viesti avaa sen uudelleen."}
                </p>
              </form>
            </Panel>
          ) : null}
        </aside>
      </div>
    </>
  );
}
