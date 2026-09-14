-- 0030 Talous: laskutusasetukset, osakeryhmien vakaat viitejärjestysnumerot,
-- laskutusajot ja -rivit, maksutilanne ja maksutilanteen tuonnit.
--
-- eRappu on laskutuksen perusteiden päälähde (kuka maksaa, mistä
-- osakeryhmästä, millä hinnalla). Kirjanpito (Procountor 2027, Adepta PPR
-- 1.1.2028 alkaen) on rahan päälähde: maksutilanne tuodaan sieltä.

-- ---------------------------------------------------------------------------
-- Laskutusasetukset yhtiöittäin
-- ---------------------------------------------------------------------------
create table er_company_billing_settings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references er_organizations(id),
  company_id uuid not null unique references er_housing_companies(id) on delete cascade,
  -- Viitenumeron perusosan alku. Uniikki organisaatiossa, jotta viitteestä
  -- tunnistetaan yhtiö myös yhteisestä maksutiedostosta.
  company_number integer not null check (company_number between 1 and 999999999),
  due_day smallint not null default 5 check (due_day between 1 and 28),
  bank_iban text,
  bank_bic text,
  billing_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, company_number)
);

-- ---------------------------------------------------------------------------
-- Osakeryhmän järjestysnumero viitettä varten. Erillinen taulu, koska numero
-- ei saa muuttua huoneiston tunnuksen, omistajan tai rekisterin muuttuessa,
-- eikä talouden käyttäjä (kirjanpitäjä) muokkaa rekisteritauluja.
-- ---------------------------------------------------------------------------
create table er_billing_unit_numbers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references er_organizations(id),
  company_id uuid not null references er_housing_companies(id) on delete cascade,
  share_group_id uuid not null unique references er_share_groups(id) on delete cascade,
  seq_no integer not null check (seq_no between 1 and 999),
  created_at timestamptz not null default now(),
  unique (company_id, seq_no)
);

-- ---------------------------------------------------------------------------
-- Laskutusajot ja -rivit
-- ---------------------------------------------------------------------------
create table er_billing_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references er_organizations(id),
  company_id uuid not null references er_housing_companies(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  due_on date,
  status text not null default 'draft' check (status in ('draft', 'approved', 'exported', 'cancelled')),
  created_by uuid references er_users(id),
  approved_by uuid references er_users(id),
  approved_at timestamptz,
  exported_at timestamptz,
  export_document_id uuid references er_documents(id) on delete set null,
  -- Vain summia (yhteensä, vastikelajeittain, rivimäärät): hallitus lukee
  -- tätä, joten henkilötietoa ei tänne.
  totals jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (period_end >= period_start)
);
-- Samalle kaudelle yksi voimassa oleva ajo; peruttu ajo ei estä uutta.
create unique index er_billing_runs_period on er_billing_runs (company_id, period_start) where status <> 'cancelled';
create index er_billing_runs_org on er_billing_runs (organization_id, status);

create table er_billing_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references er_organizations(id),
  run_id uuid not null references er_billing_runs(id) on delete cascade,
  share_group_id uuid not null references er_share_groups(id) on delete cascade,
  payer_party_id uuid references er_parties(id) on delete set null,
  charge_basis_id uuid references er_charge_bases(id) on delete set null,
  loan_id uuid references er_loans(id) on delete set null,
  charge_type text not null,
  description text not null,
  quantity numeric(14, 4) not null,
  unit_price numeric(12, 4) not null,
  amount_eur numeric(12, 2) not null,
  vat_percent numeric(4, 1) not null default 0,
  reference_number text not null check (reference_number ~ '^\d{4,20}$'),
  created_at timestamptz not null default now()
);
create index er_billing_lines_run on er_billing_lines (run_id);
create index er_billing_lines_group on er_billing_lines (share_group_id);

-- ---------------------------------------------------------------------------
-- Maksutilanne (vastikereskontra kirjanpidosta)
-- ---------------------------------------------------------------------------
create table er_payment_imports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references er_organizations(id),
  company_id uuid references er_housing_companies(id) on delete cascade,
  file_name text not null,
  as_of date not null,
  rows integer not null default 0,
  matched integer not null default 0,
  -- Kohdistamattomat rivit: viite, huoneisto, summat ja syy. Ei nimiä.
  unmatched jsonb not null default '[]',
  imported_by uuid references er_users(id),
  created_at timestamptz not null default now()
);

