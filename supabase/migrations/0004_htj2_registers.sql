-- 0004 HTJ2-tiedot: vastikeperusteet, yhtiölainat ja lainaosuudet,
-- kunnossapito- ja muutostyöt sekä kunnossapitotarveselvitys.
--
-- Nämä ilmoitetaan Maanmittauslaitoksen ylläpitorajapintaan (HTJ2). Samat
-- rivit ovat myös laskutuksen ja isännöitsijäntodistuksen lähde, joten ne
-- ovat perustaulukoita eivätkä yhden moduulin omia.

create table er_charge_bases (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references er_organizations(id),
  company_id uuid not null references er_housing_companies(id) on delete cascade,
  charge_type text not null check (charge_type in (
    'maintenance', 'land', 'heating', 'capital', 'financing', 'water', 'sauna', 'parking', 'other')),
  label text,
  basis text not null check (basis in ('area_m2', 'share', 'unit', 'person', 'meter', 'fixed')),
  unit_price numeric(12, 4) not null check (unit_price >= 0),
  vat_percent numeric(4, 1) not null default 0,
  applies_to_kinds text[],
  starts_on date not null,
  ends_on date,
  decided_on date,
  decision_note text,
  htj_charge_type text check (htj_charge_type in ('hoitovastike', 'maavastike', 'lammitysvastike', 'paaomavastike')),
  htj_submitted_at timestamptz,
  source text not null default 'manual' check (source in ('manual', 'migration', 'htj')),
  created_at timestamptz not null default now(),
  check (ends_on is null or ends_on >= starts_on)
);
create index er_charge_bases_company on er_charge_bases (company_id, charge_type, starts_on desc);

create table er_loans (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references er_organizations(id),
  company_id uuid not null references er_housing_companies(id) on delete cascade,
  name text not null,
  lender text,
  principal_eur numeric(14, 2) not null check (principal_eur >= 0),
  drawn_on date,
  due_on date,
  interest_terms text,
  undrawn_eur numeric(14, 2) not null default 0,
  balance_eur numeric(14, 2),
  balance_date date,
  allocated boolean not null default true,
  purpose text,
  htj_id text,
  htj_submitted_at timestamptz,
  source text not null default 'manual' check (source in ('manual', 'migration', 'htj')),
  created_at timestamptz not null default now()
);

create table er_loan_shares (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references er_organizations(id),
  loan_id uuid not null references er_loans(id) on delete cascade,
  share_group_id uuid not null references er_share_groups(id) on delete cascade,
  original_eur numeric(14, 2) not null check (original_eur >= 0),
  remaining_eur numeric(14, 2) not null check (remaining_eur >= 0),
  balance_date date not null,
  paid_off_on date,
  htj_submitted_at timestamptz,
  created_at timestamptz not null default now(),
  unique (loan_id, share_group_id)
);

-- Kunnossapito- ja muutostyöt (KuMu). share_group_id null = yhtiön työ.
create table er_maintenance_works (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references er_organizations(id),
  company_id uuid not null references er_housing_companies(id) on delete cascade,
  share_group_id uuid references er_share_groups(id) on delete cascade,
  building_id uuid references er_buildings(id) on delete set null,
  project text not null,
  work_type text not null,
  completed_year smallint check (completed_year is null or completed_year between 1900 and 2100),
  completed_on date,
  cost_eur numeric(14, 2),
  description text,
  performed_by text not null default 'company' check (performed_by in ('company', 'shareholder')),
  htj_id text,
  htj_submitted_at timestamptz,
  source text not null default 'manual' check (source in ('manual', 'migration', 'renovation_notice', 'htj')),
  created_at timestamptz not null default now()
);
create index er_maintenance_works_company on er_maintenance_works (company_id, completed_year desc);

