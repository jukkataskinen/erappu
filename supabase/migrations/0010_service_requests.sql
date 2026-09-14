-- 0010 Huoltopyynnöt (M1): pyynnöt, tapahtumahistoria ja juokseva numerointi.
--
-- Pyyntöä ei poisteta koskaan (ei DELETE-oikeutta), koska se on osa yhtiön
-- kunnossapitohistoriaa ja mahdollisen riidan todiste. Tapahtumat ovat
-- muuttumattomia: vain lisäys.
--
-- Kuvat ovat er_documents-rivejä (category 'photo', subject_table
-- 'er_service_requests'), jotta lataus kulkee saman RLS-tarkistetun reitin
-- kautta kuin muut dokumentit.

-- ---------------------------------------------------------------------------
-- Juokseva numero per organisaatio
-- ---------------------------------------------------------------------------
create table er_service_request_counters (
  organization_id uuid primary key references er_organizations(id) on delete cascade,
  last_number integer not null default 0
);
alter table er_service_request_counters enable row level security;
grant all on er_service_request_counters to service_role;

-- Laskuririvin päivitys lukitsee rivin, joten kaksi samanaikaista pyyntöä
-- eivät saa samaa numeroa. Sequence per organisaatio olisi DDL:ää ajon aikana.
create or replace function er_next_service_request_number(org uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare
  n integer;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
     and not exists (select 1 from er_org_members where organization_id = org and user_id = er_current_user_id())
     and not exists (select 1 from er_portal_access
                      where organization_id = org and user_id = er_current_user_id()
                        and starts_on <= current_date and (ends_on is null or ends_on >= current_date)) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  insert into er_service_request_counters as c (organization_id, last_number) values (org, 1)
  on conflict (organization_id) do update set last_number = c.last_number + 1
  returning last_number into n;
  return n;
end $$;
revoke all on function er_next_service_request_number(uuid) from public;
grant execute on function er_next_service_request_number(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Huoltopyynnöt
-- ---------------------------------------------------------------------------
create table er_service_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references er_organizations(id),
  company_id uuid not null references er_housing_companies(id),
  share_group_id uuid references er_share_groups(id) on delete set null,
  number integer not null,
  title text not null check (char_length(title) between 1 and 200),
  description text not null default '' check (char_length(description) <= 5000),
  category text not null default 'other' check (category in (
    'plumbing', 'water_damage', 'electrical', 'heating', 'ventilation', 'doors_locks', 'appliances',
    'structures', 'yard', 'cleaning', 'pests', 'other')),
  urgency text not null default 'normal' check (urgency in ('urgent', 'normal', 'low')),
  status text not null default 'new' check (status in (
    'new', 'received', 'ordered', 'in_progress', 'waiting', 'done', 'closed', 'rejected')),
  source text not null default 'staff' check (source in ('staff', 'portal', 'public_form')),
  reporter_user_id uuid references er_users(id) on delete set null,
  reporter_name text check (reporter_name is null or char_length(reporter_name) <= 200),
  reporter_phone text check (reporter_phone is null or char_length(reporter_phone) <= 40),
  reporter_email text check (reporter_email is null or char_length(reporter_email) <= 254),
  -- Julkisen lomakkeen huoneisto vapaana tekstinä; henkilökunta voi liittää osakeryhmän.
  unit_text text check (unit_text is null or char_length(unit_text) <= 60),
  may_use_master_key boolean not null default false,
  has_pets boolean not null default false,
  assignee_user_id uuid references er_users(id) on delete set null,
  provider_id uuid references er_service_providers(id) on delete set null,
  due_on date,
  cost_responsibility text not null default 'unclear' check (cost_responsibility in ('company', 'shareholder', 'unclear')),
  cost_eur numeric(12, 2) check (cost_eur is null or cost_eur >= 0),
  ordered_at timestamptz,
  provider_acknowledged_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  closed_at timestamptz,
  reopened_count integer not null default 0,
  unique (organization_id, number)
);
create index er_service_requests_org_status on er_service_requests (organization_id, status);
create index er_service_requests_company on er_service_requests (company_id, created_at desc);
create index er_service_requests_reporter on er_service_requests (reporter_user_id) where reporter_user_id is not null;

-- Johdonmukaisuus ja roolikohtaiset rajat. Ajetaan kutsujan oikeuksilla, jotta
-- viittausten tarkistus näkee vain sen, minkä kutsuja saa nähdä (RLS).
-- Luotettu kutsuja = service_role tai security definer -funktio.
create or replace function er_service_requests_guard() returns trigger
language plpgsql set search_path = public as $$
declare
  v_org uuid;
  v_trusted boolean := current_user not in ('authenticated', 'anon');
  v_writer boolean;
begin
  select organization_id into v_org from er_housing_companies where id = new.company_id;
  if v_org is null then
    raise exception 'service request: unknown company' using errcode = '23503';
  end if;
  v_writer := er_has_org_role(v_org, array['owner', 'manager', 'assistant']);

  if tg_op = 'UPDATE' and v_org <> old.organization_id then
    raise exception 'service request: organization cannot change' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and not v_trusted and not v_writer then
    -- Kirjanpitäjä saa kirjata vain kustannuksen.
    if (to_jsonb(new) - array['cost_eur', 'cost_responsibility', 'updated_at'])
       is distinct from (to_jsonb(old) - array['cost_eur', 'cost_responsibility', 'updated_at']) then
      raise exception 'service request: only cost fields may be changed' using errcode = '42501';
    end if;
  end if;

  new.organization_id := v_org;

  if tg_op = 'INSERT' and not v_trusted and not v_writer then
    -- Portaalista tuleva pyyntö: käsittelytiedot kuuluvat henkilökunnalle.
    new.status := 'new';
    new.source := 'portal';
    new.reporter_user_id := er_current_user_id();
    new.assignee_user_id := null;
    new.provider_id := null;
    new.due_on := null;
    new.cost_eur := null;
    new.cost_responsibility := 'unclear';
    new.ordered_at := null;
    new.provider_acknowledged_at := null;
  end if;

  if new.share_group_id is not null
     and (tg_op = 'INSERT' or new.share_group_id is distinct from old.share_group_id)
     and not exists (select 1 from er_share_groups where id = new.share_group_id and company_id = new.company_id) then
    raise exception 'service request: share group does not belong to company' using errcode = '23503';
  end if;
  if new.provider_id is not null
     and (tg_op = 'INSERT' or new.provider_id is distinct from old.provider_id)
     and not exists (select 1 from er_service_providers where id = new.provider_id and organization_id = v_org) then
    raise exception 'service request: unknown provider' using errcode = '23503';
  end if;
  if new.assignee_user_id is not null
     and (tg_op = 'INSERT' or new.assignee_user_id is distinct from old.assignee_user_id)
     and not exists (select 1 from er_org_members where organization_id = v_org and user_id = new.assignee_user_id) then
    raise exception 'service request: assignee is not staff' using errcode = '23503';
  end if;

  if tg_op = 'INSERT' then
    new.number := er_next_service_request_number(v_org);
    new.created_at := now();
    new.updated_at := now();
    new.reopened_count := 0;
    new.completed_at := case when new.status in ('done', 'closed') then now() end;
    new.closed_at := case when new.status in ('closed', 'rejected') then now() end;
    return new;
  end if;

  new.number := old.number;
  new.created_at := old.created_at;
  new.source := old.source;
  new.reporter_user_id := old.reporter_user_id;
  new.updated_at := now();

  if new.status is distinct from old.status then
    if old.status in ('done', 'closed', 'rejected') and new.status not in ('done', 'closed', 'rejected') then
      new.reopened_count := old.reopened_count + 1;
      new.completed_at := null;
      new.closed_at := null;
      new.provider_acknowledged_at := null;
    else
      new.reopened_count := old.reopened_count;
    end if;
    if new.status = 'done' then new.completed_at := coalesce(new.completed_at, now()); end if;
    if new.status in ('closed', 'rejected') then
      new.closed_at := now();
      if new.status = 'closed' then new.completed_at := coalesce(new.completed_at, now()); end if;
    end if;
  else
    new.reopened_count := old.reopened_count;
  end if;
  return new;
end $$;

create trigger er_service_requests_guard before insert or update on er_service_requests
  for each row execute function er_service_requests_guard();

-- ---------------------------------------------------------------------------
-- Tapahtumat
-- ---------------------------------------------------------------------------
create table er_service_request_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references er_organizations(id),
  request_id uuid not null references er_service_requests(id) on delete cascade,
  type text not null check (type in ('comment', 'status_change', 'attachment', 'notification', 'assignment', 'cost')),
  body text check (body is null or char_length(body) <= 5000),
  old_status text,
  new_status text,
  visibility text not null default 'internal' check (visibility in ('internal', 'reporter', 'provider', 'board')),
  user_id uuid references er_users(id) on delete set null,
  provider_actor boolean not null default false,
  document_id uuid references er_documents(id) on delete set null,
  created_at timestamptz not null default now()
);
create index er_service_request_events_request on er_service_request_events (request_id, created_at);

