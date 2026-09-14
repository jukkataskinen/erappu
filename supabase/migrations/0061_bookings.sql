-- 0061 Varaukset: taloyhtiön varattavat tilat (sauna, pesutupa, kerhohuone)
-- ja niiden varaukset.
--
-- Päällekkäisyys estetään kannassa exclusion constraintilla, joten kaksi
-- samanaikaista varausta samaan vuoroon ei voi mennä läpi. Portaalikäyttäjä
-- näkee muiden varauksista vain ajan ("Varattu") funktion
-- er_resource_bookings kautta; varausrivejä hän lukee vain omiaan.

create table er_bookable_resources (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references er_organizations(id),
  company_id uuid not null references er_housing_companies(id) on delete cascade,
  name text not null check (length(name) between 1 and 100),
  description text check (description is null or length(description) <= 2000),
  slot_minutes integer not null default 60 check (slot_minutes between 15 and 1440),
  -- {"mon": [["06:00", "22:00"]], ...}; puuttuva päivä = suljettu.
  open_hours jsonb not null default '{}' check (jsonb_typeof(open_hours) = 'object'),
  max_active_bookings_per_unit smallint check (max_active_bookings_per_unit is null or max_active_bookings_per_unit > 0),
  allow_recurring boolean not null default false,
  price_eur numeric(10, 2) check (price_eur is null or price_eur >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index er_bookable_resources_company on er_bookable_resources (company_id);

create table er_bookings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references er_organizations(id),
  company_id uuid not null references er_housing_companies(id) on delete cascade,
  resource_id uuid not null references er_bookable_resources(id) on delete cascade,
  share_group_id uuid references er_share_groups(id) on delete set null,
  user_id uuid references er_users(id) on delete set null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  recurring_weekly boolean not null default false,
  -- Vakiovuoron kaikilla viikoilla on sama series_id; kiintiössä sarja lasketaan yhdeksi.
  series_id uuid,
  note text check (note is null or length(note) <= 500),
  cancelled_at timestamptz,
  cancelled_by uuid references er_users(id) on delete set null,
  created_by uuid references er_users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at),
  exclude using gist (resource_id with =, tstzrange(starts_at, ends_at) with &&) where (cancelled_at is null)
);
create index er_bookings_resource_time on er_bookings (resource_id, starts_at) where cancelled_at is null;
create index er_bookings_user on er_bookings (user_id, starts_at) where cancelled_at is null;
create index er_bookings_group on er_bookings (share_group_id, resource_id) where cancelled_at is null;

create trigger er_bookable_resources_touch before update on er_bookable_resources for each row execute function er_touch_updated_at();

-- ---------------------------------------------------------------------------
-- Säännöt, joita ei jätetä sovelluksen varaan
-- ---------------------------------------------------------------------------
create or replace function er_is_service_request() returns boolean
language sql stable as $$
  select coalesce(auth.jwt() ->> 'role', '') = 'service_role'
$$;
grant execute on function er_is_service_request() to authenticated, service_role;

-- Organisaatio ja yhtiö otetaan aina resurssilta, jottei niitä voi väärentää.
-- Portaalikäyttäjän varaukselle tarkistetaan tila, ajankohta ja kiintiö.
create or replace function er_bookings_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  r er_bookable_resources;
  used integer;
begin
  select * into r from er_bookable_resources where id = new.resource_id;
  if not found then
    raise exception 'booking_resource_missing';
  end if;
  new.organization_id := r.organization_id;
  new.company_id := r.company_id;
  if new.series_id is null then
    new.series_id := new.id;
  end if;
  if new.created_by is null then
    new.created_by := er_current_user_id();
  end if;

  if er_is_service_request() or er_has_org_role(r.organization_id, array['owner', 'manager', 'assistant']) then
    return new;
  end if;

  if not r.active then
    raise exception 'booking_resource_inactive';
  end if;
  if new.starts_at < now() then
    raise exception 'booking_in_past';
  end if;
  if new.recurring_weekly and not r.allow_recurring then
    raise exception 'booking_recurring_not_allowed';
  end if;
  if new.share_group_id is null then
    raise exception 'booking_share_group_required';
  end if;

  if r.max_active_bookings_per_unit is not null then
    -- Sarjalukko: saman huoneiston kaksi rinnakkaista varausta eivät ohita kiintiötä.
    perform pg_advisory_xact_lock(hashtext(new.resource_id::text || ':' || new.share_group_id::text));
    select count(distinct b.series_id) into used
      from er_bookings b
     where b.resource_id = new.resource_id
       and b.share_group_id = new.share_group_id
       and b.cancelled_at is null
       and b.ends_at > now()
       and b.series_id <> new.series_id;
    if used >= r.max_active_bookings_per_unit then
      raise exception 'booking_quota';
    end if;
  end if;
  return new;
