-- 0092 Pelastussuunnitelmat (pelastuslaki 379/2011 15 §, VNa 407/2011 1–2 §).
--
-- Asuinrakennukseen, jossa on vähintään kolme asuinhuoneistoa, on laadittava
-- pelastussuunnitelma, pidettävä se ajan tasalla ja saatettava asukkaiden
-- tietoon. Suunnitelma versioidaan: uusi versio laaditaan luonnoksena vanhan
-- pohjalta, ja valmiiksi merkitty versio korvaa edellisen. Vanhat versiot ja
-- niiden PDF:t säilyvät (vanha PDF muutetaan sisäiseksi sovelluksessa).
--
-- Lomakkeen sisältö on jsonb-kentässä, koska osioiden kentät ovat pohjan
-- versiokohtaisia (src/lib/rescue-plans/content.ts) eikä niitä haeta
-- kyselyillä. Valmiin version sisältö ei enää muutu (trigger alla).

create table er_rescue_plans (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references er_organizations(id),
  company_id uuid not null references er_housing_companies(id) on delete cascade,
  version integer not null check (version >= 1),
  status text not null default 'draft' check (status in ('draft', 'final')),
  -- Pohjan versio, jolla sisältö on tallennettu (src/lib/rescue-plans/content.ts).
  template_version integer not null default 1,
  content jsonb not null default '{}' check (jsonb_typeof(content) = 'object'),
  prepared_on date,
  next_review_on date,
  -- Dokumentin näkyvyys valmiiksi merkittäessä. Oletus: kaikki asukkaat, koska
  -- suunnitelma on saatettava asukkaiden tietoon (VNa 407/2011 3 §).
  visibility text not null default 'residents' check (visibility in ('internal', 'board', 'owners', 'residents')),
  document_id uuid references er_documents(id) on delete set null,
  task_id uuid references er_tasks(id) on delete set null,
  finalized_at timestamptz,
  finalized_by uuid references er_users(id) on delete set null,
  superseded_at timestamptz,
  created_by uuid references er_users(id) on delete set null,
  updated_by uuid references er_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, version),
  check (status = 'draft' or (finalized_at is not null and prepared_on is not null and next_review_on is not null)),
  check (superseded_at is null or status = 'final')
);
create index er_rescue_plans_company on er_rescue_plans (company_id, version desc);
-- Yhtiöllä on kerrallaan yksi luonnos ja yksi voimassa oleva valmis versio.
create unique index er_rescue_plans_one_draft on er_rescue_plans (company_id) where status = 'draft';
create unique index er_rescue_plans_one_current on er_rescue_plans (company_id) where status = 'final' and superseded_at is null;

create trigger er_rescue_plans_touch before update on er_rescue_plans for each row execute function er_touch_updated_at();

-- Valmis versio on asiakirja, joka on annettu asukkaille: sisältöä, versiota
-- ja päiväyksiä ei voi muuttaa jälkikäteen, vaan muutos tehdään uutena
-- versiona. Vain korvautuminen ja viittaukset (dokumentti, tehtävä) päivittyvät.
create or replace function er_rescue_plans_freeze_final() returns trigger
language plpgsql as $$
begin
  if old.status = 'final' then
    if new.status <> old.status or new.content <> old.content or new.version <> old.version
       or new.company_id <> old.company_id or new.organization_id <> old.organization_id
       or new.prepared_on is distinct from old.prepared_on or new.next_review_on is distinct from old.next_review_on
       or new.visibility <> old.visibility or new.finalized_at is distinct from old.finalized_at
       or new.template_version <> old.template_version then
      raise exception 'Valmista pelastussuunnitelman versiota ei voi muuttaa. Laadi uusi versio.' using errcode = 'check_violation';
    end if;
    if old.superseded_at is not null and new.superseded_at is distinct from old.superseded_at then
      raise exception 'Korvattua versiota ei voi palauttaa voimaan.' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;
create trigger er_rescue_plans_freeze before update on er_rescue_plans for each row execute function er_rescue_plans_freeze_final();

-- ---------------------------------------------------------------------------
-- Dokumenttiluokka ja vuosikellon luokka
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
  for c in
    select conname from pg_constraint
     where conrelid = 'er_tasks'::regclass and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%category%'
  loop
    execute format('alter table er_tasks drop constraint %I', c.conname);
  end loop;
end $$;

alter table er_documents add constraint er_documents_category_check check (category in (
  'articles', 'financial_statement', 'budget', 'energy_certificate', 'floor_plan',
  'minutes', 'meeting_notice', 'contract', 'condition_assessment', 'maintenance_plan', 'maintenance_needs_report',
  'manager_certificate', 'rescue_plan', 'photo', 'insurance', 'other'));

alter table er_tasks add constraint er_tasks_category_check check (category in (
  'financial_statement', 'general_meeting', 'htj_update', 'insurance', 'maintenance', 'safety', 'contract', 'other'));

-- ---------------------------------------------------------------------------
-- RLS: henkilökunta lukee, pääkäyttäjä, isännöitsijä ja avustaja kirjoittavat
-- (rekisterin tapaan; kirjanpitäjä ei muokkaa rekisteriä). Vain luonnoksen
-- voi poistaa. Hallitus lukee oman yhtiönsä valmiit versiot; asukkaat saavat
-- suunnitelman dokumenttina (er_documents, näkyvyys).
-- ---------------------------------------------------------------------------
alter table er_rescue_plans enable row level security;
create policy staff_read on er_rescue_plans for select to authenticated
  using (organization_id in (select er_my_org_ids()));
create policy staff_insert on er_rescue_plans for insert to authenticated
  with check (er_has_org_role(organization_id, array['owner', 'manager', 'assistant'])
              and company_id in (select id from er_housing_companies where organization_id = er_rescue_plans.organization_id)
              and (document_id is null or document_id in (select id from er_documents where organization_id = er_rescue_plans.organization_id))
              and (task_id is null or task_id in (select id from er_tasks where organization_id = er_rescue_plans.organization_id)));
create policy staff_update on er_rescue_plans for update to authenticated
  using (er_has_org_role(organization_id, array['owner', 'manager', 'assistant']))
  with check (er_has_org_role(organization_id, array['owner', 'manager', 'assistant'])
              and company_id in (select id from er_housing_companies where organization_id = er_rescue_plans.organization_id)
              and (document_id is null or document_id in (select id from er_documents where organization_id = er_rescue_plans.organization_id))
              and (task_id is null or task_id in (select id from er_tasks where organization_id = er_rescue_plans.organization_id)));
create policy staff_delete_draft on er_rescue_plans for delete to authenticated
  using (status = 'draft' and er_has_org_role(organization_id, array['owner', 'manager', 'assistant']));
create policy portal_board on er_rescue_plans for select to authenticated
  using (status = 'final' and company_id in (select er_portal_company_ids(array['board'])));
grant select, insert, update, delete on er_rescue_plans to authenticated;
grant all on er_rescue_plans to service_role;
