-- 0060 Vuosikello: taloyhtiöiden ja isännöintitoimiston tehtävät.
--
-- Toistuvasta tehtävästä on kannassa aina vain yksi avoin esiintymä. Kun se
-- kuitataan, sovellus luo seuraavan (sama series_id). Näin myöhästynyt
-- tehtävä ei katoa listalta, vaikka seuraava eräpäivä olisi jo tulossa.

create table er_tasks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references er_organizations(id),
  company_id uuid references er_housing_companies(id) on delete cascade,
  title text not null check (length(title) between 1 and 200),
  description text check (description is null or length(description) <= 4000),
  due_on date not null,
  recurrence jsonb check (
    recurrence is null or (
      jsonb_typeof(recurrence) = 'object'
      and recurrence ->> 'freq' in ('yearly', 'monthly', 'weekly')
      and coalesce((recurrence ->> 'interval')::int, 1) between 1 and 120
    )
  ),
  category text not null default 'other' check (category in (
    'financial_statement', 'general_meeting', 'htj_update', 'insurance', 'maintenance', 'contract', 'other')),
  assignee_user_id uuid references er_users(id) on delete set null,
  done_at timestamptz,
  done_by uuid references er_users(id) on delete set null,
  series_id uuid,
  -- Vakiovuosikellon pohjan tunniste (esim. 'general_meeting'), jotta samaa
  -- pohjaa ei luoda yhtiölle kahteen kertaan.
  template_key text,
  last_reminded_on date,
  created_by uuid references er_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index er_tasks_open on er_tasks (organization_id, due_on) where done_at is null;
create index er_tasks_company on er_tasks (company_id, due_on);
-- Sama toistuvan sarjan esiintymä ei synny kahdesti (tuplaklikkaus kuittauksessa).
create unique index er_tasks_series_due on er_tasks (series_id, due_on) where series_id is not null;

-- Toistuvan tehtävän ensimmäinen esiintymä on oman sarjansa juuri.
create or replace function er_tasks_series_default() returns trigger
language plpgsql as $$
begin
  if new.recurrence is not null and new.series_id is null then
    new.series_id := new.id;
  end if;
  return new;
end $$;
create trigger er_tasks_series before insert on er_tasks for each row execute function er_tasks_series_default();
create trigger er_tasks_touch before update on er_tasks for each row execute function er_touch_updated_at();

-- Tehtävät ovat vain henkilökunnan. Kirjanpitäjät vastaavat tilinpäätöksistä,
-- joten kaikki organisaatioroolit saavat kirjoittaa.
alter table er_tasks enable row level security;
create policy staff_read on er_tasks for select to authenticated
  using (organization_id in (select er_my_org_ids()));
create policy staff_write on er_tasks for all to authenticated
  using (er_has_org_role(organization_id, array['owner', 'manager', 'assistant', 'accountant']))
  with check (
    er_has_org_role(organization_id, array['owner', 'manager', 'assistant', 'accountant'])
    and (company_id is null or company_id in (select id from er_housing_companies where organization_id = er_tasks.organization_id))
    -- Muistutus lähtee vastuuhenkilön sähköpostiin, joten hänen on oltava saman organisaation jäsen.
    and (assignee_user_id is null or assignee_user_id in (select user_id from er_org_members where organization_id = er_tasks.organization_id))
  );
grant select, insert, update, delete on er_tasks to authenticated;
grant all on er_tasks to service_role;
