-- 0080 Sopimuspohjat ja sopimusten massaluonti.
--
-- Pohjat ovat koodissa (src/lib/contract-templates), täytetyt arvot täällä.
-- Erä = yksi pohja, yksi urakoitsija ja yhteiset arvot usealle yhtiölle.
-- Erän rivi = yksi yhtiö: yhtiökohtaiset arvot, muodostettu sopimus ja
-- allekirjoituskierros.

create table er_contract_batches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references er_organizations(id),
  template_key text not null check (template_key ~ '^[a-z0-9-]{1,60}$'),
  template_version integer not null check (template_version > 0),
  title text not null check (length(title) between 1 and 200),
  provider_id uuid references er_service_providers(id) on delete set null,
  shared_values jsonb not null default '{}' check (jsonb_typeof(shared_values) = 'object'),
  status text not null default 'draft' check (status in ('draft', 'generated', 'sent', 'completed', 'cancelled')),
  previous_batch_id uuid references er_contract_batches(id) on delete set null,
  created_by uuid references er_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index er_contract_batches_org on er_contract_batches (organization_id, created_at desc);

create table er_contract_batch_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references er_organizations(id),
  batch_id uuid not null references er_contract_batches(id) on delete cascade,
  company_id uuid not null references er_housing_companies(id) on delete cascade,
  "values" jsonb not null default '{}' check (jsonb_typeof("values") = 'object'),
  status text not null default 'draft' check (status in ('draft', 'generated', 'sent', 'signed', 'declined', 'cancelled', 'error')),
  error text check (error is null or length(error) <= 500),
  contract_id uuid references er_contracts(id) on delete set null,
  document_id uuid references er_documents(id) on delete set null,
  signing_round_id uuid references er_signing_rounds(id) on delete set null,
  sealed_document_id uuid references er_documents(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (batch_id, company_id)
);
create index er_contract_batch_items_company on er_contract_batch_items (company_id);
create index er_contract_batch_items_status on er_contract_batch_items (organization_id, status);

create trigger er_contract_batches_touch before update on er_contract_batches for each row execute function er_touch_updated_at();
create trigger er_contract_batch_items_touch before update on er_contract_batch_items for each row execute function er_touch_updated_at();

-- Edellisen erän organisaatio. Security definer, koska politiikka ei voi
-- kysyä omaa tauluaan (rekursio).
create or replace function er_contract_batch_org(batch uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select organization_id from er_contract_batches where id = batch
$$;
revoke all on function er_contract_batch_org(uuid) from public;
grant execute on function er_contract_batch_org(uuid) to authenticated, service_role;

alter table er_contract_batches enable row level security;
alter table er_contract_batch_items enable row level security;

-- Kirjanpitäjä näkee erät (kustannukset), mutta ei tee sopimuksia.
create policy staff_read on er_contract_batches for select to authenticated
  using (organization_id in (select er_my_org_ids()));
create policy staff_write on er_contract_batches for all to authenticated
  using (er_has_org_role(organization_id, array['owner', 'manager', 'assistant']))
  with check (
    er_has_org_role(organization_id, array['owner', 'manager', 'assistant'])
    and (provider_id is null or provider_id in (select id from er_service_providers where organization_id = er_contract_batches.organization_id))
    and (previous_batch_id is null or er_contract_batch_org(previous_batch_id) = organization_id)
  );

create policy staff_read on er_contract_batch_items for select to authenticated
  using (organization_id in (select er_my_org_ids()));
-- Rivi ei voi osoittaa toisen organisaation yhtiöön, erään, sopimukseen eikä dokumenttiin.
create policy staff_write on er_contract_batch_items for all to authenticated
  using (er_has_org_role(organization_id, array['owner', 'manager', 'assistant']))
  with check (
    er_has_org_role(organization_id, array['owner', 'manager', 'assistant'])
    and company_id in (select id from er_housing_companies where organization_id = er_contract_batch_items.organization_id)
    and batch_id in (select id from er_contract_batches where organization_id = er_contract_batch_items.organization_id)
    and (contract_id is null or contract_id in (select id from er_contracts where organization_id = er_contract_batch_items.organization_id and company_id = er_contract_batch_items.company_id))
    and (document_id is null or document_id in (select id from er_documents where organization_id = er_contract_batch_items.organization_id))
    and (sealed_document_id is null or sealed_document_id in (select id from er_documents where organization_id = er_contract_batch_items.organization_id))
  );
-- Hallitus näkee oman yhtiönsä sopimukset (er_contracts portal_board), joten
-- myös niiden allekirjoitustilan.
create policy portal_board on er_contract_batch_items for select to authenticated
  using (company_id in (select er_portal_company_ids(array['board'])));

grant select, insert, update, delete on er_contract_batches to authenticated;
grant select, insert, update, delete on er_contract_batch_items to authenticated;
grant all on er_contract_batches to service_role;
grant all on er_contract_batch_items to service_role;
