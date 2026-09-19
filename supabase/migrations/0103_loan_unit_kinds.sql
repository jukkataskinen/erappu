-- 0103 Lainaan osallistuvat huoneistotyypit.
--
-- Yhtiölaina voi yhtiöjärjestyksen tai yhtiökokouksen päätöksen mukaan
-- koskea vain osaa osakeryhmistä (esim. asuinhuoneistot, ei autotalleja).
-- null = kaikki osakeryhmät, kuten vastikeperusteissa (applies_to_kinds).
alter table er_loans add column applies_to_kinds text[];
