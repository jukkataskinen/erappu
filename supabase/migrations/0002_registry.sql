-- 0002 Rekisteri: taloyhtiöt, kiinteistöt, rakennukset, osakeryhmät ja
-- osakevälit, osapuolet, omistukset, asuminen, hallitukset,
-- palveluntuottajat ja portaalioikeudet.
--
-- HTJ on omistustietojen päälähde. Sarake `source` kertoo, mistä rivi tuli,
-- ja HTJ-peräisiä rivejä ei muokata käyttöliittymästä.

-- ---------------------------------------------------------------------------
-- Taloyhtiöt
-- ---------------------------------------------------------------------------
create table er_housing_companies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references er_organizations(id),
  name text not null,
  business_id text not null,
  company_form text not null default 'asunto_oy'
    check (company_form in ('asunto_oy', 'koy', 'other')),
  street_address text,
  postal_code text,
  city text,
  articles_date date,
  fiscal_year_start text not null default '01-01' check (fiscal_year_start ~ '^\d{2}-\d{2}$'),
  total_shares integer check (total_shares is null or total_shares > 0),
  manager_user_id uuid references er_users(id),
  management_started_on date,
  management_ended_on date,
  redemption_clause jsonb not null default '{}',
  same_charge_basis boolean,
  insurance_company text,
  insurance_type text,
  property_maintenance text,
  commercial_register_note text,
  htj_id text,
  htj_synced_at timestamptz,
  extra jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, business_id)
);
create index er_housing_companies_org on er_housing_companies (organization_id);

create table er_properties (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references er_organizations(id),
  company_id uuid not null references er_housing_companies(id) on delete cascade,
  property_code text not null,
  tenure text check (tenure in ('own', 'lease')),
  area_m2 numeric(12, 1),
  lessor text,
  lease_ends_on date,
  annual_rent_eur numeric(12, 2),
  rent_review_basis text,
  building_rights_m2 numeric(12, 1),
  unused_building_rights_m2 numeric(12, 1),
  parking_spaces_planned integer,
  parking_spaces_built integer,
  created_at timestamptz not null default now()
);

create table er_buildings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references er_organizations(id),
  company_id uuid not null references er_housing_companies(id) on delete cascade,
  label text,
  permanent_building_id text,
  building_type text,
  completed_year smallint,
  floors smallint,
  staircases smallint,
  elevators smallint not null default 0,
  floor_area_m2 numeric(10, 1),
  apartment_area_m2 numeric(10, 1),
  volume_m3 numeric(10, 1),
  construction_material text,
  roof_type text,
  roof_material text,
  heating text,
  ventilation text,
  antenna text,
  energy_class text,
  energy_certificate_year smallint,
  common_spaces text[] not null default '{}',
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Osakeryhmät (huoneistot, autopaikat, varastot) ja osakevälit
-- ---------------------------------------------------------------------------
create table er_share_groups (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references er_organizations(id),
  company_id uuid not null references er_housing_companies(id) on delete cascade,
  building_id uuid references er_buildings(id) on delete set null,
  unit_label text not null,
  kind text not null default 'apartment'
    check (kind in ('apartment', 'commercial', 'parking', 'garage', 'storage', 'other')),
  layout text,
  floor text,
  area_m2 numeric(8, 1) check (area_m2 is null or area_m2 >= 0),
  intended_use text,
  share_count integer not null default 0,
  is_rented boolean not null default false,
  htj_id text,
  source text not null default 'manual' check (source in ('htj', 'manual', 'migration')),
  removed_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, unit_label)
);
create index er_share_groups_company on er_share_groups (company_id);

create table er_share_ranges (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references er_organizations(id),
  company_id uuid not null references er_housing_companies(id) on delete cascade,
  share_group_id uuid not null references er_share_groups(id) on delete cascade,
  first_share integer not null check (first_share >= 1),
  last_share integer not null,
  check (last_share >= first_share),
  -- Sama osakenumero ei voi kuulua kahteen osakeryhmään. Accessissa tämä
  -- virhe oli mahdollinen (As Oy Toivakan Rantatuuli, huoneistot 3 ja 4).
  exclude using gist (company_id with =, int4range(first_share, last_share, '[]') with &&)
);
create index er_share_ranges_group on er_share_ranges (share_group_id);

-- Osakeryhmän osakemäärä lasketaan aina väleistä, ei syötetä käsin.
create or replace function er_recount_shares() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  gid uuid := coalesce(new.share_group_id, old.share_group_id);
begin
  update er_share_groups
     set share_count = coalesce((select sum(last_share - first_share + 1)
                                   from er_share_ranges where share_group_id = gid), 0)
   where id = gid;
  if tg_op = 'UPDATE' and old.share_group_id <> new.share_group_id then
    update er_share_groups
       set share_count = coalesce((select sum(last_share - first_share + 1)
                                     from er_share_ranges where share_group_id = old.share_group_id), 0)
     where id = old.share_group_id;
  end if;
  return null;
