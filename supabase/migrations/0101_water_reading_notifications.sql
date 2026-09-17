-- 0101 Vesimittarin lukupyyntö ja muistutus sähköpostilla.
--
-- Lukupyyntö lähtee lukemapäivänä (tai heti, jos kierros avataan
-- myöhemmin), muistutus kerran kaksi päivää ennen ilmoituksen määräpäivää
-- niille huoneistoille, joilta lukema puuttuu. Aikaleimat tekevät
-- päivittäisestä ajosta idempotentin.

alter table er_water_reading_rounds
  add column report_by date,
  add column notified_at timestamptz,
  add column notified_count integer,
  add column reminded_at timestamptz,
  add column reminded_count integer;

update er_water_reading_rounds set report_by = read_on + 7 where report_by is null;
alter table er_water_reading_rounds
  alter column report_by set not null,
  add constraint er_water_reading_rounds_report_by check (report_by >= read_on);
