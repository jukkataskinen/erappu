-- 0050 Kokoukset, allekirjoituskierrokset ja isännöitsijäntodistukset (M5).
--
-- Kokouksen asiat, osallistujat ja ääniluettelo ovat omissa tauluissaan,
-- jotta pöytäkirja ja ääniluettelo voidaan tuottaa samoista riveistä kuin
-- kokouskutsu. Allekirjoituskierrokset ovat yleisiä (subject_table/subject_id),
-- koska samaa eSinetti-polkua käytetään myöhemmin sopimuksiin ja
-- muutostyölupiin.

-- ---------------------------------------------------------------------------
-- Kokoukset
-- ---------------------------------------------------------------------------
create table er_meetings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references er_organizations(id),
  company_id uuid not null references er_housing_companies(id) on delete cascade,
  kind text not null check (kind in ('annual_general', 'extraordinary_general', 'board')),
  starts_at timestamptz not null,
  location text,
  remote_participation boolean not null default false,
  remote_url text,
  fiscal_year text,
  status text not null default 'draft'
    check (status in ('draft', 'notice_sent', 'held', 'minutes_signed', 'cancelled')),
  notice_sent_at timestamptz,
  chair_name text,
  chair_email text,
  secretary_name text,
  -- Pöytäkirjantarkastajat [{name, email}]. Sähköposti tarvitaan vain
  -- allekirjoituskierrokseen, eikä sitä näytetä portaalissa.
  minutes_checkers jsonb not null default '[]',
  notes text,
  created_by uuid references er_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index er_meetings_company on er_meetings (company_id, starts_at desc);
create index er_meetings_org_starts on er_meetings (organization_id, starts_at);

create table er_meeting_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references er_organizations(id),
  meeting_id uuid not null references er_meetings(id) on delete cascade,
  position integer not null check (position >= 1),
  title text not null,
  proposal text,
  decision text,
  -- Järjestyksen vaihto tehdään kahdella päivityksellä samassa transaktiossa.
  unique (meeting_id, position) deferrable initially deferred
);

create table er_agenda_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references er_organizations(id),
  name text not null,
  kind text not null check (kind in ('annual_general', 'extraordinary_general', 'board')),
  items jsonb not null default '[]',
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index er_agenda_templates_default on er_agenda_templates (organization_id, kind) where is_default;

create table er_meeting_attendees (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references er_organizations(id),
  meeting_id uuid not null references er_meetings(id) on delete cascade,
  party_id uuid references er_parties(id) on delete set null,
  represented_party_id uuid references er_parties(id) on delete set null,
  -- Nimi tallennetaan ääniluetteloa varten sellaisena kuin se kokouksessa oli.
  display_name text not null,
  proxy_name text,
  share_group_ids uuid[] not null default '{}',
  shares integer not null default 0 check (shares >= 0),
  votes integer not null default 0 check (votes >= 0),
  present boolean not null default false,
  remote boolean not null default false,
  proxy_document_id uuid references er_documents(id) on delete set null,
  created_at timestamptz not null default now()
);
create index er_meeting_attendees_meeting on er_meeting_attendees (meeting_id);

-- ---------------------------------------------------------------------------
-- eSinetti: allekirjoituskierrokset ja vastaanotetut webhookit
-- ---------------------------------------------------------------------------
create table er_signing_rounds (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references er_organizations(id),
  company_id uuid references er_housing_companies(id) on delete cascade,
  subject_table text not null,
  subject_id uuid not null,
  esinetti_round_id text unique,
  status text not null default 'draft'
    check (status in ('draft', 'sent', 'partially_signed', 'completed', 'cancelled', 'expired', 'error')),
  signers jsonb not null default '[]',
  original_document_id uuid references er_documents(id) on delete set null,
  sealed_document_id uuid references er_documents(id) on delete set null,
  last_event text,
  completed_at timestamptz,
  created_by uuid references er_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index er_signing_rounds_subject on er_signing_rounds (subject_table, subject_id);

-- Webhookin idempotenssi. organization_id voi puuttua, koska tapahtuma
-- kirjataan ennen kuin kierros on varmistettu. Vain palvelun rooli.
create table er_webhook_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references er_organizations(id),
  provider text not null default 'esinetti' check (provider in ('esinetti')),
  event_id text not null unique,
  event_name text,
  received_at timestamptz not null default now(),
  payload_hash text not null
);

-- ---------------------------------------------------------------------------
-- Isännöitsijäntodistukset ja lainaosuustodistukset
-- ---------------------------------------------------------------------------
create table er_certificate_orders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references er_organizations(id),
  company_id uuid not null references er_housing_companies(id) on delete cascade,
  share_group_id uuid not null references er_share_groups(id) on delete cascade,
  kind text not null default 'manager_certificate' check (kind in ('manager_certificate', 'loan_share_certificate')),
  orderer_name text not null,
  orderer_email text not null,
  orderer_phone text,
  express boolean not null default false,
  status text not null default 'new' check (status in ('new', 'in_progress', 'delivered', 'invoiced', 'cancelled')),
  source text not null default 'staff' check (source in ('staff', 'public_form')),
  document_id uuid references er_documents(id) on delete set null,
  price_eur numeric(10, 2) not null check (price_eur >= 0),
  created_by uuid references er_users(id),
  created_at timestamptz not null default now(),
  delivered_at timestamptz
);
create index er_certificate_orders_org on er_certificate_orders (organization_id, status, created_at desc);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['er_meetings', 'er_meeting_items', 'er_agenda_templates', 'er_meeting_attendees', 'er_signing_rounds', 'er_certificate_orders'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy staff_read on %I for select to authenticated using (organization_id in (select er_my_org_ids()))', t);
    execute format(
      'create policy staff_write on %I for all to authenticated
         using (er_has_org_role(organization_id, array[''owner'',''manager'',''assistant'']))
         with check (er_has_org_role(organization_id, array[''owner'',''manager'',''assistant'']))', t);
    execute format('grant select, insert, update, delete on %I to authenticated', t);
    execute format('grant all on %I to service_role', t);
  end loop;
end $$;

alter table er_webhook_events enable row level security;
grant all on er_webhook_events to service_role;

-- Hallitus näkee yhtiön kokoukset (ei luonnoksia), asiat ja ääniluettelon.
create policy portal_board_meetings on er_meetings for select to authenticated
  using (status <> 'draft' and company_id in (select er_portal_company_ids(array['board'])));
-- Osakas näkee yhtiökokoukset vasta, kun kutsu on lähetetty. Hallituksen
-- kokouksia osakas ei näe.
create policy portal_owner_meetings on er_meetings for select to authenticated
  using (kind in ('annual_general', 'extraordinary_general')
         and status in ('notice_sent', 'held', 'minutes_signed')
         and company_id in (select er_portal_company_ids(array['owner'])));

-- Alisyöte er_meetings-tauluun noudattaa sen omia sääntöjä, joten asiat
-- näkyvät täsmälleen niille, jotka näkevät kokouksen.
create policy portal_meeting_items on er_meeting_items for select to authenticated
  using (meeting_id in (select id from er_meetings));
create policy portal_board_attendees on er_meeting_attendees for select to authenticated
  using (meeting_id in (select id from er_meetings where company_id in (select er_portal_company_ids(array['board']))));

create trigger er_meetings_touch before update on er_meetings for each row execute function er_touch_updated_at();
create trigger er_signing_rounds_touch before update on er_signing_rounds for each row execute function er_touch_updated_at();
