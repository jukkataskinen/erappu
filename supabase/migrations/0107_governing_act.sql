-- 0107 Yhtiöön sovellettava laki kokousasiakirjoja varten.
--
-- AOYL 28:1: keskinäiseen kiinteistöosakeyhtiöön sovelletaan
-- asunto-osakeyhtiölakia, jollei yhtiöjärjestyksessä määrätä toisin; jos
-- perusilmoitus on tehty ennen 1.1.1992, vain jos yhtiöjärjestys niin
-- määrää. Muilta osin sovelletaan osakeyhtiölakia. Tyhjä = päätellään
-- yhtiömuodosta (asunto-oy ja koy: AOYL, muu: OYL).

alter table er_housing_companies
  add column governing_act text check (governing_act in ('aoyl', 'oyl'));
