-- 0091 Isännöitsijäntodistuksen yksityiskohdat: HTJ-siirto, ALV, vastikkeen
-- määrääjä, valtuutukset ja kanne (7 §), autopaikat, rakennusten
-- järjestelmät, huoneiston lisätiedot ja vakuutukset luettelona.

alter table er_housing_companies
  add column htj_register_transferred_on date,
  add column vat_registered boolean,
  add column vat_note text,
  -- Yhtiöjärjestyksen mukaan vastikkeen suuruuden ja maksutavan määrää (6 § 2 kohta), esim. "yhtiökokous".
  add column charges_decided_by text,
  -- Yhtiöjärjestys määrää kunnossapitovastuun jaosta tai osakkaan muutostyöoikeudesta toisin kuin laki (4 § 15 kohta).
  add column articles_maintenance_clause text,
  add column share_issue_authorization text,
  add column articles_lawsuit text,
  add column parking_hall_spaces integer check (parking_hall_spaces is null or parking_hall_spaces >= 0),
  add column parking_other_spaces integer check (parking_other_spaces is null or parking_other_spaces >= 0),
  add column parking_company_spaces integer check (parking_company_spaces is null or parking_company_spaces >= 0),
  add column parking_allocation_rules text;

alter table er_buildings
  add column heat_distribution text,
  add column cooling text,
  add column broadband text,
  add column broadband_provider text,
  add column antenna_provider text;

alter table er_share_groups
  add column votes integer check (votes is null or votes >= 0),
  add column area_verified boolean,
  add column staircase text,
  add column street_address text;

-- ---------------------------------------------------------------------------
-- Vakuutukset luettelona. Vanhat sarakkeet (insurance_company,
-- insurance_type) säilyvät, ja niiden arvo kopioidaan ensimmäiseksi riviksi.
-- ---------------------------------------------------------------------------
create table er_company_insurances (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references er_organizations(id),
  company_id uuid not null references er_housing_companies(id) on delete cascade,
  insurance_type text not null,
  name text,
  insurer text,
  description text,
  created_at timestamptz not null default now()
);
create index er_company_insurances_company on er_company_insurances (company_id);

insert into er_company_insurances (organization_id, company_id, insurance_type, insurer)
select organization_id, id, coalesce(nullif(trim(insurance_type), ''), 'Kiinteistövakuutus'), nullif(trim(insurance_company), '')
  from er_housing_companies
 where coalesce(trim(insurance_company), '') <> '' or coalesce(trim(insurance_type), '') <> '';

alter table er_company_insurances enable row level security;
create policy staff_read on er_company_insurances for select to authenticated
  using (organization_id in (select er_my_org_ids()));
create policy staff_write on er_company_insurances for all to authenticated
  using (er_has_org_role(organization_id, array['owner', 'manager', 'assistant']))
  with check (er_has_org_role(organization_id, array['owner', 'manager', 'assistant'])
              and company_id in (select id from er_housing_companies where organization_id = er_company_insurances.organization_id));
create policy portal_board on er_company_insurances for select to authenticated
  using (company_id in (select er_portal_company_ids(array['board'])));
grant select, insert, update, delete on er_company_insurances to authenticated;
grant all on er_company_insurances to service_role;