create or replace function er_service_request_events_guard() returns trigger
language plpgsql set search_path = public as $$
declare
  v_org uuid;
begin
  select organization_id into v_org from er_service_requests where id = new.request_id;
  if v_org is null then
    raise exception 'service request event: unknown request' using errcode = '23503';
  end if;
  new.organization_id := v_org;
  -- clock_timestamp: saman transaktion tapahtumat pysyvät kirjausjärjestyksessä.
  new.created_at := clock_timestamp();
  if current_user in ('authenticated', 'anon') then
    -- Vain palvelinkoodi (tehtävälinkki) kirjaa palveluntuottajan tapahtumia.
    new.provider_actor := false;
  end if;
  return new;
end $$;

create trigger er_service_request_events_guard before insert on er_service_request_events
  for each row execute function er_service_request_events_guard();

-- Luontitapahtuma kirjataan aina kannassa, jolloin historia alkaa samalla
-- tavalla lähteestä riippumatta (henkilökunta, portaali, julkinen lomake).
create or replace function er_service_requests_created() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into er_service_request_events (organization_id, request_id, type, new_status, visibility, user_id)
  values (new.organization_id, new.id, 'status_change', new.status, 'reporter',
          case when new.source = 'public_form' then null else er_current_user_id() end);
  return null;
