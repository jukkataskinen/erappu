-- 0095 Yhteydenotot: kaksisuuntainen viestiketju osakkaan tai asukkaan ja
-- isännöinnin välillä (PLAN "Muutostyöt ja portaali" 4).
--
-- Tiedotteet (0040) ovat yksisuuntaisia ja huoltopyynnöt (0010) koskevat
-- vikoja. Yhteydenotto on kaikkea muuta: vastikekysymykset, asiakirjapyynnöt,
-- muutostöitä edeltävät kysymykset. Ketjun aloittaa portaalikäyttäjä, ja
-- isännöinti vastaa. Ketju sulkeutuu henkilökunnan toimesta, ja uusi viesti
-- avaa sen uudelleen.
--
-- Tietosuoja: viestien sisältöä ei kopioida sähköpostiin. Ilmoitus kertoo
-- vain, että ketjussa on uusi viesti, ja sisältö luetaan kirjautuneena.

create table er_contact_threads (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references er_organizations(id),
  company_id uuid not null references er_housing_companies(id) on delete cascade,
  -- Huoneisto, jota yhteydenotto koskee. Tyhjä = yleinen yhtiötä koskeva asia.
  share_group_id uuid references er_share_groups(id) on delete set null,
  created_by_user_id uuid not null references er_users(id),
  topic text not null check (topic in ('general', 'charges', 'renovation', 'maintenance', 'documents', 'other')),
  subject text not null check (char_length(subject) between 3 and 200),
  -- open = odottaa isännöintiä, answered = isännöinti vastasi viimeksi,
  -- closed = käsitelty. Tila päivittyy viestistä triggerillä.
  status text not null default 'open' check (status in ('open', 'answered', 'closed')),
  last_message_at timestamptz not null default now(),
  closed_at timestamptz,
  closed_by uuid references er_users(id) on delete set null,
  created_at timestamptz not null default now(),
  check ((status = 'closed') = (closed_at is not null))
);
create index er_contact_threads_org on er_contact_threads (organization_id, status, last_message_at desc);
create index er_contact_threads_creator on er_contact_threads (created_by_user_id, last_message_at desc);

create table er_contact_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references er_organizations(id),
  thread_id uuid not null references er_contact_threads(id) on delete cascade,
  author_user_id uuid references er_users(id) on delete set null,
  -- Kirjoittiko viestin henkilökunta. Portaalikäyttäjän viesti on aina false (RLS).
  from_staff boolean not null,
  body text not null check (char_length(body) between 1 and 5000),
  created_at timestamptz not null default now()
);
create index er_contact_messages_thread on er_contact_messages (thread_id, created_at);

-- ---------------------------------------------------------------------------
-- Viesti päivittää ketjun tilan. Security definer, koska portaalikäyttäjä ei
-- saa päivittää ketjua suoraan (tila on henkilökunnan hallinnassa).
-- ---------------------------------------------------------------------------
create or replace function er_contact_message_after_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update er_contact_threads
     set last_message_at = new.created_at,
         status = case when new.from_staff then 'answered' else 'open' end,
         closed_at = null,
         closed_by = null
   where id = new.thread_id;
  return new;
end $$;

create trigger er_contact_message_after_insert after insert on er_contact_messages
  for each row execute function er_contact_message_after_insert();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table er_contact_threads enable row level security;
alter table er_contact_messages enable row level security;

create policy staff_read on er_contact_threads for select to authenticated
  using (organization_id in (select er_my_org_ids()));
create policy staff_update on er_contact_threads for update to authenticated
  using (er_has_org_role(organization_id, array['owner', 'manager', 'assistant', 'accountant']))
  with check (er_has_org_role(organization_id, array['owner', 'manager', 'assistant', 'accountant']));

create policy portal_own_read on er_contact_threads for select to authenticated
  using (created_by_user_id = er_current_user_id());
-- Portaalikäyttäjä aloittaa ketjun vain yhtiöön, johon hänellä on
-- portaalioikeus (ei palveluntuottajana), ja vain omaan huoneistoonsa.
create policy portal_insert on er_contact_threads for insert to authenticated
  with check (created_by_user_id = er_current_user_id()
              and status = 'open' and closed_at is null and closed_by is null
              and exists (select 1 from er_portal_access a
                           where a.user_id = er_current_user_id()
                             and a.company_id = er_contact_threads.company_id
                             and a.organization_id = er_contact_threads.organization_id
                             and a.role in ('owner', 'resident', 'board')
                             and a.starts_on <= current_date
                             and (a.ends_on is null or a.ends_on >= current_date))
              and (share_group_id is null
                   or exists (select 1 from er_portal_access a
                               where a.user_id = er_current_user_id()
                                 and a.share_group_id = er_contact_threads.share_group_id
                                 and a.company_id = er_contact_threads.company_id
                                 and a.role in ('owner', 'resident')
                                 and a.starts_on <= current_date
                                 and (a.ends_on is null or a.ends_on >= current_date))));

