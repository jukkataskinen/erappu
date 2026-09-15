-- 0090 Isännöitsijäntodistuksen sisällön täydennys: kiinnitykset, lainojen
-- ehdot, korjausten päätöspäivä, yhtiön ja huoneiston lisätiedot,
-- huoneiston hallintatiedot, selvitysten päivät, todistuksen käyttötarkoitus
-- ja liitteet.
--
-- VNa 365/2010 (muut. 174/2013 ja 567/2026) edellyttää mm. rekisteröintipäivää
-- (3 §), yhtiön hallintaan ottamista (4 § 7), kunnossapitotarveselvitystä ja
-- -suunnitelmaa (5 § 9–10) sekä 1.1.2027 alkaen kohteen vakuuksia (6 § 5).

-- ---------------------------------------------------------------------------
-- Yhtiö
-- ---------------------------------------------------------------------------
alter table er_housing_companies
  add column registered_on date,
  add column certificate_notes text,
  -- Käytetään, jos kiinnityksiä ei ole eritelty er_property_mortgages-tauluun.
  add column mortgages_total_eur numeric(14, 2) check (mortgages_total_eur is null or mortgages_total_eur >= 0),
  add column maintenance_needs_report_on date,
  add column maintenance_plan_on date,
  add column maintenance_plan_summary text;

-- Kiinnitykset (panttikirjat). Yhtiötaso; kiinteistö valinnainen, koska
-- yhteiskiinnitys voi kohdistua useaan kiinteistöön.
create table er_property_mortgages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references er_organizations(id),
  company_id uuid not null references er_housing_companies(id) on delete cascade,
  property_id uuid references er_properties(id) on delete set null,
  amount_eur numeric(14, 2) not null check (amount_eur >= 0),
  -- Panttikirjan haltija tai vakuuden kohde, esim. "Esimerkkipankki, laina 2023" tai "yhtiön hallussa".
  holder text,
  registered_on date,
  notes text,
  created_at timestamptz not null default now()
);
create index er_property_mortgages_company on er_property_mortgages (company_id);

-- ---------------------------------------------------------------------------
-- Lainat: ehdot eriteltyinä. interest_terms (vapaa teksti) säilyy.
-- ---------------------------------------------------------------------------
alter table er_loans
  add column loan_type text check (loan_type in ('capital_charge', 'financing_charge', 'renovation', 'construction', 'credit_limit', 'other')),
  add column reference_rate text,
  add column margin_percent numeric(6, 3),
  add column interest_percent numeric(6, 3),
  add column undrawn_estimated_on date;

-- ---------------------------------------------------------------------------
-- Korjaukset: päätöspäivä päätetyille ja käynnissä oleville töille.
-- ---------------------------------------------------------------------------
alter table er_maintenance_needs add column decided_on date;

-- ---------------------------------------------------------------------------
-- Huoneisto: todistuksen lisätiedot ja hallintatiedot. Nämä ovat yhtiön
-- tietoja eivätkä HTJ:n osakeryhmätietoja, joten niitä muokataan myös
-- HTJ-peräisille osakeryhmille.
-- ---------------------------------------------------------------------------
alter table er_share_groups
  add column certificate_notes text,
  add column company_possession boolean not null default false,
  add column company_possession_decided_on date,
  add column company_possession_ends_on date,
  add column company_rented boolean not null default false,
  add column widow_right boolean,
  add column spouses_common_home text check (spouses_common_home in ('yes', 'no', 'unknown')),
  add column other_restrictions text;

-- ---------------------------------------------------------------------------
-- Todistustilaus: käyttötarkoitus, liitteet ja sinetöinti.
-- ---------------------------------------------------------------------------
alter table er_certificate_orders
  add column purpose text check (purpose in ('bank', 'sale', 'rental', 'other')),
  add column purpose_text text,
  add column with_attachments boolean not null default false,
  -- Laatijan poistamat liiteluokat; oletuksena kaikki saatavilla olevat liitetään.
  add column excluded_attachments text[] not null default '{}',
  -- Viimeisimmän muodostuksen liiteluettelo (numero, nimi, sivut, tila). Ei henkilötietoja.
  add column attachments jsonb not null default '[]',
  add column sealed_at timestamptz;

-- ---------------------------------------------------------------------------
-- Dokumenttiluokka kunnossapitotarveselvitykselle (AOYL 6:3 § 2 mom. 2 k.).
-- maintenance_plan on kunnossapitosuunnitelma (PTS) ja condition_assessment
-- kuntoarvio; selvitys on hallituksen oma asiakirja yhtiökokoukselle.
-- ---------------------------------------------------------------------------
do $$
declare
  c record;
begin
  for c in
    select conname from pg_constraint
     where conrelid = 'er_documents'::regclass and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%category%'
  loop
    execute format('alter table er_documents drop constraint %I', c.conname);
  end loop;
end $$;

alter table er_documents add constraint er_documents_category_check check (category in (
  'articles', 'financial_statement', 'budget', 'energy_certificate', 'floor_plan',
  'minutes', 'meeting_notice', 'contract', 'condition_assessment', 'maintenance_plan', 'maintenance_needs_report',
  'manager_certificate', 'photo', 'insurance', 'other'));

-- ---------------------------------------------------------------------------
-- RLS: kiinnitykset ovat talouden tietoja kuten lainat (0004), joten myös
-- kirjanpitäjä kirjoittaa. Hallitus lukee oman yhtiönsä kiinnitykset.
-- ---------------------------------------------------------------------------
alter table er_property_mortgages enable row level security;
create policy staff_read on er_property_mortgages for select to authenticated
  using (organization_id in (select er_my_org_ids()));
create policy staff_write on er_property_mortgages for all to authenticated
  using (er_has_org_role(organization_id, array['owner', 'manager', 'assistant', 'accountant']))
  with check (er_has_org_role(organization_id, array['owner', 'manager', 'assistant', 'accountant'])
              and company_id in (select id from er_housing_companies where organization_id = er_property_mortgages.organization_id));
create policy portal_board on er_property_mortgages for select to authenticated
  using (company_id in (select er_portal_company_ids(array['board'])));
grant select, insert, update, delete on er_property_mortgages to authenticated;
grant all on er_property_mortgages to service_role;
