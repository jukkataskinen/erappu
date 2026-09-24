-- Läsnäolijan oma sähköposti (Jukka 24.9.2026). Allekirjoittajien osoitteet
-- tulivat vain henkilörekisteristä (er_parties), joten käsin lisätty läsnäolija
-- – tyypillisesti isännöitsijä – ei voinut allekirjoittaa pöytäkirjaa, vaikka
-- AOYL 7:6 § nimeää hänet yhdeksi mahdolliseksi allekirjoittajaksi.
-- Tyhjä = käytetään rekisterin osoitetta.
alter table er_meeting_attendees add column email text
  check (email is null or email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$');
