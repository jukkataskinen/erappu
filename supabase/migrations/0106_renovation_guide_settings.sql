-- 0106 Yhtiökohtaisen muutostyöohjeen asetukset.
--
-- eRappu muodostaa muutostyöohjeen PDF:n vakioteksteistä ja näistä
-- yhtiökohtaisista kentistä (src/lib/maintenance/renovation-guide.ts).
-- Valmis ohje tallennetaan dokumenttina luokkaan renovation_guide.

alter table er_housing_companies
  add column renovation_guide_settings jsonb not null default '{}'::jsonb;
