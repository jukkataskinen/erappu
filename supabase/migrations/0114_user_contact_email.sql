-- 0114 Henkilökunnan yhteystietosähköposti asiakirjoihin (Jukka 22.9.2026).
--
-- er_users.email on kirjautumistunnus (Auth0) eikä välttämättä se osoite, joka
-- halutaan kokouskutsuun, isännöitsijäntodistukseen tai pelastussuunnitelmaan.
-- Tyhjä = käytetään kirjautumissähköpostia.
alter table er_users add column contact_email text
  check (contact_email is null or contact_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$');
