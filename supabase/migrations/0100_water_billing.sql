-- 0100 Vesimittarit, lukemat, vesiennakot ja vesimaksun tasauslaskutus.
--
-- Useimmissa yhtiöissä huoneistossa on vain kylmän veden mittari, osassa
-- myös lämpimän. Osakas maksaa kuukausittain sovittua vesiennakkoa
-- vastikelaskulla, ja lukukierroksen jälkeen tehdään tasauslasku:
-- kulutus mittareittain (vanha ja uusi lukema) × yksikköhinta, josta
-- vähennetään kauden ennakot miinusrivinä.
--
-- Hinnat ovat vastikeperusteita (er_charge_bases, peruste 'meter'):
-- 'water' €/m³ ja 'hot_water' lämpimän veden oma €/m³-hinta (lämmitys
-- mukana). Jos lämpimälle vedelle ei ole omaa hintaa, käytetään 'water'.

alter table er_charge_bases drop constraint er_charge_bases_charge_type_check;
alter table er_charge_bases add constraint er_charge_bases_charge_type_check check (charge_type in (
  'maintenance', 'land', 'heating', 'capital', 'financing', 'water', 'hot_water', 'sauna', 'parking', 'other'));

-- ---------------------------------------------------------------------------
-- Mittarit
-- ---------------------------------------------------------------------------
create table er_water_meters (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references er_organizations(id),
  company_id uuid not null references er_housing_companies(id) on delete cascade,
  share_group_id uuid not null references er_share_groups(id) on delete cascade,
  kind text not null check (kind in ('cold', 'hot')),
  meter_number text,
  location text,
  -- Aloituslukema: asennuksen lukema tai viimeksi laskutettu lukema
  -- ennen eRappua. Ensimmäinen tasaus laskee kulutuksen tästä.
  installed_on date not null,
  start_reading numeric(12, 3) not null default 0 check (start_reading >= 0),
  -- Mittarin vaihto: vanhan loppulukema laskutetaan vielä seuraavassa tasauksessa.
  removed_on date,
  final_reading numeric(12, 3) check (final_reading is null or final_reading >= 0),
  notes text,
  created_at timestamptz not null default now(),
  check (removed_on is null or removed_on >= installed_on),
  check ((removed_on is null) = (final_reading is null))
);
create index er_water_meters_company on er_water_meters (company_id, share_group_id);

-- ---------------------------------------------------------------------------
-- Lukukierrokset ja lukemat
-- ---------------------------------------------------------------------------
create table er_water_reading_rounds (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references er_organizations(id),
  company_id uuid not null references er_housing_companies(id) on delete cascade,
  read_on date not null,
  status text not null default 'open' check (status in ('open', 'closed')),
  -- Osakas ja asukas voivat ilmoittaa lukeman portaalissa, kun kierros on auki.
  portal_open boolean not null default true,
  note text,
  created_by uuid references er_users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (company_id, read_on)
);

create table er_water_readings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references er_organizations(id),
  meter_id uuid not null references er_water_meters(id) on delete cascade,
  round_id uuid not null references er_water_reading_rounds(id) on delete cascade,
  read_on date not null,
  reading numeric(12, 3) not null check (reading >= 0),
  source text not null default 'staff' check (source in ('staff', 'portal')),
  entered_by uuid references er_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (meter_id, round_id)
);
create index er_water_readings_round on er_water_readings (round_id);

-- ---------------------------------------------------------------------------
-- Vesiennakot osakeryhmittäin (henkilökohtaisesti sovittu €/kk)
-- ---------------------------------------------------------------------------
create table er_water_advances (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references er_organizations(id),
  company_id uuid not null references er_housing_companies(id) on delete cascade,
  share_group_id uuid not null references er_share_groups(id) on delete cascade,
  monthly_eur numeric(10, 2) not null check (monthly_eur >= 0),
  starts_on date not null,
  ends_on date,
  note text,
  created_at timestamptz not null default now(),
  check (ends_on is null or ends_on >= starts_on)
);
create index er_water_advances_group on er_water_advances (share_group_id, starts_on desc);

