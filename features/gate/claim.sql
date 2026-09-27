-- WF6 node "Claim" (plan §6 WF6). One statement, so a tap lands completely or not at all.
-- 1. Answer the tapped HOLD (or every unanswered HOLD of a brake batch): decisions.human_answer, once only.
--    Nothing claimed = the card was already answered, and nothing else happens.
-- 2. False alarm: raise the cell's threshold by 0.05 (max 0.6) and close the incident with a note, once per incident.
-- Parameters: $1 answer (keep | launch | cancel | false_alarm, the last only from older cards) · $2 mode (single | batch | none) · $3 decision id
--             $4 sortie id · $5 incident id (batch) · $6 officer name. One row per claimed decision.
with claimed as (
  update decisions set human_answer = $1
  where human_answer is null and level in ('L3_HOLD', 'L4_SPOOF_HOLD', 'BRAKE_HOLD')
    and (($2 = 'single' and id = $3::bigint and sortie_id = $4) or ($2 = 'batch' and batch = $5))
  returning *
), inc as (
  select distinct i.id, i.cell_id, i.status from incidents i join claimed c on c.incident_id = i.id
), hit as (
  select * from inc where $1 = 'false_alarm' and status <> 'closed'
), raised as (
  insert into baselines (cell_id, threshold, false_alarms)
  select distinct cell_id, 0.35, 1 from hit
  on conflict (cell_id) do update
    set threshold = least(round((baselines.threshold + 0.05)::numeric, 2), 0.6), false_alarms = baselines.false_alarms + 1
  returning cell_id, threshold
), closed as (
  update incidents i set status = 'closed', closed_at = now(), evidence = i.evidence || ' [false alarm: ' || $6 || ']'
  from hit where i.id = hit.id
  returning i.id
)
select c.id, c.sortie_id, c.level, c.incident_id, c.batch, c.reason, c.human_answer,
  inc.cell_id, r.threshold as new_threshold, c.incident_id in (select id from closed) as closed_now
from claimed c left join inc on inc.id = c.incident_id left join raised r on r.cell_id = inc.cell_id
order by c.id;
