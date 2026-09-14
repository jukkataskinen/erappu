-- 0011 Julkinen huoltopyyntölomake (QR) ja kutsurajoitin.
--
-- Lomakelinkki on tarkoituksella julkinen: se tulostetaan porraskäytävään.
-- Siksi token tallennetaan tiivisteen lisäksi salattuna, jotta henkilökunta
-- voi näyttää saman linkin ja QR-koodin uudelleen. Vaihtamalla linkin vanha
-- lakkaa toimimasta.

create table er_public_request_forms (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references er_organizations(id),
  company_id uuid not null unique references er_housing_companies(id) on delete cascade,
  access_link_id uuid not null references er_access_links(id),
  token_encrypted text not null,
  created_by uuid references er_users(id),
  created_at timestamptz not null default now()
);

alter table er_public_request_forms enable row level security;
create policy staff_read on er_public_request_forms for select to authenticated
  using (organization_id in (select er_my_org_ids()));
create policy staff_write on er_public_request_forms for all to authenticated
  using (er_has_org_role(organization_id, array['owner', 'manager', 'assistant']))
  with check (er_has_org_role(organization_id, array['owner', 'manager', 'assistant']));
grant select, insert, update, delete on er_public_request_forms to authenticated;
grant all on er_public_request_forms to service_role;

-- Kiinteän ikkunan laskuri julkisille reiteille. Avain on tiiviste
-- (esim. IP-osoitteen HMAC), ei selväkielinen osoite. Vain palvelun rooli.
create table er_rate_limits (
  organization_id uuid not null references er_organizations(id) on delete cascade,
  bucket text not null check (char_length(bucket) <= 200),
  window_start timestamptz not null,
  hits integer not null default 0,
  primary key (organization_id, bucket, window_start)
);
alter table er_rate_limits enable row level security;
grant all on er_rate_limits to service_role;
