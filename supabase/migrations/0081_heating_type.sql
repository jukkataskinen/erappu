-- 0081 Lämmitysmuoto rakennuksille ja lämmitysöljy kulutusseurantaan.
--
-- er_buildings.heating on Accessista tullutta vapaata tekstiä ("Suora sähkö",
-- "kaukolämpö", "Maalämpö/Suora sähkö"). Kulutusseuranta tarvitsee
-- tunnistettavan muodon: kaukolämmössä seurataan kaukolämpölukemia (MWh),
-- öljylämmityksessä öljyn kulutusta (litroina), ja sähkölämmityksessä
-- lämmitysenergia sisältyy sähkönkulutukseen.

alter table er_buildings add column heating_type text
  check (heating_type in ('district_heat', 'oil', 'direct_electric', 'ground_source', 'air_water', 'wood', 'other'));

-- Tekstistä jäsennys. Järjestys on merkitsevä: "Maalämpö/Suora sähkö" on
-- maalämpöä (sähkö on sen tukimuoto).
update er_buildings set heating_type = case
  when heating ilike '%kaukol%' then 'district_heat'
  when heating ilike '%öljy%' or heating ilike '%oljy%' then 'oil'
  when heating ilike '%maalä%' or heating ilike '%maala%' then 'ground_source'
  when heating ilike '%ilma-vesi%' or heating ilike '%ilmavesi%' then 'air_water'
  when heating ilike '%puu%' or heating ilike '%pelletti%' or heating ilike '%hake%' then 'wood'
  when heating ilike '%sähkö%' or heating ilike '%sahko%' then 'direct_electric'
  when heating is not null and trim(heating) <> '' then 'other'
  else null
end
where heating_type is null;

-- Kulutuslajit: 'heat' on kaukolämpö (kWh/MWh), uusi 'oil' on lämmitysöljy (litraa).
alter table er_consumption_readings drop constraint if exists er_consumption_readings_utility_check;
alter table er_consumption_readings drop constraint if exists er_consumption_readings_unit_check;
alter table er_consumption_readings drop constraint if exists er_consumption_readings_check1;

do $$
declare
  c record;
begin
  -- Nimetön (utility = 'water') = (unit = 'm3') -tarkistus poistetaan sisällön perusteella,
  -- koska sen automaattinen nimi voi vaihdella.
  for c in
    select conname from pg_constraint
     where conrelid = 'er_consumption_readings'::regclass and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%utility%' and pg_get_constraintdef(oid) ilike '%unit%'
  loop
    execute format('alter table er_consumption_readings drop constraint %I', c.conname);
  end loop;
end $$;

alter table er_consumption_readings add constraint er_consumption_readings_utility_check
  check (utility in ('electricity', 'water', 'heat', 'oil'));
alter table er_consumption_readings add constraint er_consumption_readings_unit_check
  check (unit in ('kWh', 'MWh', 'm3', 'l'));
alter table er_consumption_readings add constraint er_consumption_readings_utility_unit_check
  check (
    (utility = 'water' and unit = 'm3')
    or (utility = 'oil' and unit = 'l')
    or (utility in ('electricity', 'heat') and unit in ('kWh', 'MWh'))
  );
