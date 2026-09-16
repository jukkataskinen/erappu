-- 0099 Kokouksen asiasta isännöitsijän tehtävä (Jukka 17.9.2026).
-- Yhtiökokouksen tai hallituksen kokouksen asia voidaan viedä isännöitsijän
-- tehtävälistalle (er_tasks). Linkki estää saman asian viemisen kahdesti ja
-- näyttää asialistalla, että tehtävä on olemassa.
alter table er_meeting_items add column task_id uuid references er_tasks(id) on delete set null;
create index er_meeting_items_task on er_meeting_items (task_id) where task_id is not null;
