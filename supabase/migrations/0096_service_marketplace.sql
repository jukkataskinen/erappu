-- 0096 Huoltopyyntöjen tori palveluntuottajille (PLAN "Pitkän aikavälin suunta",
-- päätökset Jukka 17.9.2026).
--
-- Isännöitsijä vie huoltopyynnön torille. Torin näkevät vain palveluntuottajat,
-- jotka on hyväksytty organisaatiolle (kaikki isännöitävät yhtiöt) tai yhtiölle.
-- Ensimmäinen varaaja saa työn. Varaaja antaa arvioidun toteutuspäivän ja
-- tuntiarvion; jos tuntihinta × arvio ylittää yhtiön hallituksen päättämän
-- euro-rajan, varaus odottaa isännöitsijän hyväksyntää. Varaus on voimassa
-- viikon: jos työtä ei ole kuitattu tehdyksi, pyyntö palaa torille.
--
-- Palveluntuottajilla ei ole eRappu-tunnuksia, joten torille pääsee
-- henkilökohtaisella torilinkillä (er_access_links, purpose 'provider_marketplace').
-- Linkin kautta kaikki luetaan palvelun roolilla ja rajataan sovelluksessa
-- (src/lib/marketplace), kuten tehtävälinkissä. Ennen varausta torilla näkyvät
-- vain ala, paikkakunta, isännöitsijän kirjoittama lyhyt kuvaus ja päivä;
-- osoite, huoneisto, kuvat ja ilmoittajan tiedot vasta varaajalle tehtävälinkissä.

-- ---------------------------------------------------------------------------
-- Yhtiön torisäännöt: hallituksen päätös ja euro-raja.
-- ---------------------------------------------------------------------------
alter table er_housing_companies add column marketplace_enabled boolean not null default false;
alter table er_housing_companies add column marketplace_limit_eur numeric(10,2) check (marketplace_limit_eur is null or marketplace_limit_eur > 0);
alter table er_housing_companies add column marketplace_decided_on date;
alter table er_housing_companies add column marketplace_decision_note text check (marketplace_decision_note is null or char_length(marketplace_decision_note) <= 500);
-- Torin saa ottaa käyttöön vain hallituksen päätöksellä ja euro-rajalla.
alter table er_housing_companies add constraint er_housing_companies_marketplace_decision
  check (not marketplace_enabled or (marketplace_limit_eur is not null and marketplace_decided_on is not null));

-- ---------------------------------------------------------------------------
-- Palveluntuottajan tuntihinta ja torihyväksynnät.
-- ---------------------------------------------------------------------------
alter table er_service_providers add column hourly_rate_eur numeric(8,2) check (hourly_rate_eur is null or hourly_rate_eur > 0);

create table er_marketplace_approvals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references er_organizations(id),
  provider_id uuid not null references er_service_providers(id) on delete cascade,
  -- null = hyväksytty organisaatiolle eli kaikkiin isännöitäviin yhtiöihin.
  company_id uuid references er_housing_companies(id) on delete cascade,
  created_by uuid references er_users(id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index er_marketplace_approvals_org on er_marketplace_approvals (provider_id) where company_id is null;
create unique index er_marketplace_approvals_company on er_marketplace_approvals (provider_id, company_id) where company_id is not null;

-- ---------------------------------------------------------------------------
-- Torilistaus: yksi rivi huoltopyyntöä kohden. Historia on pyynnön
-- tapahtumissa (er_service_request_events).
-- ---------------------------------------------------------------------------
create table er_marketplace_listings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references er_organizations(id),
  company_id uuid not null references er_housing_companies(id) on delete cascade,
  request_id uuid not null unique references er_service_requests(id) on delete cascade,
  -- open = torilla, pending_approval = varattu mutta arvio ylittää yhtiön rajan,
  -- reserved = varattu ja tilattu, completed = työ kuitattu tehdyksi,
  -- cancelled = isännöitsijä poisti torilta.
  status text not null default 'open' check (status in ('open', 'pending_approval', 'reserved', 'completed', 'cancelled')),
  -- Isännöitsijän kirjoittama kuvaus torille. Ei osoitetta eikä henkilötietoja.
  summary text not null check (char_length(summary) between 5 and 300),
  listed_by uuid references er_users(id) on delete set null,
  listed_at timestamptz not null default now(),
  provider_id uuid references er_service_providers(id) on delete set null,
  reserved_at timestamptz,
  reserve_expires_at timestamptz,
  estimated_on date,
  estimated_hours numeric(5,1) check (estimated_hours is null or (estimated_hours > 0 and estimated_hours <= 500)),
  -- Tuntihinta varaushetkellä, jotta myöhempi hinnanmuutos ei muuta arviota.
  hourly_rate_eur numeric(8,2),
  approved_at timestamptz,
  approved_by uuid references er_users(id) on delete set null,
  closed_at timestamptz,
  updated_at timestamptz not null default now(),
  -- Varauksella on aina varaaja, voimassaolo, arvio ja tuntihinta.
  check (status not in ('pending_approval', 'reserved')
         or (provider_id is not null and reserved_at is not null and reserve_expires_at is not null
             and estimated_on is not null and estimated_hours is not null and hourly_rate_eur is not null)),
  -- Torilla olevalla ei ole varaajaa.
  check (status <> 'open' or (provider_id is null and reserved_at is null and reserve_expires_at is null))
);
create index er_marketplace_listings_open on er_marketplace_listings (organization_id, status, listed_at desc);
create index er_marketplace_listings_provider on er_marketplace_listings (provider_id, status);

