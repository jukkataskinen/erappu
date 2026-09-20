-- 0111 Taloyhtiön vastine eSinetissä.
--
-- eSinetti tallentaa allekirjoituskierrokset yhtiölle. Ilman tätä kaikki
-- kierrokset menisivät organisaation oletusyhtiölle, jolloin eSinetin arkisto
-- olisi yksi kasa. eRappu luo yhtiön eSinettiin ensimmäisellä kerralla
-- (POST /companies, upsert y-tunnuksella) ja muistaa tunnisteen tässä.

alter table er_housing_companies
  add column esinetti_company_id uuid;

comment on column er_housing_companies.esinetti_company_id is
  'Yhtiön tunniste eSinetissä (sin_companies.id). Tyhjä = ei vielä luotu.';
