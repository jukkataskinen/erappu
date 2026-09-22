-- 0115 Isännöitsijäntodistuksen maksutilanne käsin tarkistettuna (Jukka 22.9.2026).
--
-- Vastikkeet laskutetaan vielä Procountorissa, eikä reskontraa tuoda eRappuun
-- (er_payment_status). Isännöitsijä tarkistaa osakeryhmän erääntyneet
-- vastikkeet kirjanpidosta ja kirjaa ne tilaukselle: summa (0 = ei
-- erääntyneitä) ja tarkistuspäivä. Käsin kirjattu tieto menee todistukseen
-- tuodun reskontran edelle.
alter table er_certificate_orders
  add column payment_overdue_eur numeric(12,2) check (payment_overdue_eur is null or payment_overdue_eur >= 0),
  add column payment_checked_on date,
  add constraint er_certificate_orders_payment_check check ((payment_overdue_eur is null) = (payment_checked_on is null));
