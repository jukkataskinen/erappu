import Link from "next/link";
import { Badge, Panel, SectionTitle, Table, Td, Th } from "@/components/ui";
import type { StaffContext } from "@/lib/auth/current-user";
import { formatDate } from "@/lib/format";
import {
  boardHealth,
  budgetHealth,
  generalHealth,
  listGovernanceOverview,
  statementHealth,
  type GovernanceDoc,
  type GovernanceMeeting,
  type LastMeeting,
  type Health,
} from "@/lib/governance/overview";
import { MEETING_STATUS, MEETING_STATUS_TONE } from "@/lib/meetings/labels";

const DOT: Record<Health, string> = { ok: "bg-moss", warn: "bg-amber", alert: "bg-coral" };
const HEALTH_LABEL: Record<Health, string> = { ok: "ajan tasalla", warn: "tarkista", alert: "puuttuu tai vanha" };

function Dot({ health }: { health: Health }) {
  return <span className={`mt-1.5 inline-block size-2.5 shrink-0 rounded-full ${DOT[health]}`} aria-label={HEALTH_LABEL[health]} title={HEALTH_LABEL[health]} />;
}

function DocCell({ doc, health, missingHref }: { doc: GovernanceDoc | null; health: Health; missingHref: string }) {
  return (
    <div className="flex gap-2">
      <Dot health={health} />
      {doc ? (
        // Tavallinen linkki: dokumenttisivu avautuu varmasti myös tuotannossa (ks. DocumentTable).
        <a href={`/dokumentit/${doc.id}`} className="font-semibold hover:text-sky">
          {doc.year !== null ? <span className="tabular">{doc.year}</span> : <span className="block max-w-48 truncate">{doc.title}</span>}
          <span className="block text-xs font-normal text-ink/55">
            {doc.year === null ? "vuosi puuttuu · " : ""}tallennettu {formatDate(doc.created_at)}
          </span>
        </a>
      ) : (
        <Link href={missingHref} className="text-ink/55 hover:text-sky">
          Ei tallennettu
        </Link>
      )}
    </div>
  );
}

function MeetingCell({ companyId, last, next, health }: { companyId: string; last: LastMeeting | null; next: GovernanceMeeting | null; health: Health }) {
  return (
    <div className="flex gap-2">
      <Dot health={health} />
      <div className="min-w-0">
        {last?.source === "document" ? (
          <a href={`/dokumentit/${last.id}`} className="hover:text-sky">
            <span className="tabular font-semibold">{last.date ? formatDate(last.date) : last.year}</span> <Badge tone="neutral">Pöytäkirja</Badge>
            {!last.date ? <span className="block max-w-48 truncate text-xs text-ink/55">{last.title}</span> : null}
          </a>
        ) : last ? (
          <Link href={`/taloyhtiot/${companyId}/kokoukset/${last.id}`} className="hover:text-sky">
            <span className="tabular font-semibold">{formatDate(last.starts_at)}</span>{" "}
            <Badge tone={MEETING_STATUS_TONE[last.status]}>{MEETING_STATUS[last.status]}</Badge>
          </Link>
        ) : (
          <Link href={`/taloyhtiot/${companyId}/kokoukset`} className="text-ink/55 hover:text-sky">
            Ei kirjattu
          </Link>
        )}
        {next ? (
          <Link href={`/taloyhtiot/${companyId}/kokoukset/${next.id}`} className="block text-xs text-ink/55 hover:text-sky">
            seuraava {formatDate(next.starts_at)}
          </Link>
        ) : null}
      </div>
    </div>
  );
}

/** Työpöydän hallinto-osio: onko talousarvio, tilinpäätös ja kokoukset ajan tasalla yhtiöittäin. */
export async function GovernancePanel({ ctx }: { ctx: StaffContext }) {
  const rows = await ctx.run((tx) => listGovernanceOverview(tx, ctx.org.organizationId));
  if (rows.length === 0) return null;
  const now = new Date();

  return (
    <Panel>
      <SectionTitle actions={<Link href="/kokoukset" className="text-sm text-sky">Kokoukset</Link>}>Hallinto</SectionTitle>
      <p className="mb-3 text-sm text-ink/65">
        Viimeisin tallennettu talousarvio ja tilinpäätös (dokumenttien vuosi) sekä viimeisin pidetty kokous kokouksista tai pöytäkirjadokumenteista. Väri olettaa kalenterivuoden tilikauden ja varsinaisen yhtiökokouksen kesäkuun loppuun mennessä.
      </p>
      <Table>
        <thead>
          <tr>
            <Th>Taloyhtiö</Th>
            <Th>Talousarvio</Th>
            <Th>Tilinpäätös</Th>
            <Th>Yhtiökokous</Th>
            <Th>Hallituksen kokous</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.company_id}>
              <Td>
                <Link href={`/taloyhtiot/${r.company_id}`} className="font-semibold hover:text-sky">
                  {r.company_name}
                </Link>
              </Td>
              <Td>
                <DocCell doc={r.budget} health={budgetHealth(r.budget, now)} missingHref={`/taloyhtiot/${r.company_id}/dokumentit`} />
              </Td>
              <Td>
                <DocCell doc={r.statement} health={statementHealth(r.statement, now)} missingHref={`/taloyhtiot/${r.company_id}/dokumentit`} />
              </Td>
              <Td>
                <MeetingCell companyId={r.company_id} last={r.general} next={r.next_general} health={generalHealth(r.general, r.next_general, now)} />
              </Td>
              <Td>
                <MeetingCell companyId={r.company_id} last={r.board} next={r.next_board} health={boardHealth(r.board, r.next_board, now)} />
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </Panel>
  );
}
