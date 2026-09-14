-- 0001 Perusta: organisaatiot, käyttäjät, jäsenyydet, tapahtumaloki ja
-- RLS-apufunktiot.
--
-- Kirjautuminen tehdään portfolion Auth0-tenantilla. Supabase (third-party
-- auth) tai paikallinen kerros asettaa JWT-väitteet, ja käyttäjä tunnistetaan
-- väitteestä `sub`. Sovellus kutsuu kantaa aina roolilla `authenticated`,
-- joten RLS on todellinen suojaus eikä vain varmistus.

create extension if not exists btree_gist;

-- ---------------------------------------------------------------------------
-- Yhteiset
-- ---------------------------------------------------------------------------
create or replace function er_touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Organisaatiot (isännöintiyritykset) ja käyttäjät
-- ---------------------------------------------------------------------------
create table er_organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  business_id text unique,
  settings jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table er_users (
  id uuid primary key default gen_random_uuid(),
  auth_sub text not null unique,
  email text not null,
  full_name text,
  phone text,
  locale text not null default 'fi',
  identity_verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index er_users_email_lower on er_users (lower(email));

create table er_org_members (
  organization_id uuid not null references er_organizations(id) on delete cascade,
  user_id uuid not null references er_users(id) on delete cascade,
  role text not null check (role in ('owner', 'manager', 'accountant', 'assistant')),
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

-- Kutsut: sähköpostiosoite, jolle rooli annetaan ensimmäisellä kirjautumisella.
create table er_invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references er_organizations(id) on delete cascade,
  email text not null,
  kind text not null check (kind in ('staff', 'portal')),
  role text not null,
  token_hash text not null unique,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  created_by uuid references er_users(id),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Tapahtumaloki
-- ---------------------------------------------------------------------------
create table er_audit_log (
  id bigint generated always as identity primary key,
  organization_id uuid,
  user_id uuid,
  action text not null,
  entity text not null,
  entity_id uuid,
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index er_audit_log_org_created on er_audit_log (organization_id, created_at desc);

-- ---------------------------------------------------------------------------
-- RLS-apufunktiot
-- ---------------------------------------------------------------------------
create or replace function er_current_user_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from er_users where auth_sub = (auth.jwt() ->> 'sub')
$$;

create or replace function er_my_org_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select organization_id from er_org_members where user_id = er_current_user_id()
$$;

create or replace function er_has_org_role(org uuid, roles text[]) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from er_org_members
    where organization_id = org and user_id = er_current_user_id() and role = any(roles)
  )
$$;

grant execute on function er_current_user_id() to authenticated, service_role;
grant execute on function er_my_org_ids() to authenticated, service_role;
grant execute on function er_has_org_role(uuid, text[]) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table er_organizations enable row level security;
alter table er_users enable row level security;
alter table er_org_members enable row level security;
alter table er_invitations enable row level security;
alter table er_audit_log enable row level security;

create policy org_members_read on er_organizations for select to authenticated
  using (id in (select er_my_org_ids()));
create policy org_owner_update on er_organizations for update to authenticated
  using (er_has_org_role(id, array['owner'])) with check (er_has_org_role(id, array['owner']));

create policy user_self on er_users for select to authenticated
  using (id = er_current_user_id());
create policy user_self_update on er_users for update to authenticated
  using (id = er_current_user_id()) with check (id = er_current_user_id());
-- Saman organisaation henkilökunta näkee toisensa (vastuuhenkilön valinta).
create policy user_same_org on er_users for select to authenticated
  using (id in (select user_id from er_org_members where organization_id in (select er_my_org_ids())));

create policy members_read on er_org_members for select to authenticated
  using (organization_id in (select er_my_org_ids()));
create policy members_owner_write on er_org_members for all to authenticated
  using (er_has_org_role(organization_id, array['owner']))
  with check (er_has_org_role(organization_id, array['owner']));

create policy invitations_staff on er_invitations for all to authenticated
  using (er_has_org_role(organization_id, array['owner', 'manager']))
  with check (er_has_org_role(organization_id, array['owner', 'manager']));

create policy audit_read on er_audit_log for select to authenticated
  using (er_has_org_role(organization_id, array['owner', 'manager']));
create policy audit_insert on er_audit_log for insert to authenticated
  with check (user_id = er_current_user_id());

grant select, update on er_organizations to authenticated;
grant select, update on er_users to authenticated;
grant select, insert, update, delete on er_org_members to authenticated;
grant select, insert, update, delete on er_invitations to authenticated;
grant select, insert on er_audit_log to authenticated;
grant all on er_organizations, er_users, er_org_members, er_invitations, er_audit_log to service_role;

create trigger er_organizations_touch before update on er_organizations for each row execute function er_touch_updated_at();
create trigger er_users_touch before update on er_users for each row execute function er_touch_updated_at();
