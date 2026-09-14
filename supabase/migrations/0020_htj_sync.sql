-- 0020 HTJ: synkronoinnit, hakuloki, vertailuerot ja HTJ2-ilmoitusjono.
--
-- HTJ on omistustietojen päälähde, mutta mitään ei kirjoiteta rekisteriin
-- ilman isännöitsijän hyväksyntää: haku tuottaa erot (er_htj_diffs), ja vasta
-- hyväksytyt erot päivittävät osakeryhmät ja omistukset. Ilmoitukset HTJ:hin
-- kulkevat jonon kautta (er_htj_submissions): kirjanpitäjä saa valmistella
-- luonnoksen, mutta vain pääkäyttäjä tai isännöitsijä hyväksyy ja lähettää.
--
-- Henkilötunnuksia ei tallenneta mihinkään näistä tauluista. Hakuloki
-- sisältää vain sen, kuka haki, milloin, mitä yhtiötä ja mihin tarkoitukseen.

-- ---------------------------------------------------------------------------
-- Synkronoinnit (haku HTJ:stä tai ilmoitus HTJ:hin)
-- ---------------------------------------------------------------------------
create table er_htj_syncs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references er_organizations(id),
  company_id uuid references er_housing_companies(id) on delete cascade,
  kind text not null check (kind in ('fetch', 'submit')),
  target text not null,
  started_by uuid references er_users(id),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running' check (status in ('running', 'ok', 'warnings', 'error')),
  summary jsonb not null default '{}',
  error text
);
create index er_htj_syncs_company on er_htj_syncs (company_id, started_at desc);

-- ---------------------------------------------------------------------------
-- Hakuloki (MML:n ehto: jokainen haku kirjataan omaan järjestelmään)
-- ---------------------------------------------------------------------------
create table er_htj_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references er_organizations(id),
  company_id uuid references er_housing_companies(id) on delete set null,
  sync_id uuid references er_htj_syncs(id) on delete set null,
  -- null = ajastettu tehtävä
  user_id uuid references er_users(id),
  operation text not null check (operation in (
    'company', 'share_groups', 'owners', 'restrictions', 'changes', 'submit')),
  business_id text,
  scope text check (scope in ('narrow', 'wide')),
  purpose text not null check (purpose in (
    'registry_sync', 'change_sync', 'htj2_submission', 'manager_certificate', 'meeting')),
  mode text not null check (mode in ('mock', 'mml')),
  outcome text not null check (outcome in ('ok', 'not_found', 'error')),
  http_status integer,
  result_count integer,
  duration_ms integer,
  error_code text,
  created_at timestamptz not null default now()
);
create index er_htj_requests_org on er_htj_requests (organization_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Vertailuerot rekisterin ja HTJ:n välillä
-- ---------------------------------------------------------------------------
create table er_htj_diffs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references er_organizations(id),
  company_id uuid not null references er_housing_companies(id) on delete cascade,
  sync_id uuid not null references er_htj_syncs(id) on delete cascade,
  entity text not null check (entity in ('share_group', 'ownership')),
  action text not null check (action in ('add', 'update', 'remove')),
  local_id uuid,
  htj_ref text,
  label text not null,
  before jsonb,
  after jsonb,
  sort_order integer not null default 0,
  -- superseded = uudempi haku korvasi käsittelemättömän eron
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected', 'superseded')),
  decided_by uuid references er_users(id),
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create index er_htj_diffs_pending on er_htj_diffs (company_id, status, sort_order);

-- ---------------------------------------------------------------------------
-- HTJ2-ilmoitusjono
-- ---------------------------------------------------------------------------
create table er_htj_submissions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references er_organizations(id),
  company_id uuid not null references er_housing_companies(id) on delete cascade,
  kind text not null check (kind in ('charges', 'loans', 'loan_shares', 'maintenance_works', 'maintenance_needs')),
  payload jsonb not null default '{}',
  status text not null default 'draft' check (status in ('draft', 'approved', 'sent', 'accepted', 'rejected', 'manual_done')),
  prepared_by uuid references er_users(id),
  approved_by uuid references er_users(id),
  approved_at timestamptz,
  sent_at timestamptz,
  response jsonb,
  error text,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Muu kuin luonnos vaatii aina hyväksyjän.
  check (status = 'draft' or approved_by is not null)
);
create index er_htj_submissions_company on er_htj_submissions (company_id, created_at desc);
create trigger er_htj_submissions_touch before update on er_htj_submissions for each row execute function er_touch_updated_at();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table er_htj_syncs enable row level security;
alter table er_htj_requests enable row level security;
alter table er_htj_diffs enable row level security;
alter table er_htj_submissions enable row level security;

-- Synkronoinnit ja erot: kaikki henkilökunta näkee, isännöitsijä ja
-- pääkäyttäjä hakevat ja päättävät, koska hyväksyntä muuttaa omistustietoja.
create policy staff_read on er_htj_syncs for select to authenticated
  using (organization_id in (select er_my_org_ids()));
create policy manager_write on er_htj_syncs for all to authenticated
  using (er_has_org_role(organization_id, array['owner', 'manager']))
  with check (er_has_org_role(organization_id, array['owner', 'manager']));
-- Kirjanpitäjän ilmoituksen valmistelu ei ole synkronointi, mutta lähetys on:
-- lähetyksen tekee aina pääkäyttäjä tai isännöitsijä (manager_write).

create policy staff_read on er_htj_diffs for select to authenticated
  using (organization_id in (select er_my_org_ids()));
create policy manager_write on er_htj_diffs for all to authenticated
  using (er_has_org_role(organization_id, array['owner', 'manager']))
  with check (er_has_org_role(organization_id, array['owner', 'manager']));

-- Hakuloki: luku vain pääkäyttäjälle ja isännöitsijälle, kirjoitus vain omalla
-- nimellä. Rivejä ei voi muuttaa eikä poistaa käyttäjäroolilla.
create policy manager_read on er_htj_requests for select to authenticated
  using (er_has_org_role(organization_id, array['owner', 'manager']));
create policy staff_insert on er_htj_requests for insert to authenticated
  with check (organization_id in (select er_my_org_ids()) and user_id = er_current_user_id());

-- Ilmoitukset: kirjanpitäjä ja assistentti valmistelevat luonnoksia, vain
-- pääkäyttäjä ja isännöitsijä hyväksyvät, lähettävät ja merkitsevät käsin
-- tehdyiksi.
create policy staff_read on er_htj_submissions for select to authenticated
  using (organization_id in (select er_my_org_ids()));
create policy prepare_insert on er_htj_submissions for insert to authenticated
  with check (er_has_org_role(organization_id, array['accountant', 'assistant'])
              and status = 'draft' and approved_by is null);
create policy prepare_update on er_htj_submissions for update to authenticated
  using (er_has_org_role(organization_id, array['accountant', 'assistant']) and status = 'draft')
  with check (er_has_org_role(organization_id, array['accountant', 'assistant'])
              and status = 'draft' and approved_by is null);
create policy prepare_delete on er_htj_submissions for delete to authenticated
  using (er_has_org_role(organization_id, array['accountant', 'assistant']) and status = 'draft');
create policy manager_all on er_htj_submissions for all to authenticated
  using (er_has_org_role(organization_id, array['owner', 'manager']))
  with check (er_has_org_role(organization_id, array['owner', 'manager']));

grant select, insert, update, delete on er_htj_syncs, er_htj_diffs, er_htj_submissions to authenticated;
grant select, insert on er_htj_requests to authenticated;
grant all on er_htj_syncs, er_htj_requests, er_htj_diffs, er_htj_submissions to service_role;
