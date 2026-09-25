-- 0120 Paperikirjeet Postitan kautta (Jukka 25.9.2026).
--
-- Kirjeet ladataan Postita.fi:hin vahvistamattomana työnä, jotta vedoksen voi
-- tarkistaa, ja postitus vahvistetaan eRapusta. Yksi työ kattaa yhden
-- kokouskutsun tai tiedotteen kirjeet.
--
-- er_letters on kirje vastaanottajaa kohden. Nimi ja osoite tallennetaan
-- sellaisina kuin ne tulostettiin: jos kutsun toimittamisesta tulee riita,
-- on nähtävissä, mihin osoitteeseen kirje lähti, vaikka osoite myöhemmin
-- muuttuisi rekisterissä. Rivit näkyvät vain henkilökunnalle.
--
-- Samalle osapuolelle ei voi olla kahta voimassa olevaa kirjettä samasta
-- asiasta, eikä asialla kahta keskeneräistä työtä (osittaiset uniikit
-- indeksit), jolloin rinnakkainen tai toistettu lataus ei tuota tuplakirjeitä.

create table er_letter_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references er_organizations(id),
  company_id uuid not null references er_housing_companies(id),
  subject_table text not null check (subject_table in ('er_meetings', 'er_announcements')),
  subject_id uuid not null,
  provider text not null check (provider in ('mock', 'postita')),
  provider_job_id text,
  -- uploading = varattu, lataus kesken; NE/CO/PR/SE/CA = Postitan tilat; failed = lataus epäonnistui.
  status text not null default 'uploading' check (status in ('uploading', 'NE', 'CO', 'PR', 'SE', 'CA', 'failed')),
  post_class smallint not null check (post_class in (1, 2)),
  letter_count integer not null check (letter_count > 0),
  pages_per_letter integer not null check (pages_per_letter between 1 and 12),
  price numeric(10, 2),
  created_by uuid references er_users(id) on delete set null,
  created_at timestamptz not null default now(),
  confirmed_by uuid references er_users(id) on delete set null,
  confirmed_at timestamptz,
  cancelled_by uuid references er_users(id) on delete set null,
  cancelled_at timestamptz,
  updated_at timestamptz not null default now(),
  check (status in ('uploading', 'failed') or provider_job_id is not null)
);
create index er_letter_jobs_subject on er_letter_jobs (subject_table, subject_id, created_at desc);
create unique index er_letter_jobs_one_open on er_letter_jobs (subject_table, subject_id) where status in ('uploading', 'NE');

create table er_letters (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references er_organizations(id),
  job_id uuid not null references er_letter_jobs(id) on delete cascade,
  subject_table text not null check (subject_table in ('er_meetings', 'er_announcements')),
  subject_id uuid not null,
  party_id uuid not null references er_parties(id),
  recipient_name text not null,
  address_lines text[] not null check (cardinality(address_lines) between 2 and 4),
  -- reserved = mukana vahvistamattomassa työssä, confirmed = postitus vahvistettu, cancelled = työ peruttu tai lataus epäonnistui.
  status text not null default 'reserved' check (status in ('reserved', 'confirmed', 'cancelled')),
  created_at timestamptz not null default now()
);
create index er_letters_job on er_letters (job_id);
create unique index er_letters_one_active on er_letters (subject_table, subject_id, party_id) where status <> 'cancelled';

-- Rivin organisaation on oltava työn ja osapuolen organisaatio, ettei toisen
-- organisaation työhön tai osakkaalle voi liittää kirjeitä.
create or replace function er_letters_check_org() returns trigger language plpgsql as $$
begin
  if not exists (select 1 from er_letter_jobs j where j.id = new.job_id and j.organization_id = new.organization_id
                   and j.subject_table = new.subject_table and j.subject_id = new.subject_id) then
    raise exception 'letter does not match its job';
  end if;
  if not exists (select 1 from er_parties p where p.id = new.party_id and p.organization_id = new.organization_id) then
    raise exception 'letter party belongs to another organization';
  end if;
  return new;
end $$;
create trigger er_letters_check_org before insert or update on er_letters
  for each row execute function er_letters_check_org();

alter table er_letter_jobs enable row level security;
alter table er_letters enable row level security;

-- Kaikki henkilökunta näkee kirjeet (kirjanpitäjä laskuttaa postikulut).
-- Lataus, vahvistus ja peruutus maksavat ja lähtevät yhtiön nimissä, joten ne
-- tekee pääkäyttäjä tai isännöitsijä, kuten tiedotteen julkaisun.
create policy staff_read on er_letter_jobs for select to authenticated
  using (organization_id in (select er_my_org_ids()));
create policy manager_insert on er_letter_jobs for insert to authenticated
  with check (er_has_org_role(organization_id, array['owner', 'manager'])
              and company_id in (select id from er_housing_companies where organization_id = er_letter_jobs.organization_id));
create policy manager_update on er_letter_jobs for update to authenticated
  using (er_has_org_role(organization_id, array['owner', 'manager']))
  with check (er_has_org_role(organization_id, array['owner', 'manager']));

create policy staff_read on er_letters for select to authenticated
  using (organization_id in (select er_my_org_ids()));
create policy manager_insert on er_letters for insert to authenticated
  with check (er_has_org_role(organization_id, array['owner', 'manager']));
create policy manager_update on er_letters for update to authenticated
  using (er_has_org_role(organization_id, array['owner', 'manager']))
  with check (er_has_org_role(organization_id, array['owner', 'manager']));

grant select, insert, update on er_letter_jobs to authenticated;
grant select, insert, update on er_letters to authenticated;
grant all on er_letter_jobs to service_role;
grant all on er_letters to service_role;
