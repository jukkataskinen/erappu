-- 0110 Kuva vesimittarista portaalista.
--
-- Osakas tai asukas voi liittää ilmoittamaansa lukemaan kuvan mittarista.
-- Kuva on dokumentti (subject_table = 'er_water_readings'), näkyvyys
-- sisäinen: ilmoittaja näkee omansa, henkilökunta organisaationsa kuvat.

create policy portal_water_photo_insert on er_documents for insert to authenticated
  with check (subject_table = 'er_water_readings' and visibility = 'internal'
              and category = 'photo'
              and uploaded_by = er_current_user_id()
              and sealed = false
              and exists (select 1 from er_water_readings r join er_water_meters m on m.id = r.meter_id
                           where r.id = subject_id
                             and r.source = 'portal'
                             and r.entered_by = er_current_user_id()
                             and m.organization_id = er_documents.organization_id
                             and m.company_id = er_documents.company_id
                             and m.share_group_id is not distinct from er_documents.share_group_id));

create policy portal_water_photo_read on er_documents for select to authenticated
  using (subject_table = 'er_water_readings' and uploaded_by = er_current_user_id());
