-- 0108 Yhtiön turvallisuustiedot rekisteriin.
--
-- Pelastussuunnitelman kentät, joita rekisterissä ei ollut (BLOCKERS 11):
-- väestönsuoja, kokoontumispaikat ja pääsulkujen sijainnit. Esitäyttö ja
-- "Päivitä rekisteristä" käyttävät näitä (src/lib/rescue-plans/prefill.ts).

alter table er_housing_companies
  add column shelter text check (shelter in ('none', 'own', 'shared', 'unknown')),
  add column shelter_location text check (length(shelter_location) <= 300),
  add column shelter_capacity text check (length(shelter_capacity) <= 40),
  add column assembly_point text check (length(assembly_point) <= 300),
  add column assembly_point_alt text check (length(assembly_point_alt) <= 300),
  add column shutoff_water text check (length(shutoff_water) <= 300),
  add column shutoff_electricity text check (length(shutoff_electricity) <= 300),
  add column shutoff_ventilation text check (length(shutoff_ventilation) <= 300),
  add column shutoff_heating text check (length(shutoff_heating) <= 300);
