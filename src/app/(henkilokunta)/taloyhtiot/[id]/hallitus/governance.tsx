import { Button, Field, Input, Panel, SectionTitle, Select } from "@/components/ui";
import type { Sql } from "@/lib/db";
import { auditorElectionTitle, boardElectionTitle, type AuditorKind, type CompanyGovernance } from "@/lib/meetings/agenda";
import { saveGovernance } from "./governance-actions";

export interface GovernanceRow {
  company_form: string;
  board_members_min: number | null;
  board_members_max: number | null;
  board_deputies_min: number | null;
  board_deputies_max: number | null;
  auditor_kind: AuditorKind | null;
  auditors_count: number | null;
  deputy_auditors_count: number | null;
  governance_source: string | null;
}

export async function loadGovernance(tx: Sql, companyId: string): Promise<GovernanceRow | null> {
  const [row] = await tx.query<GovernanceRow>(
    `select company_form, board_members_min, board_members_max, board_deputies_min, board_deputies_max, auditor_kind, auditors_count, deputy_auditors_count,
            governance_source
       from er_housing_companies where id = $1`,
    [companyId],
  );
  return row ?? null;
}

export function toGovernance(g: GovernanceRow): CompanyGovernance {
  return {
    boardMembersMin: g.board_members_min, boardMembersMax: g.board_members_max, boardDeputiesMin: g.board_deputies_min, boardDeputiesMax: g.board_deputies_max,
    auditorKind: g.auditor_kind, auditorsCount: g.auditors_count, deputyAuditorsCount: g.deputy_auditors_count, isHousingCompany: g.company_form !== "koy",
  };
}

const num = (v: number | null) => (v === null ? "" : String(v));

/** Yhtiöjärjestyksen hallitus- ja tarkastajamäärät, joista varsinaisen yhtiökokouksen esityslista rakennetaan. */
export function GovernancePanel({ companyId, row, canWrite }: { companyId: string; row: GovernanceRow; canWrite: boolean }) {
  const g = toGovernance(row);
  const filled = row.board_members_min !== null && row.auditor_kind !== null;
  return (
    <Panel id="yhtiojarjestys">
      <SectionTitle>Hallitus ja tarkastajat yhtiöjärjestyksessä</SectionTitle>
      {filled ? (
        <div className="mb-4 grid gap-1 rounded-xl bg-cloud/60 p-3 text-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink/50">Yhtiökokouksen esityslistalla</p>
          <p>{boardElectionTitle(g)}</p>
          <p>{auditorElectionTitle(g)}</p>
          {row.governance_source ? <p className="text-xs text-ink/55">Lähde: {row.governance_source}</p> : null}
        </div>
      ) : (
        <p className="mb-4 text-sm text-ink/65">Kirjaa määrät yhtiöjärjestyksestä, niin varsinaisen yhtiökokouksen esityslista muodostuu oikein.</p>
      )}
      {canWrite ? (
        <form action={saveGovernance} className="grid gap-3">
          <input type="hidden" name="company_id" value={companyId} />
          <div className="grid grid-cols-2 gap-3">
            <Field label="Varsinaisia jäseniä, vähintään" htmlFor="board_members_min">
              <Input id="board_members_min" name="board_members_min" inputMode="numeric" defaultValue={num(row.board_members_min)} />
            </Field>
            <Field label="enintään" htmlFor="board_members_max" hint="Sama luku, jos määrä on kiinteä">
              <Input id="board_members_max" name="board_members_max" inputMode="numeric" defaultValue={num(row.board_members_max)} />
            </Field>
            <Field label="Varajäseniä, vähintään" htmlFor="board_deputies_min">
              <Input id="board_deputies_min" name="board_deputies_min" inputMode="numeric" defaultValue={num(row.board_deputies_min)} />
            </Field>
            <Field label="enintään" htmlFor="board_deputies_max">
              <Input id="board_deputies_max" name="board_deputies_max" inputMode="numeric" defaultValue={num(row.board_deputies_max)} />
            </Field>
          </div>
          <Field
            label="Tarkastaja"
            htmlFor="auditor_kind"
            hint="Ennen vuotta 2010 kirjoitettu tilintarkastajamääräys koskee myös toiminnantarkastajaa, jos tilintarkastusvelvollisuutta ei ole (voimaanpanolaki 1600/2009 11 §)."
          >
            <Select id="auditor_kind" name="auditor_kind" defaultValue={row.auditor_kind ?? ""}>
              <option value="">Ei kirjattu</option>
              <option value="operations_auditor">Toiminnantarkastaja</option>
              <option value="auditor">Tilintarkastaja (HT/KHT)</option>
              <option value="optional">Ei pakollinen</option>
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Varsinaisia tarkastajia" htmlFor="auditors_count">
              <Input id="auditors_count" name="auditors_count" inputMode="numeric" defaultValue={num(row.auditors_count)} />
            </Field>
            <Field label="Varatarkastajia" htmlFor="deputy_auditors_count">
              <Input id="deputy_auditors_count" name="deputy_auditors_count" inputMode="numeric" defaultValue={num(row.deputy_auditors_count)} />
            </Field>
          </div>
          <Field label="Lähde" htmlFor="governance_source" hint="Esim. yhtiöjärjestys 7 § ja 11 §">
            <Input id="governance_source" name="governance_source" maxLength={300} defaultValue={row.governance_source ?? ""} />
          </Field>
          <div>
            <Button type="submit" variant="secondary">
              Tallenna
            </Button>
          </div>
        </form>
      ) : null}
    </Panel>
  );
}
