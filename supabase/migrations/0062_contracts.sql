-- 0062 Sopimusrekisteri: vakuutukset, huolto, siivous, energia, jätehuolto.
--
-- Irtisanomisen viimeinen päivä lasketaan sovelluksessa (ends_on miinus
-- notice_months). reminder_on on päivä, jolloin muistutus lähtee, ja
-- reminded_at estää saman muistutuksen lähtemisen kahdesti.

create table er_contracts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references er_organizations(id),
  company_id uuid not null references er_housing_companies(id) on delete cascade,
  counterparty text not null check (length(counterparty) between 1 and 200),
  category text not null default 'other' check (category in (
    'insurance', 'maintenance_service', 'cleaning', 'electricity', 'heating', 'water', 'waste',
    'antenna_broadband', 'elevator', 'other')),
  description text check (description is null or length(description) <= 4000),
  starts_on date,
  ends_on date,
  notice_months smallint check (notice_months is null or notice_months between 0 and 60),
  annual_cost_eur numeric(14, 2) check (annual_cost_eur is null or annual_cost_eur >= 0),
  document_id uuid references er_documents(id) on delete set null,
  reminder_on date,
  reminded_at timestamptz,
  status text not null default 'active' check (status in ('active', 'ending', 'ended')),
  created_by uuid references er_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_on is null or starts_on is null or ends_on >= starts_on)
);
create index er_contracts_company on er_contracts (company_id, status);
create index er_contracts_reminder on er_contracts (reminder_on) where reminded_at is null and status <> 'ended';

create trigger er_contracts_touch before update on er_contracts for each row execute function er_touch_updated_at();

alter table er_contracts enable row level security;
create policy staff_read on er_contracts for select to authenticated
  using (organization_id in (select er_my_org_ids()));
create policy staff_write on er_contracts for all to authenticated
  using (er_has_org_role(organization_id, array['owner', 'manager', 'assistant']))
  with check (
    er_has_org_role(organization_id, array['owner', 'manager', 'assistant'])
    and company_id in (select id from er_housing_companies where organization_id = er_contracts.organization_id)
  );
-- Hallitus tekee sopimuspäätökset, joten se näkee yhtiön sopimukset.
create policy portal_board on er_contracts for select to authenticated
  using (company_id in (select er_portal_company_ids(array['board'])));

grant select, insert, update, delete on er_contracts to authenticated;
grant all on er_contracts to service_role;
