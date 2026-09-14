-- 0021 Muutostyöilmoituksen ilmoitus vastuuisännöitsijälle.
--
-- Osakas tekee ilmoituksen portaalissa omalla RLS-roolillaan, eikä hän näe
-- isännöitsijän sähköpostiosoitetta eikä voi kirjoittaa viestijonoon. Tämä
-- funktio lisää viestin jonoon samassa transaktiossa kuin ilmoitus, jotta
-- ilmoitus ja viesti eivät voi erota. Funktio sallii vain ilmoituksen
-- tekijän oman ilmoituksen, lisää viestin kerran, eikä viestiin tule
-- osakkaan henkilötietoja (vain yhtiö ja huoneisto).

create or replace function er_notify_renovation_notice(p_notice uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare
  n record;
  cnt integer := 0;
begin
  select rn.id, rn.organization_id, rn.submitted_by_user_id, c.name as company_name, c.manager_user_id, g.unit_label
    into n
    from er_renovation_notices rn
    join er_housing_companies c on c.id = rn.company_id
    join er_share_groups g on g.id = rn.share_group_id
   where rn.id = p_notice;

  if n.id is null or er_current_user_id() is null or n.submitted_by_user_id is distinct from er_current_user_id() then
    raise exception 'muutostyöilmoitusta ei löytynyt' using errcode = '42501';
  end if;

  if exists (select 1 from er_outbound_messages where subject_table = 'er_renovation_notices' and subject_id = p_notice) then
    return 0;
  end if;

  insert into er_outbound_messages (organization_id, channel, recipient, subject, body, subject_table, subject_id)
  select n.organization_id, 'email', u.email,
         'Uusi muutostyöilmoitus: ' || n.company_name || ', ' || n.unit_label,
         'Osakas on tehnyt muutostyöilmoituksen huoneistosta ' || n.unit_label || ' (' || n.company_name || E').\n\n'
           || 'Ilmoitus odottaa käsittelyä eRapussa taloyhtiön Korjaukset-välilehdellä. '
           || 'Asunto-osakeyhtiölain mukaan yhtiön on käsiteltävä ilmoitus kohtuullisessa ajassa.',
         'er_renovation_notices', p_notice
    from er_users u
   where u.id in (
     select n.manager_user_id where n.manager_user_id is not null
     union
     select m.user_id from er_org_members m
      where n.manager_user_id is null and m.organization_id = n.organization_id and m.role in ('owner', 'manager'));
  get diagnostics cnt = row_count;
  return cnt;
end $$;

revoke all on function er_notify_renovation_notice(uuid) from public;
grant execute on function er_notify_renovation_notice(uuid) to authenticated, service_role;
