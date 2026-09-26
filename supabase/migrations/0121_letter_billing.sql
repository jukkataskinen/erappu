-- 0121 Postikulujen laskutus taloyhtiöiltä (Jukka 26.9.2026).
--
-- Postitukset menevät asiakkaan (taloyhtiön) maksettaviksi. Isännöintiyritys
-- laskuttaa ne Fennoassa organisaation omalla kirjehinnalla (asetukset,
-- settings.letter_prices), noin kolmen kuukauden välein, ja laskun riveillä
-- kerrotaan, mitä on postitettu.
--
-- Hinta lukitaan kirjetyölle vahvistushetkellä (charge_*): myöhempi
-- hinnanmuutos ei muuta jo postitettujen kirjeiden veloitusta. Kirjetyö
-- sidotaan laskuun (billing_invoice_id), jolloin samaa postitusta ei voi
-- laskuttaa kahdesti.

alter table er_letter_jobs
  add column description text,
  add column charge_letter_eur numeric(10, 2) check (charge_letter_eur >= 0),
  add column charge_page_eur numeric(10, 2) check (charge_page_eur >= 0),
  add column charge_total_eur numeric(10, 2) check (charge_total_eur >= 0);

-- Taloyhtiön laskutustiedot isännöintiyrityksen laskulle (Fennoa).
-- Laskukanavalle ei ole oletusta: puuttuva kanava estää viennin, jottei lasku
-- lähde eri kanavaa kuin on sovittu (Mittarilukeman päätös 25.9.2026).
create table er_company_billing (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references er_organizations(id),
  company_id uuid not null unique references er_housing_companies(id) on delete cascade,
  fennoa_customer_no text,
  invoice_channel text check (invoice_channel in ('paper', 'email', 'einvoice')),
  einvoice_address text,
  einvoice_operator text,
  email text,
  street_address text,
  postal_code text,
  city text,
  updated_by uuid references er_users(id) on delete set null,
  updated_at timestamptz not null default now()
);

-- Laskutusajo: jakson postitukset yhtiöittäin laskuiksi.
create table er_letter_billing_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references er_organizations(id),
  period_start date not null,
  period_end date not null check (period_end >= period_start),
  invoice_date date not null,
  due_date date not null check (due_date >= invoice_date),
  vat_percent numeric(4, 1) not null check (vat_percent >= 0 and vat_percent < 100),
  created_by uuid references er_users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index er_letter_billing_runs_org on er_letter_billing_runs (organization_id, created_at desc);

create table er_letter_billing_invoices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references er_organizations(id),
  run_id uuid not null references er_letter_billing_runs(id) on delete cascade,
  company_id uuid not null references er_housing_companies(id),
  total_net_eur numeric(12, 2) not null check (total_net_eur >= 0),
  -- pending = viemättä, exporting = vienti kesken (varattu), exported = luonnos Fennoassa, failed = vienti epäonnistui.
  status text not null default 'pending' check (status in ('pending', 'exporting', 'exported', 'failed')),
  environment text check (environment in ('mock', 'test')),
  fennoa_invoice_id text,
  message text,
  exported_at timestamptz,
  unique (run_id, company_id)
);

alter table er_letter_jobs add column billing_invoice_id uuid references er_letter_billing_invoices(id) on delete set null;
create index er_letter_jobs_billing on er_letter_jobs (billing_invoice_id);

-- Laskun, ajon ja yhtiön organisaation on oltava sama.
create or replace function er_letter_billing_check_org() returns trigger language plpgsql as $$
begin
  if not exists (select 1 from er_letter_billing_runs r where r.id = new.run_id and r.organization_id = new.organization_id)
     or not exists (select 1 from er_housing_companies c where c.id = new.company_id and c.organization_id = new.organization_id) then
    raise exception 'billing invoice does not match its organization';
  end if;
  return new;
end $$;
create trigger er_letter_billing_check_org before insert or update on er_letter_billing_invoices
  for each row execute function er_letter_billing_check_org();

