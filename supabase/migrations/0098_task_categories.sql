-- 0098 Vuosikellon luokat hallituksen kokouksille ja asukasviestinnälle
-- (Jukan vuosikellomalli 17.9.2026).
do $$
declare
  c record;
begin
  for c in
    select conname from pg_constraint
     where conrelid = 'er_tasks'::regclass and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%category%'
  loop
    execute format('alter table er_tasks drop constraint %I', c.conname);
  end loop;
end $$;

alter table er_tasks add constraint er_tasks_category_check check (category in (
  'financial_statement', 'general_meeting', 'board_meeting', 'communication', 'htj_update', 'insurance', 'maintenance', 'safety', 'contract', 'other'));
