-- 0094 Vastuunjakotaulukon yhtiökohtaiset poikkeukset (AOYL 4:1 § 1 mom).
--
-- Vakiotulkinnat ovat koodissa (src/lib/responsibility/content.ts). Kunnossapito-
-- vastuu jaetaan lain mukaan, jollei yhtiöjärjestyksessä määrätä toisin, ja
-- yhtiökokous voi päättää osakkaalle kuuluvan työn tekemisestä yhtiön kustannuksella
-- (4:1 § 2 mom). Tähän tauluun kirjataan yhtiön poikkeava vastuu kohteittain ja sen
-- peruste. `item_key` viittaa koodin kohteeseen; tuntematon avain ei kaada sivua
-- vaan näytetään henkilökunnalle poistettavaksi.
--
-- Numero 0093 on varattu muutostyöilmoituksen lomakkeelle (haara muutostyolomake).

create table er_responsibility_exceptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references er_organizations(id),
  company_id uuid not null references er_housing_companies(id) on delete cascade,
  item_key text not null check (item_key ~ '^[a-z0-9-]{1,80}$'),
  responsibility text not null check (responsibility in ('company', 'shareholder', 'shared')),
  -- Mihin poikkeus perustuu: yhtiöjärjestys, yhtiökokouksen päätös tai muu.
  basis text not null default 'articles' check (basis in ('articles', 'meeting', 'other')),
  -- Perustelu osakkaalle, esim. yhtiöjärjestyksen pykälä tai päätöksen sisältö.
  note text not null check (length(btrim(note)) between 1 and 1000),
  decided_on date,
  -- Käsin kirjattu. Myöhemmin mahdollinen lähde esim. yhtiöjärjestyksen jäsennys.
  source text not null default 'manual' check (source in ('manual')),
  created_by uuid references er_users(id) on delete set null,
  updated_by uuid references er_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, item_key)
);

create trigger er_responsibility_exceptions_touch before update on er_responsibility_exceptions
  for each row execute function er_touch_updated_at();

-- ---------------------------------------------------------------------------
-- RLS: henkilökunta lukee, pääkäyttäjä, isännöitsijä ja avustaja kirjoittavat
-- (rekisterin tapaan; kirjanpitäjä ei). Portaalin käyttäjät (hallitus, osakkaat,
-- asukkaat) lukevat oman yhtiönsä poikkeukset, koska taulukko näytetään heille.
-- Palveluntuottajalle taulukkoa ei näytetä.
-- ---------------------------------------------------------------------------
alter table er_responsibility_exceptions enable row level security;
create policy staff_read on er_responsibility_exceptions for select to authenticated
  using (organization_id in (select er_my_org_ids()));
create policy staff_insert on er_responsibility_exceptions for insert to authenticated
  with check (er_has_org_role(organization_id, array['owner', 'manager', 'assistant'])
              and company_id in (select id from er_housing_companies where organization_id = er_responsibility_exceptions.organization_id));
create policy staff_update on er_responsibility_exceptions for update to authenticated
  using (er_has_org_role(organization_id, array['owner', 'manager', 'assistant']))
  with check (er_has_org_role(organization_id, array['owner', 'manager', 'assistant'])
              and company_id in (select id from er_housing_companies where organization_id = er_responsibility_exceptions.organization_id));
create policy staff_delete on er_responsibility_exceptions for delete to authenticated
  using (er_has_org_role(organization_id, array['owner', 'manager', 'assistant']));
create policy portal_read on er_responsibility_exceptions for select to authenticated
  using (company_id in (select er_portal_company_ids(array['board', 'owner', 'resident'])));
grant select, insert, update, delete on er_responsibility_exceptions to authenticated;
grant all on er_responsibility_exceptions to service_role;
