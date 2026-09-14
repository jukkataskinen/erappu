-- 0041 Dokumenttipankin oikeuksien tarkennus.
--
-- 1) Poisto vain pääkäyttäjälle ja isännöitsijälle. Dokumentti voi olla
--    yhtiön ainoa kappale tilinpäätöksestä tai pöytäkirjasta, joten
--    kirjanpitäjä ja assistentti voivat lisätä ja muokata mutta eivät poistaa.
-- 2) Huoneistokohtainen dokumentti: 0003:n politiikka antoi asukkaalle
--    (vuokralaiselle) myös osakkaille tarkoitetut huoneiston dokumentit,
--    koska er_portal_share_group_ids() ei erottele roolia. Nyt osakas näkee
--    huoneistonsa owners- ja residents-dokumentit, asukas vain residents.

create or replace function er_portal_share_group_ids_for(roles text[]) returns setof uuid
language sql stable security definer set search_path = public as $$
  select share_group_id from er_portal_access
   where user_id = er_current_user_id()
     and share_group_id is not null
     and role = any(roles)
     and starts_on <= current_date
     and (ends_on is null or ends_on >= current_date)
$$;
grant execute on function er_portal_share_group_ids_for(text[]) to authenticated, service_role;

drop policy staff_write on er_documents;
create policy staff_insert on er_documents for insert to authenticated
  with check (er_has_org_role(organization_id, array['owner', 'manager', 'assistant', 'accountant']));
create policy staff_update on er_documents for update to authenticated
  using (er_has_org_role(organization_id, array['owner', 'manager', 'assistant', 'accountant']))
  with check (er_has_org_role(organization_id, array['owner', 'manager', 'assistant', 'accountant']));
create policy staff_delete on er_documents for delete to authenticated
  using (er_has_org_role(organization_id, array['owner', 'manager']));

drop policy portal_owner_docs on er_documents;
create policy portal_owner_docs on er_documents for select to authenticated
  using (visibility in ('owners', 'residents')
         and ((share_group_id is null and company_id in (select er_portal_company_ids(array['owner'])))
              or share_group_id in (select er_portal_share_group_ids_for(array['owner']))));

drop policy portal_resident_docs on er_documents;
create policy portal_resident_docs on er_documents for select to authenticated
  using (visibility = 'residents'
         and ((share_group_id is null and company_id in (select er_portal_company_ids(array['resident'])))
              or share_group_id in (select er_portal_share_group_ids_for(array['resident']))));

create index er_documents_org_created on er_documents (organization_id, created_at desc);
