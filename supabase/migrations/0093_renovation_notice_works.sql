-- 0093 Muutostyöilmoituksen työrivit, työnsuorittajat, liitteet ja kuittaukset.
--
-- Yksi muutostyöilmoitus koskee käytännössä useaa työtä: kylpyhuoneen
-- vedeneristys, sähkötyöt ja ilmanvaihdon muutos ovat eri työlajeja, eri
-- tekijöitä ja eri aikatauluja, mutta osakas tekee niistä yhden ilmoituksen.
-- Siksi työt siirtyvät omaksi tauluksi ja ilmoitukselle jää yhteenveto,
-- käsittelyn tila ja päätös.
--
-- Vanhat sarakkeet (description, work_type, planned_start, planned_end)
-- jäävät paikalleen, jotta vanhat rivit eivät menetä tietoa ja rollback on
-- mahdollinen. Lukukyselyt käyttävät tästä eteenpäin työrivejä, ja jokaisesta
-- vanhasta ilmoituksesta tehdään alla yksi työrivi.

create table er_renovation_notice_works (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references er_organizations(id),
  notice_id uuid not null references er_renovation_notices(id) on delete cascade,
  -- Järjestysnumero lomakkeella. Yläraja pitää yhden ilmoituksen luettavana.
  sort_order smallint not null default 1 check (sort_order between 1 and 20),
  work_type text not null check (char_length(work_type) <= 100),
  description text not null check (char_length(description) <= 2000),
  planned_start date,
  planned_end date,
  -- Kuka työn tekee. 'shareholder' = osakas itse, 'contractor' = urakoitsija,
  -- 'unknown' = vanha ilmoitus, jossa tietoa ei kysytty.
  contractor_kind text not null default 'unknown' check (contractor_kind in ('shareholder', 'contractor', 'unknown')),
  contractor_name text check (contractor_name is null or char_length(contractor_name) <= 200),
  contractor_business_id text check (contractor_business_id is null or char_length(contractor_business_id) <= 20),
  contractor_contact text check (contractor_contact is null or char_length(contractor_contact) <= 200),
  -- Pätevyys vapaana tekstinä: sertifikaattien nimet vaihtelevat työlajeittain
  -- (VTT-sertifioitu vedeneristäjä, sähköpätevyys S1, KVV-työnjohtaja).
  contractor_qualification text check (contractor_qualification is null or char_length(contractor_qualification) <= 500),
  maintenance_work_id uuid references er_maintenance_works(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (notice_id, sort_order),
  check (planned_end is null or planned_start is null or planned_end >= planned_start),
  check (contractor_kind <> 'contractor' or contractor_name is not null)
);
create index er_renovation_notice_works_notice on er_renovation_notice_works (notice_id, sort_order);

-- Ilmoituksen omat lisäykset: muutostyöohjeen kuittaus ja ilmoitustapa.
-- Kuittaus on todiste siitä, että osakas on saanut yhtiön ohjeen ennen työn
-- aloittamista; talletetaan aika ja se ohjeen versio (dokumentti), joka
-- lomakkeella näytettiin.
alter table er_renovation_notices add column guide_acknowledged_at timestamptz;
alter table er_renovation_notices add column guide_document_id uuid references er_documents(id) on delete set null;
-- Ilmoitustapa tilamuutoksista. Tekstiviesti on toistaiseksi vain osakkaan
-- valinta: kanavaa ei ole (BLOCKERS 7), joten viestit lähtevät sähköpostina.
alter table er_renovation_notices add column notify_email boolean not null default true;
alter table er_renovation_notices add column notify_sms boolean not null default false;

-- ---------------------------------------------------------------------------
-- Dokumenttiluokka: yhtiön muutostyöohje
-- ---------------------------------------------------------------------------
do $$
declare
  c record;
begin
  for c in
    select conname from pg_constraint
     where conrelid = 'er_documents'::regclass and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%category%'
  loop
    execute format('alter table er_documents drop constraint %I', c.conname);
  end loop;
end $$;

alter table er_documents add constraint er_documents_category_check check (category in (
  'articles', 'financial_statement', 'budget', 'energy_certificate', 'floor_plan',
  'minutes', 'meeting_notice', 'contract', 'condition_assessment', 'maintenance_plan', 'maintenance_needs_report',
  'manager_certificate', 'rescue_plan', 'renovation_guide', 'photo', 'insurance', 'other'));

-- ---------------------------------------------------------------------------
-- Vanhat ilmoitukset työriveiksi. Tieto ei muutu eikä katoa: yhden työn
-- ilmoituksesta tulee yksi rivi, työnsuorittaja jää tuntemattomaksi.
-- ---------------------------------------------------------------------------
insert into er_renovation_notice_works
  (organization_id, notice_id, sort_order, work_type, description, planned_start, planned_end, contractor_kind, maintenance_work_id, created_at)
select n.organization_id, n.id, 1, coalesce(nullif(n.work_type, ''), 'Muu'), left(n.description, 2000),
       n.planned_start,
       -- Vanhassa rivissä päivät saattoivat olla väärin päin; työrivin
       -- tarkistus ei saa estää migraatiota.
       case when n.planned_end is not null and n.planned_start is not null and n.planned_end < n.planned_start then null else n.planned_end end,
       'unknown', n.maintenance_work_id, n.created_at
  from er_renovation_notices n;

-- ---------------------------------------------------------------------------
-- RLS: työrivit näkyvät samoille kuin ilmoitus. Henkilökunta lukee koko
-- organisaation ja kirjoittaa rooleillaan; osakas näkee ja lisää oman
-- ilmoituksensa rivit; hallitus lukee yhtiön ilmoitusten rivit.
-- ---------------------------------------------------------------------------
alter table er_renovation_notice_works enable row level security;

create policy staff_read on er_renovation_notice_works for select to authenticated
  using (organization_id in (select er_my_org_ids()));
create policy staff_write on er_renovation_notice_works for all to authenticated
  using (er_has_org_role(organization_id, array['owner', 'manager', 'assistant', 'accountant']))
  with check (er_has_org_role(organization_id, array['owner', 'manager', 'assistant', 'accountant']));

create policy portal_board_works on er_renovation_notice_works for select to authenticated
  using (notice_id in (select id from er_renovation_notices
                        where company_id in (select er_portal_company_ids(array['board']))));
create policy portal_own_works on er_renovation_notice_works for select to authenticated
  using (notice_id in (select id from er_renovation_notices
                        where share_group_id in (select er_portal_share_group_ids())));
-- Lisäys vain oman ilmoituksen riveille ja vain ilmoituksen organisaatioon.
create policy portal_submit_works on er_renovation_notice_works for insert to authenticated
  with check (exists (select 1 from er_renovation_notices n
                       where n.id = notice_id
                         and n.submitted_by_user_id = er_current_user_id()
                         and n.organization_id = er_renovation_notice_works.organization_id)
              and maintenance_work_id is null);

grant select, insert, update, delete on er_renovation_notice_works to authenticated;
grant all on er_renovation_notice_works to service_role;

-- Osakas saa liittää kuittaukseen vain oman organisaationsa ohjeen, jonka hän
-- näkee (er_documents-kyselyyn pätee RLS).
drop policy portal_submit_notice on er_renovation_notices;
create policy portal_submit_notice on er_renovation_notices for insert to authenticated
  with check (submitted_by_user_id = er_current_user_id()
              and share_group_id in (select share_group_id from er_portal_access
                                      where user_id = er_current_user_id() and role = 'owner'
                                        and (ends_on is null or ends_on >= current_date))
              and (guide_document_id is null
                   or guide_document_id in (select id from er_documents
                                             where organization_id = er_renovation_notices.organization_id
                                               and category = 'renovation_guide')));

-- ---------------------------------------------------------------------------
-- Ilmoituksen liitteet ovat dokumentteja (subject_table = 'er_renovation_notices').
-- Näkyvyys 'owners' + huoneisto: huoneiston osakas, hallitus ja henkilökunta
-- näkevät liitteen, muut osakkaat eivät (0041 portal_owner_docs rajaa
-- huoneistoon). Osakas saa liittää vain omaan ilmoitukseensa.
-- ---------------------------------------------------------------------------
create policy portal_renovation_attachment_insert on er_documents for insert to authenticated
  with check (subject_table = 'er_renovation_notices' and visibility = 'owners'
              and category in ('photo', 'other')
              and uploaded_by = er_current_user_id()
              and sealed = false
              and exists (select 1 from er_renovation_notices n
                           where n.id = subject_id
                             and n.submitted_by_user_id = er_current_user_id()
                             and n.organization_id = er_documents.organization_id
                             and n.company_id = er_documents.company_id
                             and n.share_group_id = er_documents.share_group_id));
