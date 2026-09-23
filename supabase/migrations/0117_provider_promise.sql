-- Palveluntuottajan lupaus: mihin päivään mennessä työ on viimeistään tehty.
-- Kysytään tehtävälinkissä vastaanottokuittauksen yhteydessä, ja sama päivä
-- näytetään isännöinnille, ilmoittajalle ja hallitukselle (Jukka 23.9.2026).
alter table er_service_requests add column provider_promised_on date;

-- Guard-funktio kirjoitetaan kokonaan uudelleen (alkuperäinen 0010): lupaus
-- nollataan samoissa kohdissa kuin kuittaus, eli portaalista tulevassa
-- pyynnössä ja uudelleenavauksessa.
create or replace function er_service_requests_guard() returns trigger
language plpgsql set search_path = public as $$
declare
  v_org uuid;
  v_trusted boolean := current_user not in ('authenticated', 'anon');
  v_writer boolean;
begin
  select organization_id into v_org from er_housing_companies where id = new.company_id;
  if v_org is null then
    raise exception 'service request: unknown company' using errcode = '23503';
  end if;
  v_writer := er_has_org_role(v_org, array['owner', 'manager', 'assistant']);

  if tg_op = 'UPDATE' and v_org <> old.organization_id then
    raise exception 'service request: organization cannot change' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and not v_trusted and not v_writer then
    -- Kirjanpitäjä saa kirjata vain kustannuksen.
    if (to_jsonb(new) - array['cost_eur', 'cost_responsibility', 'updated_at'])
       is distinct from (to_jsonb(old) - array['cost_eur', 'cost_responsibility', 'updated_at']) then
      raise exception 'service request: only cost fields may be changed' using errcode = '42501';
    end if;
  end if;

  new.organization_id := v_org;

  if tg_op = 'INSERT' and not v_trusted and not v_writer then
    -- Portaalista tuleva pyyntö: käsittelytiedot kuuluvat henkilökunnalle.
    new.status := 'new';
    new.source := 'portal';
    new.reporter_user_id := er_current_user_id();
    new.assignee_user_id := null;
    new.provider_id := null;
    new.due_on := null;
    new.cost_eur := null;
    new.cost_responsibility := 'unclear';
    new.ordered_at := null;
    new.provider_acknowledged_at := null;
    new.provider_promised_on := null;
  end if;

  if new.share_group_id is not null
     and (tg_op = 'INSERT' or new.share_group_id is distinct from old.share_group_id)
     and not exists (select 1 from er_share_groups where id = new.share_group_id and company_id = new.company_id) then
    raise exception 'service request: share group does not belong to company' using errcode = '23503';
  end if;
  if new.provider_id is not null
     and (tg_op = 'INSERT' or new.provider_id is distinct from old.provider_id)
     and not exists (select 1 from er_service_providers where id = new.provider_id and organization_id = v_org) then
    raise exception 'service request: unknown provider' using errcode = '23503';
  end if;
  if new.assignee_user_id is not null
     and (tg_op = 'INSERT' or new.assignee_user_id is distinct from old.assignee_user_id)
     and not exists (select 1 from er_org_members where organization_id = v_org and user_id = new.assignee_user_id) then
    raise exception 'service request: assignee is not staff' using errcode = '23503';
  end if;

  if tg_op = 'INSERT' then
    new.number := er_next_service_request_number(v_org);
    new.created_at := now();
    new.updated_at := now();
    new.reopened_count := 0;
    new.completed_at := case when new.status in ('done', 'closed') then now() end;
    new.closed_at := case when new.status in ('closed', 'rejected') then now() end;
    return new;
  end if;

  new.number := old.number;
  new.created_at := old.created_at;
  new.source := old.source;
  new.reporter_user_id := old.reporter_user_id;
  new.updated_at := now();

  if new.status is distinct from old.status then
    if old.status in ('done', 'closed', 'rejected') and new.status not in ('done', 'closed', 'rejected') then
      new.reopened_count := old.reopened_count + 1;
      new.completed_at := null;
      new.closed_at := null;
      new.provider_acknowledged_at := null;
      new.provider_promised_on := null;
    else
      new.reopened_count := old.reopened_count;
    end if;
    if new.status = 'done' then new.completed_at := coalesce(new.completed_at, now()); end if;
    if new.status in ('closed', 'rejected') then
      new.closed_at := now();
      if new.status = 'closed' then new.completed_at := coalesce(new.completed_at, now()); end if;
    end if;
  else
    new.reopened_count := old.reopened_count;
  end if;
  return new;
end $$;