end $$;
revoke all on function er_service_requests_created() from public;

create trigger er_service_requests_created after insert on er_service_requests
  for each row execute function er_service_requests_created();

-- ---------------------------------------------------------------------------
-- Ilmoittajan kuittaus ja uudelleenavaus portaalista
--
-- Portaalikäyttäjällä ei ole UPDATE-oikeutta pyyntöön. Sallitut siirtymät
-- tehdään tällä funktiolla, joka tarkistaa ilmoittajan ja lähtötilan.
-- ---------------------------------------------------------------------------
create or replace function er_service_request_reporter_action(p_request uuid, p_action text, p_comment text)
returns text
language plpgsql security definer set search_path = public as $$
declare
  r er_service_requests;
  v_user uuid := er_current_user_id();
  v_new text;
  v_comment text := nullif(trim(coalesce(p_comment, '')), '');
begin
  if v_user is null then
    raise exception 'not found' using errcode = 'P0002';
  end if;
  select * into r from er_service_requests where id = p_request and reporter_user_id = v_user for update;
  if not found then
    raise exception 'not found' using errcode = 'P0002';
  end if;
  if p_action = 'close' then
    if r.status <> 'done' then
      raise exception 'invalid transition' using errcode = '22023';
    end if;
    v_new := 'closed';
  elsif p_action = 'reopen' then
    if r.status not in ('done', 'closed') then
      raise exception 'invalid transition' using errcode = '22023';
    end if;
    if v_comment is null then
      raise exception 'comment required' using errcode = '22023';
    end if;
    v_new := 'received';
  else
    raise exception 'unknown action' using errcode = '22023';
  end if;

  update er_service_requests set status = v_new where id = r.id;
  insert into er_service_request_events (request_id, type, body, old_status, new_status, visibility, user_id)
  values (r.id, 'status_change', v_comment, r.status, v_new, 'reporter', v_user);
  return v_new;
end $$;
revoke all on function er_service_request_reporter_action(uuid, text, text) from public;
grant execute on function er_service_request_reporter_action(uuid, text, text) to authenticated, service_role;

