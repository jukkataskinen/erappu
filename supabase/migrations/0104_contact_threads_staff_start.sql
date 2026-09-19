-- 0104 Henkilökunta voi aloittaa yhteydenoton portaalikäyttäjän kanssa.
--
-- Ketjun portaalipuolen osapuoli on participant_user_id. Portaalista
-- aloitetussa ketjussa se on aloittaja; henkilökunnan aloittamassa se on
-- valittu osakas, asukas tai hallituksen jäsen, jolla on portaalioikeus
-- yhtiöön (ja huoneistoon, jos ketju koskee huoneistoa).

alter table er_contact_threads
  add column participant_user_id uuid references er_users(id),
  add column started_by_staff boolean not null default false;
update er_contact_threads set participant_user_id = created_by_user_id where participant_user_id is null;
alter table er_contact_threads alter column participant_user_id set not null;
create index er_contact_threads_participant on er_contact_threads (participant_user_id, last_message_at desc);

-- Portaalin säännöt osapuolen mukaan.
drop policy portal_own_read on er_contact_threads;
create policy portal_own_read on er_contact_threads for select to authenticated
  using (participant_user_id = er_current_user_id());

drop policy portal_insert on er_contact_threads;
create policy portal_insert on er_contact_threads for insert to authenticated
  with check (created_by_user_id = er_current_user_id()
              and participant_user_id = er_current_user_id()
              and not started_by_staff
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

-- Henkilökunnan aloittama ketju: vastaanottajalla on oltava voimassa oleva
-- portaalioikeus yhtiöön (ja huoneistoon, jos ketju koskee huoneistoa).
create policy staff_insert on er_contact_threads for insert to authenticated
  with check (started_by_staff
              and created_by_user_id = er_current_user_id()
              and er_has_org_role(organization_id, array['owner', 'manager', 'assistant', 'accountant'])
              and company_id in (select id from er_housing_companies where organization_id = er_contact_threads.organization_id)
              and exists (select 1 from er_portal_access a
                           where a.user_id = er_contact_threads.participant_user_id
                             and a.company_id = er_contact_threads.company_id
                             and a.role in ('owner', 'resident', 'board')
                             and (er_contact_threads.share_group_id is null
                                  or a.share_group_id = er_contact_threads.share_group_id
                                  or a.role = 'board')
                             and a.starts_on <= current_date
                             and (a.ends_on is null or a.ends_on >= current_date)));

drop policy portal_own_read on er_contact_messages;
create policy portal_own_read on er_contact_messages for select to authenticated
  using (thread_id in (select id from er_contact_threads where participant_user_id = er_current_user_id()));
drop policy portal_insert on er_contact_messages;
create policy portal_insert on er_contact_messages for insert to authenticated
  with check (not from_staff
              and author_user_id = er_current_user_id()
              and exists (select 1 from er_contact_threads t
                           where t.id = thread_id
                             and t.participant_user_id = er_current_user_id()
                             and t.organization_id = er_contact_messages.organization_id));

drop policy portal_contact_attachment_read on er_documents;
create policy portal_contact_attachment_read on er_documents for select to authenticated
  using (subject_table = 'er_contact_threads'
         and subject_id in (select id from er_contact_threads where participant_user_id = er_current_user_id()));
drop policy portal_contact_attachment_insert on er_documents;
create policy portal_contact_attachment_insert on er_documents for insert to authenticated
  with check (subject_table = 'er_contact_threads' and visibility = 'internal'
              and category in ('photo', 'other')
              and uploaded_by = er_current_user_id()
              and sealed = false
              and exists (select 1 from er_contact_threads t
                           where t.id = subject_id
                             and t.participant_user_id = er_current_user_id()
                             and t.organization_id = er_documents.organization_id
                             and t.company_id = er_documents.company_id
                             and t.share_group_id is not distinct from er_documents.share_group_id));

-- Ilmoitukset: henkilökunnan viesti portaalin osapuolelle (uusi ketju tai
-- vastaus), portaalin viesti vastuuisännöitsijälle.
create or replace function er_notify_contact_message(p_message uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare
  m record;
  first_message boolean;
  cnt integer := 0;
begin
  select cm.id, cm.from_staff, cm.author_user_id, t.id as thread_id, t.organization_id, t.subject, t.participant_user_id, t.started_by_staff,
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

  select not exists (select 1 from er_contact_messages x where x.thread_id = m.thread_id and x.id <> p_message) into first_message;

  if m.from_staff then
    insert into er_outbound_messages (organization_id, channel, recipient, subject, body, subject_table, subject_id)
    select m.organization_id, 'email', u.email,
           case when first_message and m.started_by_staff then 'Viesti isännöinniltä: ' || m.subject else 'Vastaus yhteydenottoosi: ' || m.subject end,
           case when first_message and m.started_by_staff
             then 'Isännöinti on lähettänyt sinulle viestin (' || m.company_name || E').\n\n'
                  || 'Lue viesti ja vastaa kirjautumalla eRapun asukasportaaliin kohtaan Yhteydenotot.'
             else 'Isännöinti on vastannut yhteydenottoosi (' || m.company_name || E').\n\n'
                  || 'Lue vastaus kirjautumalla eRapun asukasportaaliin kohtaan Yhteydenotot.' end,
           'er_contact_messages', p_message
      from er_users u
     where u.id = m.participant_user_id and u.email is not null;
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