-- ---------------------------------------------------------------------------
-- Laskutusajot: vastikeajo tai vesimaksun tasaus
-- ---------------------------------------------------------------------------
alter table er_billing_runs
  add column kind text not null default 'charges' check (kind in ('charges', 'water_settlement')),
  add column reading_round_id uuid references er_water_reading_rounds(id) on delete restrict,
  add constraint er_billing_runs_round_kind check ((kind = 'water_settlement') = (reading_round_id is not null));
drop index er_billing_runs_period;
create unique index er_billing_runs_period on er_billing_runs (company_id, period_start) where status <> 'cancelled' and kind = 'charges';
create unique index er_billing_runs_round on er_billing_runs (reading_round_id) where status <> 'cancelled' and reading_round_id is not null;

-- Laskutusperusteet riville: mittari, vanha ja uusi lukema päivineen.
alter table er_billing_lines
  add column line_no smallint not null default 0,
  add column meter_id uuid references er_water_meters(id) on delete set null,
  add column reading_start numeric(12, 3),
  add column reading_start_on date,
  add column reading_end numeric(12, 3),
  add column reading_end_on date;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['er_water_meters', 'er_water_reading_rounds', 'er_water_readings', 'er_water_advances'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy staff_read on %I for select to authenticated using (organization_id in (select er_my_org_ids()))', t);
    execute format(
      'create policy staff_write on %I for all to authenticated
         using (er_has_org_role(organization_id, array[''owner'',''manager'',''assistant'',''accountant'']))
         with check (er_has_org_role(organization_id, array[''owner'',''manager'',''assistant'',''accountant'']))', t);
    execute format('grant select, insert, update, delete on %I to authenticated', t);
    execute format('grant all on %I to service_role', t);
  end loop;
end $$;

-- Portaali: osakas ja asukas näkevät oman huoneistonsa mittarit ja lukemat
-- sekä yhtiön lukukierrokset. Ennakko kuuluu maksajalle eli osakkaalle.
create policy portal_own_meters on er_water_meters for select to authenticated
  using (share_group_id in (select er_portal_share_group_ids()));
create policy portal_rounds on er_water_reading_rounds for select to authenticated
  using (company_id in (select er_portal_company_ids(array['owner', 'resident'])));
create policy portal_own_readings on er_water_readings for select to authenticated
  using (meter_id in (select id from er_water_meters where share_group_id in (select er_portal_share_group_ids())));
create policy portal_own_advances on er_water_advances for select to authenticated
  using (share_group_id in (select er_portal_owner_share_group_ids()));

-- Lukeman ilmoitus portaalissa: vain oma mittari, avoin kierros, jolla
-- portaali-ilmoitus on sallittu. Henkilökunnan kirjaamaa lukemaa ei korvata.
create or replace function er_portal_can_report_reading(p_meter uuid, p_round uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from er_water_meters m
      join er_water_reading_rounds r on r.company_id = m.company_id
     where m.id = p_meter and r.id = p_round
       and r.status = 'open' and r.portal_open
       and m.removed_on is null
       and m.share_group_id in (select er_portal_share_group_ids())
  )
$$;
grant execute on function er_portal_can_report_reading(uuid, uuid) to authenticated, service_role;

create policy portal_report_insert on er_water_readings for insert to authenticated
  with check (source = 'portal' and entered_by = er_current_user_id() and er_portal_can_report_reading(meter_id, round_id));
create policy portal_report_update on er_water_readings for update to authenticated
  using (source = 'portal' and er_portal_can_report_reading(meter_id, round_id))
  with check (source = 'portal' and entered_by = er_current_user_id() and er_portal_can_report_reading(meter_id, round_id));
grant select, insert, update on er_water_readings to authenticated;

create trigger er_water_readings_touch before update on er_water_readings for each row execute function er_touch_updated_at();
