-- 0097 Yhtiöjärjestyksen hallinto-määräykset: hallituksen ja tarkastajien määrät.
--
-- Varsinaisen yhtiökokouksen esityslista (AOYL 6:3 §) valitsee hallituksen
-- jäsenet ja tarkastajat yhtiöjärjestyksen mukaisina määrinä, jotka vaihtelevat
-- yhtiöittäin (Jukka 17.9.2026). Määrä voi olla kiinteä (min = max) tai väli,
-- jolloin kokous päättää ensin lukumäärästä.
--
-- auditor_kind:
--   operations_auditor = toiminnantarkastaja (myös ennen 2010 kirjoitettu
--     tilintarkastajamääräys, kun lakisääteistä tilintarkastusvelvollisuutta ei
--     ole: AOYL:n voimaanpanolaki 1600/2009 11 §)
--   auditor = tilintarkastuslain mukainen tilintarkastaja (AOYL 7:5 § tai yhtiöjärjestys)
--   optional = yhtiöjärjestyksen mukaan valinta ei ole pakollinen

alter table er_housing_companies add column board_members_min smallint check (board_members_min is null or board_members_min between 1 and 20);
alter table er_housing_companies add column board_members_max smallint check (board_members_max is null or board_members_max between 1 and 20);
alter table er_housing_companies add column board_deputies_min smallint check (board_deputies_min is null or board_deputies_min between 0 and 20);
alter table er_housing_companies add column board_deputies_max smallint check (board_deputies_max is null or board_deputies_max between 0 and 20);
alter table er_housing_companies add column auditor_kind text check (auditor_kind is null or auditor_kind in ('operations_auditor', 'auditor', 'optional'));
alter table er_housing_companies add column auditors_count smallint check (auditors_count is null or auditors_count between 0 and 5);
alter table er_housing_companies add column deputy_auditors_count smallint check (deputy_auditors_count is null or deputy_auditors_count between 0 and 5);
-- Lähde, esim. "Yhtiöjärjestys 7 § ja 11 § (rek. 3.12.1986)".
alter table er_housing_companies add column governance_source text check (governance_source is null or char_length(governance_source) <= 300);

alter table er_housing_companies add constraint er_housing_companies_board_range
  check (board_members_min is null or board_members_max is null or board_members_min <= board_members_max);
alter table er_housing_companies add constraint er_housing_companies_deputy_range
  check (board_deputies_min is null or board_deputies_max is null or board_deputies_min <= board_deputies_max);