end $$;
create trigger er_bookings_insert before insert on er_bookings for each row execute function er_bookings_before_insert();

-- Portaalikäyttäjä saa vain perua oman varauksensa, ei siirtää sitä tai
-- palauttaa peruttua.
create or replace function er_bookings_before_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if er_is_service_request() or er_has_org_role(old.organization_id, array['owner', 'manager', 'assistant']) then
    return new;
  end if;
  if (new.organization_id, new.company_id, new.resource_id, new.share_group_id, new.user_id, new.starts_at, new.ends_at,
      new.recurring_weekly, new.series_id, new.note, new.created_by, new.created_at)
     is distinct from
     (old.organization_id, old.company_id, old.resource_id, old.share_group_id, old.user_id, old.starts_at, old.ends_at,
      old.recurring_weekly, old.series_id, old.note, old.created_by, old.created_at) then
    raise exception 'booking_update_not_allowed';
  end if;
  if old.cancelled_at is not null or new.cancelled_at is null then
    raise exception 'booking_update_not_allowed';
  end if;
  new.cancelled_by := er_current_user_id();
  return new;
end $$;
create trigger er_bookings_update before update on er_bookings for each row execute function er_bookings_before_update();

-- Saako kirjautunut käyttäjä varata resurssin tämän osakeryhmän nimissä.
create or replace function er_can_book(p_resource uuid, p_share_group uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from er_bookable_resources r
      join er_portal_access a on a.company_id = r.company_id
     where r.id = p_resource
       and r.active
       and a.user_id = er_current_user_id()
       and a.share_group_id = p_share_group
       and a.role in ('owner', 'resident')
       and a.starts_on <= current_date
       and (a.ends_on is null or a.ends_on >= current_date)
  )
$$;

-- Resurssin varatut ajat ilman varaajan tietoja. Oman varauksen tunniste
-- palautetaan, jotta sen voi perua.
create or replace function er_resource_bookings(p_resource uuid, p_from timestamptz, p_to timestamptz)
returns table (own_booking_id uuid, starts_at timestamptz, ends_at timestamptz, mine boolean)
language sql stable security definer set search_path = public as $$
  select case when b.user_id = er_current_user_id() then b.id end,
         b.starts_at,
         b.ends_at,
         coalesce(b.user_id = er_current_user_id(), false)
    from er_bookings b
    join er_bookable_resources r on r.id = b.resource_id
   where b.resource_id = p_resource
     and b.cancelled_at is null
     and b.starts_at < p_to
     and b.ends_at > p_from
     and (r.company_id in (select er_portal_company_ids(array['owner', 'resident', 'board']))
          or r.organization_id in (select er_my_org_ids()))
   order by b.starts_at
$$;

grant execute on function er_can_book(uuid, uuid) to authenticated, service_role;
grant execute on function er_resource_bookings(uuid, timestamptz, timestamptz) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table er_bookable_resources enable row level security;
alter table er_bookings enable row level security;

create policy staff_read on er_bookable_resources for select to authenticated
  using (organization_id in (select er_my_org_ids()));
create policy staff_write on er_bookable_resources for all to authenticated
  using (er_has_org_role(organization_id, array['owner', 'manager', 'assistant']))
  with check (
    er_has_org_role(organization_id, array['owner', 'manager', 'assistant'])
    and company_id in (select id from er_housing_companies where organization_id = er_bookable_resources.organization_id)
  );
create policy portal_read on er_bookable_resources for select to authenticated
  using (active and company_id in (select er_portal_company_ids(array['owner', 'resident'])));

create policy staff_read on er_bookings for select to authenticated
  using (organization_id in (select er_my_org_ids()));
create policy staff_write on er_bookings for all to authenticated
  using (er_has_org_role(organization_id, array['owner', 'manager', 'assistant']))
  with check (er_has_org_role(organization_id, array['owner', 'manager', 'assistant']));
create policy portal_own_read on er_bookings for select to authenticated
  using (user_id = er_current_user_id());
create policy portal_insert on er_bookings for insert to authenticated
  with check (user_id = er_current_user_id() and er_can_book(resource_id, share_group_id));
create policy portal_cancel on er_bookings for update to authenticated
  using (user_id = er_current_user_id())
  with check (user_id = er_current_user_id());

grant select, insert, update, delete on er_bookable_resources, er_bookings to authenticated;
grant all on er_bookable_resources, er_bookings to service_role;