create policy staff_read on er_contact_messages for select to authenticated
  using (organization_id in (select er_my_org_ids()));
create policy staff_insert on er_contact_messages for insert to authenticated
  with check (from_staff
              and author_user_id = er_current_user_id()
              and er_has_org_role(organization_id, array['owner', 'manager', 'assistant', 'accountant'])
              and exists (select 1 from er_contact_threads t
                           where t.id = thread_id and t.organization_id = er_contact_messages.organization_id));

create policy portal_own_read on er_contact_messages for select to authenticated
  using (thread_id in (select id from er_contact_threads where created_by_user_id = er_current_user_id()));
create policy portal_insert on er_contact_messages for insert to authenticated
  with check (not from_staff
              and author_user_id = er_current_user_id()
              and exists (select 1 from er_contact_threads t
                           where t.id = thread_id
                             and t.created_by_user_id = er_current_user_id()
                             and t.organization_id = er_contact_messages.organization_id));

grant select, insert, update on er_contact_threads to authenticated;
grant select, insert on er_contact_messages to authenticated;
grant all on er_contact_threads, er_contact_messages to service_role;

-- ---------------------------------------------------------------------------
-- Liitteet ovat dokumentteja (subject_table = 'er_contact_threads'). Näkyvyys
-- 'internal', jolloin mikään yleinen portaalisääntö ei näytä niitä muille;
-- ketjun aloittaja näkee oman ketjunsa liitteet alla olevalla säännöllä.
-- ---------------------------------------------------------------------------
create policy portal_contact_attachment_read on er_documents for select to authenticated
  using (subject_table = 'er_contact_threads'
         and subject_id in (select id from er_contact_threads where created_by_user_id = er_current_user_id()));

create policy portal_contact_attachment_insert on er_documents for insert to authenticated
  with check (subject_table = 'er_contact_threads' and visibility = 'internal'
              and category in ('photo', 'other')
              and uploaded_by = er_current_user_id()
              and sealed = false
              and exists (select 1 from er_contact_threads t
                           where t.id = subject_id
                             and t.created_by_user_id = er_current_user_id()
                             and t.organization_id = er_documents.organization_id
                             and t.company_id = er_documents.company_id
                             and t.share_group_id is not distinct from er_documents.share_group_id));

-- ---------------------------------------------------------------------------
-- Sähköposti-ilmoitukset. Sisältöä ei kopioida viestiin.
-- Uusi viesti portaalista → yhtiön vastuuisännöitsijä (tai organisaation
-- omistajat ja isännöitsijät, jos vastuuhenkilöä ei ole).
-- Henkilökunnan vastaus → ketjun aloittaja.
-- ---------------------------------------------------------------------------
create or replace function er_notify_contact_message(p_message uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare
  m record;
  cnt integer := 0;
begin
  select cm.id, cm.from_staff, cm.author_user_id, t.id as thread_id, t.organization_id, t.subject, t.created_by_user_id,
         c.name as company_name, c.manager_user_id
    into m
    from er_contact_messages cm
    join er_contact_threads t on t.id = cm.thread_id
    join er_housing_companies c on c.id = t.company_id
   where cm.id = p_message;

  if m.id is null or er_current_user_id() is null or m.author_user_id is distinct from er_current_user_id() then
    raise exception 'viestiä ei löytynyt' using errcode = '42501';
  end if;

  if exists (select 1 from er_outbound_messages where subject_table = 'er_contact_messages' and subject_id = p_message) then
    return 0;
  end if;

  if m.from_staff then
    insert into er_outbound_messages (organization_id, channel, recipient, subject, body, subject_table, subject_id)
    select m.organization_id, 'email', u.email,
           'Vastaus yhteydenottoosi: ' || m.subject,
           'Isännöinti on vastannut yhteydenottoosi (' || m.company_name || E').\n\n'
             || 'Lue vastaus kirjautumalla eRapun asukasportaaliin kohtaan Yhteydenotot.',
           'er_contact_messages', p_message
      from er_users u
     where u.id = m.created_by_user_id and u.email is not null;
  else
    insert into er_outbound_messages (organization_id, channel, recipient, subject, body, subject_table, subject_id)
    select m.organization_id, 'email', u.email,
           'Uusi yhteydenotto: ' || m.company_name,
           'Portaalissa on uusi viesti yhteydenotossa "' || m.subject || '" (' || m.company_name || E').\n\n'
             || 'Viesti odottaa vastausta eRapun kohdassa Yhteydenotot.',
           'er_contact_messages', p_message
      from er_users u
     where u.email is not null
       and u.id in (
         select m.manager_user_id where m.manager_user_id is not null
         union
         select om.user_id from er_org_members om
          where m.manager_user_id is null and om.organization_id = m.organization_id and om.role in ('owner', 'manager'));
  end if;
  get diagnostics cnt = row_count;
  return cnt;
end $$;

revoke all on function er_notify_contact_message(uuid) from public;
grant execute on function er_notify_contact_message(uuid) to authenticated, service_role;
