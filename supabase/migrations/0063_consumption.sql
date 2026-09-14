-- 0063 Kulutusseuranta: sähkö, vesi ja lämpö yhtiöittäin (ja tarvittaessa
-- huoneistoittain).
--
-- Lukema on aina jakso (alku- ja loppupäivä), koska laskut ja
-- energiayhtiöiden raportit tulevat kuukausina, neljänneksinä tai vuosina.
-- Sama yhtiö, laji ja jakso on yksi rivi, jotta CSV:n voi tuoda uudelleen.

create table er_consumption_readings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references er_organizations(id),
  company_id uuid not null references er_housing_companies(id) on delete cascade,
  share_group_id uuid references er_share_groups(id) on delete cascade,
  utility text not null check (utility in ('electricity', 'water', 'heat')),
  period_start date not null,
  period_end date not null,
  amount numeric(16, 3) not null check (amount >= 0),
  unit text not null check (unit in ('kWh', 'MWh', 'm3')),
  cost_eur numeric(14, 2) check (cost_eur is null or cost_eur >= 0),
  source text not null default 'manual' check (source in ('manual', 'csv')),
  created_by uuid references er_users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (period_end >= period_start),
  check ((utility = 'water') = (unit = 'm3'))
);
create unique index er_consumption_company_period on er_consumption_readings (company_id, utility, period_start, period_end)
  where share_group_id is null;
create unique index er_consumption_group_period on er_consumption_readings (share_group_id, utility, period_start, period_end)
  where share_group_id is not null;
create index er_consumption_company on er_consumption_readings (company_id, utility, period_start);

alter table er_consumption_readings enable row level security;
create policy staff_read on er_consumption_readings for select to authenticated
  using (organization_id in (select er_my_org_ids()));
create policy staff_write on er_consumption_readings for all to authenticated
  using (er_has_org_role(organization_id, array['owner', 'manager', 'assistant', 'accountant']))
  with check (
    er_has_org_role(organization_id, array['owner', 'manager', 'assistant', 'accountant'])
    and company_id in (select id from er_housing_companies where organization_id = er_consumption_readings.organization_id)
  );
create policy portal_board on er_consumption_readings for select to authenticated
  using (company_id in (select er_portal_company_ids(array['board'])));

grant select, insert, update, delete on er_consumption_readings to authenticated;
grant all on er_consumption_readings to service_role;