-- Päivystysnumerot portaalin ohjeeseen. Portaalikäyttäjä ei näe
-- palveluntuottajarekisteriä, joten vain nimi ja päivystysnumero palautetaan.
create or replace function er_portal_emergency_contacts()
returns table (company_id uuid, provider_name text, emergency_phone text)
language sql stable security definer set search_path = public as $$
  select cs.company_id, sp.name, sp.emergency_phone
    from er_company_services cs
    join er_service_providers sp on sp.id = cs.provider_id
   where cs.default_for_requests
     and sp.emergency_phone is not null
     and cs.company_id in (select er_portal_company_ids(array['board', 'owner', 'resident']))
$$;
revoke all on function er_portal_emergency_contacts() from public;
grant execute on function er_portal_emergency_contacts() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table er_service_requests enable row level security;
alter table er_service_request_events enable row level security;

create policy staff_read on er_service_requests for select to authenticated
  using (organization_id in (select er_my_org_ids()));
create policy staff_insert on er_service_requests for insert to authenticated
  with check (er_has_org_role(organization_id, array['owner', 'manager', 'assistant']));
-- Kirjanpitäjän päivitys rajataan kustannussarakkeisiin triggerissä.
create policy staff_update on er_service_requests for update to authenticated
  using (er_has_org_role(organization_id, array['owner', 'manager', 'assistant', 'accountant']))
  with check (er_has_org_role(organization_id, array['owner', 'manager', 'assistant', 'accountant']));
create policy portal_board_read on er_service_requests for select to authenticated
  using (company_id in (select er_portal_company_ids(array['board'])));
create policy portal_own_read on er_service_requests for select to authenticated
  using (reporter_user_id = er_current_user_id());
create policy portal_insert on er_service_requests for insert to authenticated
  with check (
    reporter_user_id = er_current_user_id()
    and source = 'portal'
    and status = 'new'
    and company_id in (select er_portal_company_ids(array['board', 'owner', 'resident']))
    and (share_group_id is null or share_group_id in (select er_portal_share_group_ids()))
  );

create policy staff_read on er_service_request_events for select to authenticated
  using (organization_id in (select er_my_org_ids()));
create policy staff_insert on er_service_request_events for insert to authenticated
  with check (organization_id in (select er_my_org_ids()) and user_id = er_current_user_id() and provider_actor = false);
create policy portal_reporter_read on er_service_request_events for select to authenticated
  using (visibility = 'reporter'
         and request_id in (select id from er_service_requests where reporter_user_id = er_current_user_id()));
create policy portal_board_read on er_service_request_events for select to authenticated
  using (visibility in ('reporter', 'board')
         and request_id in (select id from er_service_requests
                             where company_id in (select er_portal_company_ids(array['board']))));
create policy portal_reporter_comment on er_service_request_events for insert to authenticated
  with check (type in ('comment', 'attachment') and visibility = 'reporter' and provider_actor = false
              and user_id = er_current_user_id() and old_status is null and new_status is null
              and request_id in (select id from er_service_requests where reporter_user_id = er_current_user_id()));

grant select, insert, update on er_service_requests to authenticated;
grant select, insert on er_service_request_events to authenticated;
grant all on er_service_requests, er_service_request_events to service_role;

-- Huoltopyynnön kuvat portaalissa: ilmoittaja ja hallitus näkevät
-- 'reporter'-näkyvyyden kuvat, ilmoittaja voi lisätä kuvia omaan pyyntöönsä.
create policy portal_request_photos on er_documents for select to authenticated
  using (subject_table = 'er_service_requests' and visibility = 'reporter'
         and subject_id in (select id from er_service_requests
                             where reporter_user_id = er_current_user_id()
                                or company_id in (select er_portal_company_ids(array['board']))));
create policy portal_request_photo_insert on er_documents for insert to authenticated
  with check (subject_table = 'er_service_requests' and category = 'photo' and visibility = 'reporter'
              and uploaded_by = er_current_user_id()
              and exists (select 1 from er_service_requests r
                           where r.id = subject_id and r.reporter_user_id = er_current_user_id()
                             and r.organization_id = er_documents.organization_id
                             and r.company_id = er_documents.company_id));
