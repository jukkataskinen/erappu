-- 0105 Muutostyön valvonnan kustannusarvio.
--
-- Yhtiö voi valvoa osakkaan muutostyötä osakkaan kustannuksella (AOYL 5 luku).
-- Valvoja ja arvio kirjataan hakemuksittain; ne näkyvät osakkaalle
-- portaalissa ja päätösviestissä.

alter table er_renovation_notices
  add column supervision_cost_eur numeric(12, 2) check (supervision_cost_eur is null or supervision_cost_eur >= 0),
  add column supervision_cost_basis text check (supervision_cost_basis is null or length(supervision_cost_basis) <= 500);