end $$;
create trigger er_share_ranges_recount after insert or update or delete on er_share_ranges
  for each row execute function er_recount_shares();

-- ---------------------------------------------------------------------------
-- Osapuolet, omistukset, asuminen, hallitukset
-- ---------------------------------------------------------------------------
create table er_parties (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references er_organizations(id),
  kind text not null default 'person' check (kind in ('person', 'company', 'estate')),
  first_names text,
  last_name text,
  company_name text,
  display_name text generated always as (
    coalesce(nullif(trim(coalesce(first_names, '') || ' ' || coalesce(last_name, '')), ''), company_name)
  ) stored,
  business_id text,
  email text,
  phone text,
  street_address text,
  postal_code text,
  city text,
  country text not null default 'FI',
  locale text not null default 'fi',
  electronic_notice_consent boolean not null default false,
  user_id uuid references er_users(id) on delete set null,
  htj_id text,
  accounting_customer_no text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index er_parties_org on er_parties (organization_id);

-- Arkaluonteiset tunnisteet erikseen. Ei RLS-politiikkaa lainkaan: vain
-- palvelinkoodi service_role-roolilla, ja jokainen luku kirjataan lokiin.
create table er_party_identifiers (
  party_id uuid primary key references er_parties(id) on delete cascade,
  organization_id uuid not null references er_organizations(id),
  birth_date date,
  hetu_hmac text,
  hetu_encrypted text,
  hetu_suffix text,
  source text not null check (source in ('htj', 'manual', 'ftn')),
  updated_at timestamptz not null default now()
);

create table er_ownerships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references er_organizations(id),
  share_group_id uuid not null references er_share_groups(id) on delete cascade,
  party_id uuid not null references er_parties(id),
  share_numerator integer not null default 1 check (share_numerator > 0),
  share_denominator integer not null default 1 check (share_denominator > 0),
  starts_on date,
  ends_on date,
  source text not null default 'htj' check (source in ('htj', 'manual', 'migration')),
  htj_id text,
  created_at timestamptz not null default now(),
  check (ends_on is null or starts_on is null or ends_on >= starts_on)
);
create index er_ownerships_group on er_ownerships (share_group_id) where ends_on is null;
create index er_ownerships_party on er_ownerships (party_id);

create table er_residencies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references er_organizations(id),
  share_group_id uuid not null references er_share_groups(id) on delete cascade,
  party_id uuid not null references er_parties(id),
  role text not null check (role in ('owner', 'tenant', 'other')),
  short_term_rental boolean not null default false,
  starts_on date,
  ends_on date,
  created_at timestamptz not null default now()
);
create index er_residencies_group on er_residencies (share_group_id) where ends_on is null;

create table er_board_memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references er_organizations(id),
  company_id uuid not null references er_housing_companies(id) on delete cascade,
  party_id uuid not null references er_parties(id),
  role text not null check (role in ('chair', 'member', 'deputy', 'operations_auditor', 'deputy_operations_auditor', 'auditor')),
  starts_on date not null,
  ends_on date,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Palveluntuottajat
-- ---------------------------------------------------------------------------
create table er_service_providers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references er_organizations(id),
  name text not null,
  business_id text,
  email text,
  phone text,
  emergency_phone text,
  trades text[] not null default '{}',
  notes text,
  created_at timestamptz not null default now()
);