-- Osakkaan muutostyöilmoitukset (AOYL 5 luku).
create table er_renovation_notices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references er_organizations(id),
  company_id uuid not null references er_housing_companies(id) on delete cascade,
  share_group_id uuid not null references er_share_groups(id) on delete cascade,
  submitted_by_user_id uuid references er_users(id),
  submitted_by_party_id uuid references er_parties(id),
  description text not null,
  work_type text,
  planned_start date,
  planned_end date,
  status text not null default 'received' check (status in (
    'received', 'info_requested', 'approved', 'approved_with_conditions', 'denied', 'in_progress', 'completed', 'cancelled')),
  conditions text,
  supervisor text,
  decided_on date,
  completed_on date,
  maintenance_work_id uuid references er_maintenance_works(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Kunnossapitotarveselvitys (seuraavat 5 vuotta) / PTS.
create table er_maintenance_needs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references er_organizations(id),
  company_id uuid not null references er_housing_companies(id) on delete cascade,
  planned_year smallint not null check (planned_year between 2000 and 2100),
  target text not null,
  action text not null,
  work_type text,
  estimate_eur numeric(14, 2),
  affects_residents boolean not null default false,
  status text not null default 'planned' check (status in ('planned', 'decided', 'in_progress', 'done', 'postponed', 'cancelled')),
  maintenance_work_id uuid references er_maintenance_works(id) on delete set null,
  htj_submitted_at timestamptz,
  source text not null default 'manual' check (source in ('manual', 'migration')),
  created_at timestamptz not null default now()
);
create index er_maintenance_needs_company on er_maintenance_needs (company_id, planned_year);

do $$
declare
  t text;
begin
  foreach t in array array['er_charge_bases', 'er_loans', 'er_loan_shares', 'er_maintenance_works', 'er_renovation_notices', 'er_maintenance_needs'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy staff_read on %I for select to authenticated using (organization_id in (select er_my_org_ids()))', t);
    execute format(
      'create policy staff_write on %I for all to authenticated
         using (er_has_org_role(organization_id, array[''owner'',''manager'',''assistant'',''accountant'']))
         with check (er_has_org_role(organization_id, array[''owner'',''manager'',''assistant'',''accountant'']))', t);
    execute format('grant select, insert, update, delete on %I to authenticated', t);
    execute format('grant all on %I to service_role', t);
  end loop;
end $$;

-- Portaali: hallitus näkee yhtiön tiedot, osakas oman huoneistonsa lainaosuudet,
-- muutostyöt ja omat muutostyöilmoituksensa.
create policy portal_board on er_charge_bases for select to authenticated
  using (company_id in (select er_portal_company_ids(array['board', 'owner'])));
create policy portal_board on er_loans for select to authenticated
  using (company_id in (select er_portal_company_ids(array['board', 'owner'])));
create policy portal_board_shares on er_loan_shares for select to authenticated
  using (loan_id in (select id from er_loans where company_id in (select er_portal_company_ids(array['board']))));
create policy portal_own_shares on er_loan_shares for select to authenticated
  using (share_group_id in (select er_portal_share_group_ids()));
create policy portal_works on er_maintenance_works for select to authenticated
  using ((share_group_id is null and company_id in (select er_portal_company_ids(array['board', 'owner', 'resident'])))
      or share_group_id in (select er_portal_share_group_ids())
      or company_id in (select er_portal_company_ids(array['board'])));
create policy portal_needs on er_maintenance_needs for select to authenticated
  using (company_id in (select er_portal_company_ids(array['board', 'owner'])));
create policy portal_board_notices on er_renovation_notices for select to authenticated
  using (company_id in (select er_portal_company_ids(array['board'])));
create policy portal_own_notices on er_renovation_notices for select to authenticated
  using (share_group_id in (select er_portal_share_group_ids()));
create policy portal_submit_notice on er_renovation_notices for insert to authenticated
  with check (submitted_by_user_id = er_current_user_id()
              and share_group_id in (select share_group_id from er_portal_access
                                      where user_id = er_current_user_id() and role = 'owner'
                                        and (ends_on is null or ends_on >= current_date)));

create trigger er_renovation_notices_touch before update on er_renovation_notices for each row execute function er_touch_updated_at();
