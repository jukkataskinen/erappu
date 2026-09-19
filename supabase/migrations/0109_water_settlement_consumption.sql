-- 0109 Vesitasauksen kulutus kulutusseurantaan.
--
-- Tasauslaskutus kirjaa kunkin huoneiston laskutetun vedenkulutuksen
-- (m³ ja €) er_consumption_readings-tauluun huoneistokohtaisena rivinä.
-- Laskutusajon peruminen poistaa rivit (billing_run_id).

alter table er_consumption_readings drop constraint er_consumption_readings_source_check;
alter table er_consumption_readings
  add constraint er_consumption_readings_source_check check (source in ('manual', 'csv', 'water_billing')),
  add column billing_run_id uuid references er_billing_runs(id) on delete cascade;
create index er_consumption_billing_run on er_consumption_readings (billing_run_id) where billing_run_id is not null;
