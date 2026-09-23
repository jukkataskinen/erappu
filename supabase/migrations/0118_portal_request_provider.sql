-- Ilmoittajan pitää nähdä, keneltä työ on tilattu (Jukka 23.9.2026). Aiemmin
-- palveluntuottajan nimen näki portaalissa vain hallitus (0002), joten osakkaan
-- ja asukkaan näkymässä luki vain "Työ on tilattu korjaajalta".
-- Rajaus: vain sen pyynnön palveluntuottaja, jonka ilmoittaja käyttäjä itse on.
create policy portal_request_provider on er_service_providers for select to authenticated
  using (id in (select provider_id from er_service_requests
                 where provider_id is not null and reporter_user_id = er_current_user_id()));
