-- Paikallinen Supabase-jäljitelmä PGlitelle.
--
-- Supabasessa nämä ovat valmiina: roolit anon/authenticated/service_role,
-- skeema auth ja funktio auth.jwt(). Paikallisesti ne luodaan tässä, jotta
-- migraatiot ja RLS-säännöt ovat SAMAT kuin tuotannossa ja testit todistavat
-- oikean käyttäytymisen. Tätä tiedostoa EI ajeta Supabaseen.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end $$;

create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;

-- Sama toteutus kuin Supabasessa: pyynnön JWT-väitteet luetaan
-- istuntoasetuksesta request.jwt.claims.
create or replace function auth.jwt() returns jsonb
language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;
grant execute on function auth.jwt() to anon, authenticated, service_role;
