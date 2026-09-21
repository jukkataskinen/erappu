-- 0112 Kokouksen pykälän liitteet (Jukka 21.9.2026).
--
-- Hallituksen kokouksen ja yhtiökokouksen asialistan kohtaan liitetään
-- asiakirjoja, joita pykälässä käsitellään. Liite on tavallinen yhtiön
-- dokumentti (er_documents), joten se näkyy dokumenttipankissa ja sen
-- näkyvyys määrää, kuka sen voi avata. Tämä taulu vain kytkee dokumentin
-- pykälään ja järjestää pykälän liitteet.
--
-- Liitteen tunnus "Liite 3.1" lasketaan pykälän numerosta ja liitteen
-- järjestyksestä, eikä sitä tallenneta: kun asioiden järjestys muuttuu,
-- tunnukset seuraavat pykäliä.

create table er_meeting_item_attachments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references er_organizations(id),
  meeting_id uuid not null references er_meetings(id) on delete cascade,
  item_id uuid not null references er_meeting_items(id) on delete cascade,
  document_id uuid not null references er_documents(id) on delete cascade,
  position integer not null check (position >= 1),
  created_by uuid references er_users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (item_id, document_id)
);
create index er_meeting_item_attachments_item on er_meeting_item_attachments (item_id, position);
create index er_meeting_item_attachments_meeting on er_meeting_item_attachments (meeting_id);

alter table er_meeting_item_attachments enable row level security;
create policy staff_read on er_meeting_item_attachments for select to authenticated
  using (organization_id in (select er_my_org_ids()));
create policy staff_write on er_meeting_item_attachments for all to authenticated
  using (er_has_org_role(organization_id, array['owner', 'manager', 'assistant']))
  with check (er_has_org_role(organization_id, array['owner', 'manager', 'assistant']));
-- Liitteiden luettelo näkyy niille, jotka näkevät kokouksen (kuten asiat).
-- Itse tiedoston avaaminen noudattaa dokumentin omaa näkyvyyttä.
create policy portal_meeting_item_attachments on er_meeting_item_attachments for select to authenticated
  using (meeting_id in (select id from er_meetings));
grant select, insert, update, delete on er_meeting_item_attachments to authenticated;
grant all on er_meeting_item_attachments to service_role;