create table er_company_services (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references er_organizations(id),
  company_id uuid not null references er_housing_companies(id) on delete cascade,
  provider_id uuid not null references er_service_providers(id) on delete cascade,
  service text not null,
  default_for_requests boolean not null default false,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Portaalioikeudet (osakas, asukas, hallitus, palveluntuottaja)
--
-- Johdetaan omistuksista, asumisista ja hallitusjäsenyyksistä. Sovellus
-- ylläpitää rivejä (src/lib/registry/portal-access.ts) ja `basis` kertoo
-- perusteen, jotta oikeus päättyy perusteen päättyessä.
-- ---------------------------------------------------------------------------
create table er_portal_access (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references er_organizations(id),
  user_id uuid not null references er_users(id) on delete cascade,
  company_id uuid not null references er_housing_companies(id) on delete cascade,
  share_group_id uuid references er_share_groups(id) on delete cascade,
  provider_id uuid references er_service_providers(id) on delete cascade,
  role text not null check (role in ('board', 'owner', 'resident', 'provider')),
  basis text not null,
  starts_on date not null default current_date,
  ends_on date,
  created_at timestamptz not null default now(),
  unique (user_id, company_id, role, basis)
);
create index er_portal_access_user on er_portal_access (user_id) where ends_on is null;

create or replace function er_portal_company_ids(roles text[]) returns setof uuid
language sql stable security definer set search_path = public as $$
  select company_id from er_portal_access
   where user_id = er_current_user_id()
     and role = any(roles)
     and starts_on <= current_date
     and (ends_on is null or ends_on >= current_date)
$$;

create or replace function er_portal_share_group_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select share_group_id from er_portal_access
   where user_id = er_current_user_id()
     and share_group_id is not null
     and role in ('owner', 'resident')
     and starts_on <= current_date
     and (ends_on is null or ends_on >= current_date)
$$;

grant execute on function er_portal_company_ids(text[]) to authenticated, service_role;
grant execute on function er_portal_share_group_ids() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- RLS: henkilökunta näkee oman organisaationsa. Kirjanpitäjä ja assistentti
-- lukevat, isännöitsijä ja omistaja kirjoittavat. Portaalikäyttäjät lukevat
-- vain sen, mikä heille kuuluu.
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'er_housing_companies', 'er_properties', 'er_buildings', 'er_share_groups',
    'er_share_ranges', 'er_parties', 'er_ownerships', 'er_residencies',
    'er_board_memberships', 'er_service_providers', 'er_company_services'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format(
      'create policy staff_read on %I for select to authenticated using (organization_id in (select er_my_org_ids()))', t);
    execute format(
      'create policy staff_write on %I for all to authenticated
         using (er_has_org_role(organization_id, array[''owner'',''manager'',''assistant'']))
         with check (er_has_org_role(organization_id, array[''owner'',''manager'',''assistant'']))', t);
    execute format('grant select, insert, update, delete on %I to authenticated', t);
    execute format('grant all on %I to service_role', t);
  end loop;
end $$;

alter table er_party_identifiers enable row level security;
grant all on er_party_identifiers to service_role;

alter table er_portal_access enable row level security;
create policy portal_access_self on er_portal_access for select to authenticated
  using (user_id = er_current_user_id());
create policy portal_access_staff on er_portal_access for all to authenticated
  using (er_has_org_role(organization_id, array['owner', 'manager']))
  with check (er_has_org_role(organization_id, array['owner', 'manager']));
grant select, insert, update, delete on er_portal_access to authenticated;
grant all on er_portal_access to service_role;

-- Portaalin lukuoikeudet
create policy portal_company on er_housing_companies for select to authenticated
  using (id in (select er_portal_company_ids(array['board', 'owner', 'resident', 'provider'])));
create policy portal_buildings on er_buildings for select to authenticated
  using (company_id in (select er_portal_company_ids(array['board', 'owner', 'resident'])));
create policy portal_board_groups on er_share_groups for select to authenticated
  using (company_id in (select er_portal_company_ids(array['board'])));
create policy portal_own_groups on er_share_groups for select to authenticated
  using (id in (select er_portal_share_group_ids()));
create policy portal_own_ranges on er_share_ranges for select to authenticated
  using (share_group_id in (select er_portal_share_group_ids()));
create policy portal_board_members on er_board_memberships for select to authenticated
  using (company_id in (select er_portal_company_ids(array['board', 'owner', 'resident'])));
create policy portal_self_party on er_parties for select to authenticated
  using (user_id = er_current_user_id());
-- Hallitus näkee hallituksen jäsenet ja palveluntuottajat, osakkaat ja
-- asukkaat vain hallituksen jäsenten nimet (yhteystiedot rajataan
-- sovelluskerroksessa näkymissä).
create policy portal_board_parties on er_parties for select to authenticated
  using (id in (select party_id from er_board_memberships
                 where company_id in (select er_portal_company_ids(array['board', 'owner', 'resident']))
                   and (ends_on is null or ends_on >= current_date)));
create policy portal_providers on er_service_providers for select to authenticated
  using (id in (select provider_id from er_company_services
                 where company_id in (select er_portal_company_ids(array['board']))));
create policy portal_company_services on er_company_services for select to authenticated
  using (company_id in (select er_portal_company_ids(array['board'])));

create trigger er_housing_companies_touch before update on er_housing_companies for each row execute function er_touch_updated_at();
create trigger er_share_groups_touch before update on er_share_groups for each row execute function er_touch_updated_at();
create trigger er_parties_touch before update on er_parties for each row execute function er_touch_updated_at();