-- Palveluntuottajan torilinkki.
do $$
declare
  c record;
begin
  for c in
    select conname from pg_constraint
     where conrelid = 'er_access_links'::regclass and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%purpose%'
  loop
    execute format('alter table er_access_links drop constraint %I', c.conname);
  end loop;
end $$;
alter table er_access_links add constraint er_access_links_purpose_check
  check (purpose in ('provider_task', 'public_request_form', 'certificate_order', 'invite', 'provider_marketplace'));

-- Tapahtumatyyppi torin vaiheille (viety torille, varattu, hyväksytty, rauennut).
do $$
declare
  c record;
begin
  for c in
    select conname from pg_constraint
     where conrelid = 'er_service_request_events'::regclass and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%type%'
       and pg_get_constraintdef(oid) ilike '%status_change%'
  loop
    execute format('alter table er_service_request_events drop constraint %I', c.conname);
  end loop;
end $$;
alter table er_service_request_events add constraint er_service_request_events_type_check
  check (type in ('comment', 'status_change', 'attachment', 'notification', 'assignment', 'cost', 'marketplace'));

-- ---------------------------------------------------------------------------
-- RLS: henkilökunta lukee organisaationsa rivit, kirjoittaa huoltopyyntöjen
-- rooleilla. Palveluntuottajan linkki käyttää palvelun roolia.
-- ---------------------------------------------------------------------------
alter table er_marketplace_approvals enable row level security;
alter table er_marketplace_listings enable row level security;

create policy staff_read on er_marketplace_approvals for select to authenticated
  using (organization_id in (select er_my_org_ids()));
create policy staff_write on er_marketplace_approvals for all to authenticated
  using (er_has_org_role(organization_id, array['owner', 'manager', 'assistant']))
  with check (er_has_org_role(organization_id, array['owner', 'manager', 'assistant'])
              and exists (select 1 from er_service_providers p where p.id = provider_id and p.organization_id = er_marketplace_approvals.organization_id)
              and (company_id is null
                   or exists (select 1 from er_housing_companies c where c.id = company_id and c.organization_id = er_marketplace_approvals.organization_id)));

create policy staff_read on er_marketplace_listings for select to authenticated
  using (organization_id in (select er_my_org_ids()));
create policy staff_write on er_marketplace_listings for all to authenticated
  using (er_has_org_role(organization_id, array['owner', 'manager', 'assistant']))
  with check (er_has_org_role(organization_id, array['owner', 'manager', 'assistant'])
              and exists (select 1 from er_service_requests r
                           where r.id = request_id and r.organization_id = er_marketplace_listings.organization_id
                             and r.company_id = er_marketplace_listings.company_id));

grant select, insert, update, delete on er_marketplace_approvals, er_marketplace_listings to authenticated;
grant all on er_marketplace_approvals, er_marketplace_listings to service_role;
