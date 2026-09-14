-- 0040 Tiedotteet ja niiden lukukuittaukset.
--
-- Tiedote kohdistetaan yhtiöön, rooleihin (osakas, asukas, hallitus) ja
-- valinnaisesti rakennuksiin. Hallitus voi laatia luonnoksen portaalissa,
-- mutta vain henkilökunta julkaisee: julkaisu lähettää sähköposteja yhtiön
-- nimissä, joten sen tekee isännöitsijä.

create table er_announcements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references er_organizations(id),
  company_id uuid not null references er_housing_companies(id) on delete cascade,
  title text not null check (length(title) between 1 and 200),
  body text not null check (length(body) <= 20000),
  audience_roles text[] not null default '{owner,resident}'
    check (cardinality(audience_roles) > 0 and audience_roles <@ array['owner', 'resident', 'board']),
  -- null = koko yhtiö. Tyhjää taulukkoa ei tallenneta, jotta ehto on yksiselitteinen.
  building_ids uuid[] check (building_ids is null or cardinality(building_ids) > 0),
  channels text[] not null default '{portal}'
    check (cardinality(channels) > 0 and channels <@ array['portal', 'email']),
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  origin text not null default 'staff' check (origin in ('staff', 'board')),
  published_at timestamptz,
  published_by uuid references er_users(id),
  valid_until date,
  author_user_id uuid references er_users(id),
  -- Lähetysraportin luvut julkaisuhetkeltä. Nimiä ei tallenneta, vain määrät.
  recipient_party_count integer,
  email_recipient_count integer,
  missing_email_count integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status = 'draft' or published_at is not null)
);
create index er_announcements_company on er_announcements (company_id, status, published_at desc);
create index er_announcements_org on er_announcements (organization_id, status, created_at desc);

create table er_announcement_reads (
  announcement_id uuid not null references er_announcements(id) on delete cascade,
  user_id uuid not null references er_users(id) on delete cascade,
  organization_id uuid not null references er_organizations(id),
  read_at timestamptz not null default now(),
  primary key (announcement_id, user_id)
);

-- Kuuluuko kirjautunut portaalikäyttäjä tiedotteen kohderyhmään. Security
-- definer, koska osakeryhmän rakennus ja portaalioikeus luetaan ohi RLS:n;
-- funktio palauttaa vain totuusarvon.
create or replace function er_portal_audience_match(p_company uuid, p_roles text[], p_buildings uuid[]) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from er_portal_access pa
      left join er_share_groups g on g.id = pa.share_group_id
     where pa.user_id = er_current_user_id()
       and pa.company_id = p_company
       and pa.role = any(p_roles)
       and pa.role in ('owner', 'resident', 'board')
       and pa.starts_on <= current_date
       and (pa.ends_on is null or pa.ends_on >= current_date)
       and (p_buildings is null or pa.role = 'board' or g.building_id = any(p_buildings))
  )
$$;
grant execute on function er_portal_audience_match(uuid, text[], uuid[]) to authenticated, service_role;

alter table er_announcements enable row level security;
alter table er_announcement_reads enable row level security;

create policy staff_read on er_announcements for select to authenticated
  using (organization_id in (select er_my_org_ids()));
create policy staff_write on er_announcements for all to authenticated
  using (er_has_org_role(organization_id, array['owner', 'manager', 'assistant']))
  with check (er_has_org_role(organization_id, array['owner', 'manager', 'assistant']));

-- Hallitus näkee yhtiön julkaistut ja arkistoidut tiedotteet sekä hallituksen
-- laatimat luonnokset. Henkilökunnan keskeneräisiä luonnoksia se ei näe.
create policy portal_board_read on er_announcements for select to authenticated
  using (company_id in (select er_portal_company_ids(array['board']))
         and (status <> 'draft' or origin = 'board'));

create policy portal_board_draft_insert on er_announcements for insert to authenticated
  with check (status = 'draft' and origin = 'board' and published_at is null and published_by is null
              and author_user_id = er_current_user_id()
              and company_id in (select er_portal_company_ids(array['board']))
              and organization_id = (select c.organization_id from er_housing_companies c where c.id = company_id));

create policy portal_board_draft_update on er_announcements for update to authenticated
  using (status = 'draft' and origin = 'board' and author_user_id = er_current_user_id()
         and company_id in (select er_portal_company_ids(array['board'])))
  with check (status = 'draft' and origin = 'board' and published_at is null and published_by is null
              and author_user_id = er_current_user_id()
              and company_id in (select er_portal_company_ids(array['board']))
              and organization_id = (select c.organization_id from er_housing_companies c where c.id = company_id));

create policy portal_board_draft_delete on er_announcements for delete to authenticated
  using (status = 'draft' and origin = 'board' and author_user_id = er_current_user_id()
         and company_id in (select er_portal_company_ids(array['board'])));

create policy portal_audience_read on er_announcements for select to authenticated
  using (status = 'published'
         and (valid_until is null or valid_until >= current_date)
         and er_portal_audience_match(company_id, audience_roles, building_ids));

create policy staff_read on er_announcement_reads for select to authenticated
  using (organization_id in (select er_my_org_ids()));
create policy self_read on er_announcement_reads for select to authenticated
  using (user_id = er_current_user_id());
-- Kuittauksen voi tehdä vain tiedotteesta, jonka käyttäjä näkee (alikysely
-- ajetaan käyttäjän RLS:llä).
create policy self_insert on er_announcement_reads for insert to authenticated
  with check (user_id = er_current_user_id()
              and exists (select 1 from er_announcements a
                           where a.id = announcement_id and a.organization_id = er_announcement_reads.organization_id));

grant select, insert, update, delete on er_announcements to authenticated;
grant select, insert on er_announcement_reads to authenticated;
grant all on er_announcements, er_announcement_reads to service_role;

create trigger er_announcements_touch before update on er_announcements for each row execute function er_touch_updated_at();
