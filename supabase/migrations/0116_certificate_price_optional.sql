-- 0116 Todistuksen hinta vapaaehtoiseksi (Jukka 23.9.2026).
--
-- eRapussa ei ole omaa todistushinnastoa: jokainen isännöitsijä päättää
-- hinnan itse tai yhdessä hallituksen kanssa. Hinta tulee organisaation
-- asetuksista (`certificate_prices`), ja jos niitä ei ole annettu, tilaus jää
-- hinnoittelematta. Vanhat tilaukset säilyttävät hintansa.
alter table er_certificate_orders alter column price_eur drop not null;