create table er_payment_status (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references er_organizations(id),
  company_id uuid not null references er_housing_companies(id) on delete cascade,
  share_group_id uuid not null references er_share_groups(id) on delete cascade,
  party_id uuid references er_parties(id) on delete set null,
  reference_number text,
  open_eur numeric(12, 2) not null default 0,
  overdue_eur numeric(12, 2) not null default 0,
  oldest_due_on date,
  as_of date not null,
  imported_at timestamptz not null default now(),
  import_id uuid references er_payment_imports(id) on delete set null,
  source text not null default 'csv' check (source in ('csv', 'ppr')),
  unique (share_group_id, as_of)
);
create index er_payment_status_company on er_payment_status (company_id, as_of desc);

-- ---------------------------------------------------------------------------
-- RLS-apufunktiot
-- ---------------------------------------------------------------------------

-- Osakkaan (ei asukkaan) osakeryhmät: vastikkeet ja maksutilanne kuuluvat
-- omistajalle, vuokralainen ei näe niitä.
create or replace function er_portal_owner_share_group_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select share_group_id from er_portal_access
   where user_id = er_current_user_id()
     and share_group_id is not null
     and role = 'owner'
     and starts_on <= current_date
     and (ends_on is null or ends_on >= current_date)
$$;

-- Osakas näkee laskutusrivit vasta hyväksytystä ajosta, ei luonnoksesta.
create or replace function er_billing_run_published(p_run uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from er_billing_runs where id = p_run and status in ('approved', 'exported'))
$$;

-- Hallituksen maksutilanne: vain yhtiön summat viimeisimmästä tuonnista.
-- Hallitus ei näe, kenellä saatavat ovat (henkilökohtainen tieto).
create or replace function er_board_payment_summary(p_company uuid)
returns table (as_of date, open_eur numeric, overdue_eur numeric, overdue_units integer, units integer)
language sql stable security definer set search_path = public as $$
  select s.as_of, sum(s.open_eur), sum(s.overdue_eur),
         count(*) filter (where s.overdue_eur > 0)::int, count(*)::int
    from er_payment_status s
   where s.company_id = p_company
     and (p_company in (select er_portal_company_ids(array['board']))
          or s.organization_id in (select er_my_org_ids()))
     and s.as_of = (select max(x.as_of) from er_payment_status x where x.company_id = p_company)
   group by s.as_of
$$;

-- Osakkaan laskutuskaudet: vain hyväksytyt ajot, joissa on hänen
-- osakeryhmänsä rivejä. Ajon summia (koko yhtiö) osakas ei saa.
create or replace function er_portal_billing_run_periods()
returns table (run_id uuid, period_start date, period_end date, due_on date)
language sql stable security definer set search_path = public as $$
  select r.id, r.period_start, r.period_end, r.due_on
    from er_billing_runs r
   where r.status in ('approved', 'exported')
     and exists (select 1 from er_billing_lines l
                  where l.run_id = r.id and l.share_group_id in (select er_portal_owner_share_group_ids()))
$$;

grant execute on function er_portal_billing_run_periods() to authenticated, service_role;
grant execute on function er_portal_owner_share_group_ids() to authenticated, service_role;
grant execute on function er_billing_run_published(uuid) to authenticated, service_role;
grant execute on function er_board_payment_summary(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- RLS: henkilökunta oman organisaation mukaan. Kirjanpitäjä tekee talouden
-- toimenpiteet, joten kirjoitusoikeus on kaikilla henkilökunnan rooleilla
-- kuten 0004:n vastike- ja lainatauluissa.
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['er_company_billing_settings', 'er_billing_unit_numbers', 'er_billing_runs', 'er_billing_lines', 'er_payment_imports', 'er_payment_status'] loop
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

-- Portaali
-- Pankkitiedot osakkaalle ja hallitukselle (maksamista varten).
create policy portal_settings on er_company_billing_settings for select to authenticated
  using (company_id in (select er_portal_company_ids(array['board', 'owner'])));
-- Osakas: oman osakeryhmän järjestysnumero (viite), rivit ja maksutilanne.
create policy portal_own_unit_numbers on er_billing_unit_numbers for select to authenticated
  using (share_group_id in (select er_portal_owner_share_group_ids()));
create policy portal_own_lines on er_billing_lines for select to authenticated
  using (share_group_id in (select er_portal_owner_share_group_ids()) and er_billing_run_published(run_id));
create policy portal_own_status on er_payment_status for select to authenticated
  using (share_group_id in (select er_portal_owner_share_group_ids()));
-- Hallitus: yhtiön hyväksytyt ajot summineen. Rivejä ja henkilökohtaista
-- maksutilannetta ei (er_board_payment_summary antaa summat).
create policy portal_board_runs on er_billing_runs for select to authenticated
  using (status in ('approved', 'exported') and company_id in (select er_portal_company_ids(array['board'])));

create trigger er_company_billing_settings_touch before update on er_company_billing_settings for each row execute function er_touch_updated_at();
create trigger er_billing_runs_touch before update on er_billing_runs for each row execute function er_touch_updated_at();
