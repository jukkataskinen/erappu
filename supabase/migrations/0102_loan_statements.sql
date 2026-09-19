-- 0102 Lainaosuuslaskelmat ja rahoitusvastikkeiden jälkilaskelma tilinpäätökseen.
--
-- AOYL 10:5 §:n 1 kohta: toimintakertomuksessa on oltava tiedot
-- yhtiövastikkeen käytöstä, jos vastike voidaan periä eri tarkoituksiin
-- eri perustein. Lainojen tilikauden tapahtumat (alkusaldo, nostot,
-- lyhennykset, kertasuoritukset, loppusaldo, korot) kirjataan lainoittain
-- pankin saldo- ja kirjanpidon tiedoista. Osakeryhmäkohtainen
-- lainaosuuslaskelma lasketaan niistä osakkeiden suhteessa.

-- Kertasuorituksen määrä: tähän asti vain päivä (paid_off_on).
alter table er_loan_shares add column paid_off_eur numeric(14, 2) check (paid_off_eur is null or paid_off_eur >= 0);

create table er_loan_periods (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references er_organizations(id),
  company_id uuid not null references er_housing_companies(id) on delete cascade,
  loan_id uuid not null references er_loans(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  opening_balance_eur numeric(14, 2) not null check (opening_balance_eur >= 0),
  drawn_eur numeric(14, 2) not null default 0 check (drawn_eur >= 0),
  -- Lyhennykset maksuohjelman mukaan (rahoitusvastikkeilla), ei kertasuorituksia.
  amortization_eur numeric(14, 2) not null default 0 check (amortization_eur >= 0),
  lump_sum_eur numeric(14, 2) not null default 0 check (lump_sum_eur >= 0),
  closing_balance_eur numeric(14, 2) not null check (closing_balance_eur >= 0),
  interest_eur numeric(14, 2) not null default 0 check (interest_eur >= 0),
  note text,
  updated_by uuid references er_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (period_end > period_start),
  unique (loan_id, period_start)
);
create index er_loan_periods_company on er_loan_periods (company_id, period_start);

-- Yhtiötason jälkilaskelma tilikaudelta. Hoidon rivit ovat valinnaisia
-- (tyhjä = ei esitetä); rahoituksen rivit tulevat kirjanpidosta.
create table er_charge_statements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references er_organizations(id),
  company_id uuid not null references er_housing_companies(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  maintenance_income_eur numeric(14, 2),
  maintenance_expenses_eur numeric(14, 2),
  -- Rahoitusvastikkeet (pääomavastikkeet) tuottoina tilikaudella.
  financing_income_eur numeric(14, 2),
  -- Katetaanko lainojen korot rahoitusvastikkeilla (muuten hoitovastikkeella).
  interest_from_financing boolean not null default true,
  -- Edellisiltä tilikausilta siirretyt käyttämättömät rahoitusvastikkeet (tase).
  carried_in_eur numeric(14, 2) not null default 0,
  note text,
  updated_by uuid references er_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (period_end > period_start),
  unique (company_id, period_start)
);

do $$
declare
  t text;
begin
  foreach t in array array['er_loan_periods', 'er_charge_statements'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy staff_read on %I for select to authenticated using (organization_id in (select er_my_org_ids()))', t);
    execute format(
      'create policy staff_write on %I for all to authenticated
         using (er_has_org_role(organization_id, array[''owner'',''manager'',''assistant'',''accountant'']))
         with check (er_has_org_role(organization_id, array[''owner'',''manager'',''assistant'',''accountant'']))', t);
    execute format('grant select, insert, update, delete on %I to authenticated', t);
    execute format('grant all on %I to service_role', t);
    execute format('create trigger %I before update on %I for each row execute function er_touch_updated_at()', t || '_touch', t);
  end loop;
end $$;
