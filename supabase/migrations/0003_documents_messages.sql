-- 0003 Dokumentit, lähtevät viestit ja tehtävälinkit.
--
-- Nämä ovat yhteisiä kaikille moduuleille: huoltopyynnön kuva, kokouksen
-- pöytäkirja ja isännöitsijäntodistus ovat kaikki dokumentteja, ja kaikki
-- ilmoitukset kulkevat samaa lähetysjonoa.

create table er_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references er_organizations(id),
  company_id uuid references er_housing_companies(id) on delete cascade,
  share_group_id uuid references er_share_groups(id) on delete cascade,
  category text not null check (category in (
    'articles', 'financial_statement', 'budget', 'energy_certificate', 'floor_plan',
    'minutes', 'meeting_notice', 'contract', 'condition_assessment', 'maintenance_plan',
    'manager_certificate', 'photo', 'insurance', 'other')),
  title text not null,
  file_name text not null,
  storage_path text not null unique,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes >= 0),
  sha256 text not null,
  visibility text not null default 'internal'
    check (visibility in ('internal', 'board', 'owners', 'residents', 'provider', 'reporter')),
  year smallint,
  subject_table text,
  subject_id uuid,
  sealed boolean not null default false,
  uploaded_by uuid references er_users(id),
  created_at timestamptz not null default now()
);
create index er_documents_company on er_documents (company_id, category);
create index er_documents_subject on er_documents (subject_table, subject_id);

create table er_outbound_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references er_organizations(id),
  channel text not null check (channel in ('email', 'sms', 'letter', 'push')),
  recipient text not null,
  party_id uuid references er_parties(id) on delete set null,
  subject text not null,
  body text not null,
  subject_table text,
  subject_id uuid,
  status text not null default 'queued' check (status in ('queued', 'sent', 'delivered', 'failed')),
  provider_message_id text,
  error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index er_outbound_messages_status on er_outbound_messages (status, created_at);

-- Allekirjoitetut, vanhenevat linkit ilman kirjautumista (palveluntuottajan
-- tehtävä, julkinen huoltopyyntölomake, todistustilaus). Vain tiiviste
-- tallennetaan.
create table er_access_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references er_organizations(id),
  purpose text not null check (purpose in ('provider_task', 'public_request_form', 'certificate_order', 'invite')),
  token_hash text not null unique,
  subject_table text not null,
  subject_id uuid not null,
  expires_at timestamptz,
  revoked_at timestamptz,
  last_used_at timestamptz,
  created_by uuid references er_users(id),
  created_at timestamptz not null default now()
);

alter table er_documents enable row level security;
alter table er_outbound_messages enable row level security;
alter table er_access_links enable row level security;

create policy staff_read on er_documents for select to authenticated
  using (organization_id in (select er_my_org_ids()));
create policy staff_write on er_documents for all to authenticated
  using (er_has_org_role(organization_id, array['owner', 'manager', 'assistant', 'accountant']))
  with check (er_has_org_role(organization_id, array['owner', 'manager', 'assistant', 'accountant']));
create policy portal_board_docs on er_documents for select to authenticated
  using (visibility in ('board', 'owners', 'residents')
         and company_id in (select er_portal_company_ids(array['board'])));
create policy portal_owner_docs on er_documents for select to authenticated
  using ((visibility in ('owners', 'residents') and share_group_id is null
          and company_id in (select er_portal_company_ids(array['owner'])))
      or (visibility in ('owners', 'residents') and share_group_id in (select er_portal_share_group_ids())));
create policy portal_resident_docs on er_documents for select to authenticated
  using (visibility = 'residents' and share_group_id is null
         and company_id in (select er_portal_company_ids(array['resident'])));

create policy staff_read on er_outbound_messages for select to authenticated
  using (organization_id in (select er_my_org_ids()));
create policy staff_insert on er_outbound_messages for insert to authenticated
  with check (organization_id in (select er_my_org_ids()));

create policy staff_all on er_access_links for all to authenticated
  using (er_has_org_role(organization_id, array['owner', 'manager', 'assistant']))
  with check (er_has_org_role(organization_id, array['owner', 'manager', 'assistant']));

grant select, insert, update, delete on er_documents to authenticated;
grant select, insert on er_outbound_messages to authenticated;
grant select, insert, update, delete on er_access_links to authenticated;
grant all on er_documents, er_outbound_messages, er_access_links to service_role;
