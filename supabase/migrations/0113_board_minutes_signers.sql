-- 0113 Hallituksen pöytäkirjan allekirjoittajat yhtiöjärjestyksen mukaan (Jukka 22.9.2026).
--
-- Tyhjä = lain mukaan (AOYL 7:6 §): kokouksen puheenjohtaja ja, jos hallituksessa
-- on useita jäseniä, vähintään yksi hallituksen siihen valitsema jäsen tai
-- kokouksessa läsnä ollut isännöitsijä.
--   chair_and_member  yhtiöjärjestys: puheenjohtaja ja hallituksen valitsema jäsen
--   all_present       yhtiöjärjestys: kaikki kokouksessa läsnä olleet
alter table er_housing_companies add column board_minutes_signers text
  check (board_minutes_signers in ('chair_and_member', 'all_present'));