create or replace function er_company_billing_check_org() returns trigger language plpgsql as $$
begin
  if not exists (select 1 from er_housing_companies c where c.id = new.company_id and c.organization_id = new.organization_id) then
    raise exception 'company belongs to another organization';
  end if;
  return new;
end $$;
create trigger er_company_billing_check_org before insert or update on er_company_billing
  for each row execute function er_company_billing_check_org();

alter table er_company_billing enable row level security;
alter table er_letter_billing_runs enable row level security;
alter table er_letter_billing_invoices enable row level security;

-- Laskutus kuuluu pääkäyttäjälle, isännöitsijälle ja kirjanpitäjälle (talous).
create policy staff_read on er_company_billing for select to authenticated
  using (organization_id in (select er_my_org_ids()));
create policy billing_write on er_company_billing for all to authenticated
  using (er_has_org_role(organization_id, array['owner', 'manager', 'accountant']))
  with check (er_has_org_role(organization_id, array['owner', 'manager', 'accountant']));

create policy staff_read on er_letter_billing_runs for select to authenticated
  using (organization_id in (select er_my_org_ids()));
create policy billing_write on er_letter_billing_runs for all to authenticated
  using (er_has_org_role(organization_id, array['owner', 'manager', 'accountant']))
  with check (er_has_org_role(organization_id, array['owner', 'manager', 'accountant']));

create policy staff_read on er_letter_billing_invoices for select to authenticated
  using (organization_id in (select er_my_org_ids()));
create policy billing_write on er_letter_billing_invoices for all to authenticated
  using (er_has_org_role(organization_id, array['owner', 'manager', 'accountant']))
  with check (er_has_org_role(organization_id, array['owner', 'manager', 'accountant']));

-- Kirjanpitäjä sitoo kirjetyön laskuun (ja hinnoittelee lukitsemattoman), mutta
-- ei saa muuttaa kirjetyön muita tietoja (tila, lukittu hinta). Taulun päivitysoikeus on taulukohtainen, joten raja
-- on triggerissä.
create policy accountant_billing on er_letter_jobs for update to authenticated
  using (er_has_org_role(organization_id, array['accountant']))
  with check (er_has_org_role(organization_id, array['accountant']));

create or replace function er_letter_jobs_guard_billing() returns trigger language plpgsql as $$
begin
  if current_user = 'authenticated' and not er_has_org_role(new.organization_id, array['owner', 'manager'])
     and ((to_jsonb(new) - array['billing_invoice_id', 'charge_letter_eur', 'charge_page_eur', 'charge_total_eur'])
            is distinct from (to_jsonb(old) - array['billing_invoice_id', 'charge_letter_eur', 'charge_page_eur', 'charge_total_eur'])
          -- Hinnan saa asettaa laskutusajossa vain, jos sitä ei ole lukittu.
          or (old.charge_total_eur is not null and new.charge_total_eur is distinct from old.charge_total_eur)) then
    raise exception 'only billing link can be changed';
  end if;
  return new;
end $$;
create trigger er_letter_jobs_guard_billing before update on er_letter_jobs
  for each row execute function er_letter_jobs_guard_billing();

-- Fennoaan viety tai vienti kesken olevaa laskua ei poisteta (eikä sen ajoa):
-- luonnos on jo Fennoassa, ja sen postitukset on laskutettu.
create or replace function er_letter_billing_invoices_keep_exported() returns trigger language plpgsql as $$
begin
  if old.status in ('exported', 'exporting') then
    raise exception 'exported billing invoice cannot be deleted';
  end if;
  return old;
end $$;
create trigger er_letter_billing_invoices_keep_exported before delete on er_letter_billing_invoices
  for each row execute function er_letter_billing_invoices_keep_exported();

grant select, insert, update, delete on er_company_billing to authenticated;
grant select, insert, update, delete on er_letter_billing_runs to authenticated;
grant select, insert, update, delete on er_letter_billing_invoices to authenticated;
grant all on er_company_billing to service_role;
grant all on er_letter_billing_runs to service_role;
grant all on er_letter_billing_invoices to service_role;
