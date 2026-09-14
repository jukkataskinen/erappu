-- 0070 M7 Kutsut ja asetukset: portaalikutsun osapuoli, kutsujen peruminen
-- ja viimeisen pääkäyttäjän suoja.
--
-- er_invitations (0001) oli vain sähköposti + rooli. Portaalikutsu liitetään
-- rekisterin osapuoleen (party_id), jotta hyväksyntä voi asettaa
-- er_parties.user_id:n ja johtaa portaalioikeudet rekisteristä. Kutsun
-- sähköposti on kutsun luontihetken osoite; hyväksyjän kirjautumisosoitteen on
-- vastattava sitä.

alter table er_invitations
  add column party_id uuid references er_parties(id) on delete cascade,
  add column company_id uuid references er_housing_companies(id) on delete cascade,
  add column revoked_at timestamptz,
  add column accepted_by uuid references er_users(id) on delete set null,
  add column last_sent_at timestamptz not null default now();

-- Henkilökuntakutsussa rooli on organisaatiorooli eikä osapuolta ole.
-- Portaalikutsussa rooli kertoo, mistä kutsu lähetettiin (omistaja, asukas,
-- hallitus); varsinaiset oikeudet johdetaan rekisteristä hyväksynnän jälkeen.
alter table er_invitations add constraint er_invitations_kind_shape check (
  (kind = 'staff' and role in ('owner', 'manager', 'accountant', 'assistant') and party_id is null)
  or (kind = 'portal' and role in ('owner', 'resident', 'board') and party_id is not null and company_id is not null)
);

create index er_invitations_org_open on er_invitations (organization_id, created_at desc)
  where accepted_at is null and revoked_at is null;
create index er_invitations_party on er_invitations (party_id) where party_id is not null;

-- Isännöitsijä saa kutsua henkilökuntaa, mutta pääkäyttäjäksi voi kutsua vain
-- pääkäyttäjä. Tarkistus on myös sovelluksessa; tämä rajoittava politiikka
-- estää kiertämisen, jos sovelluskoodista unohtuu ehto.
create policy invitations_owner_role_insert on er_invitations as restrictive for insert to authenticated
  with check (kind <> 'staff' or role <> 'owner' or er_has_org_role(organization_id, array['owner']));
create policy invitations_owner_role_update on er_invitations as restrictive for update to authenticated
  using (kind <> 'staff' or role <> 'owner' or er_has_org_role(organization_id, array['owner']))
  with check (kind <> 'staff' or role <> 'owner' or er_has_org_role(organization_id, array['owner']));

-- ---------------------------------------------------------------------------
-- Viimeistä pääkäyttäjää ei voi poistaa eikä alentaa. Muuten organisaatio
-- jäisi ilman ketään, joka voi hallita jäseniä (RLS: vain owner kirjoittaa
-- er_org_members-tauluun). Organisaation poisto (cascade) sallitaan.
-- ---------------------------------------------------------------------------
create or replace function er_protect_last_owner() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.role <> 'owner' then
    return coalesce(new, old);
  end if;
  if tg_op = 'UPDATE' and new.role = 'owner' and new.organization_id = old.organization_id then
    return new;
  end if;
  if not exists (select 1 from er_organizations where id = old.organization_id) then
    return coalesce(new, old);
  end if;
  if not exists (
    select 1 from er_org_members
     where organization_id = old.organization_id and role = 'owner' and user_id <> old.user_id
  ) then
    raise exception 'er_last_owner' using errcode = 'P0001', hint = 'Organisaatiossa on oltava vähintään yksi pääkäyttäjä.';
  end if;
  return coalesce(new, old);
end $$;

create trigger er_org_members_last_owner before update or delete on er_org_members
  for each row execute function er_protect_last_owner();
