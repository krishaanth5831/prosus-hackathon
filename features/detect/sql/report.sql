-- WF5 morning report: one row covering the last 24 h.
-- resolution_rate = what the agent resolved on its own (reroute, reschedule, cancel, HOLD by the agent) / every action
-- (those + L3 + L4 + BRAKE, the HOLDs that ask a human), counting only decisions tied to an incident.
-- WATCH and UNVERIFIED are not actions, so they are counted per level but left out of the rate.
with d as (
  select * from decisions where ts > now() - interval '24 hours'
), acted as (
  select count(*) filter (where level in ('L1_REROUTE','L1_RESCHEDULE','L2_CANCEL','L3_AUTO_HOLD')) as auto,
         count(*) filter (where level in ('L1_REROUTE','L1_RESCHEDULE','L2_CANCEL','L3_AUTO_HOLD','L3_HOLD','L4_SPOOF_HOLD','BRAKE_HOLD')) as total
  from d where incident_id is not null
)
select
  (select count(*) from incidents where opened_at > now() - interval '24 hours') as incidents_opened,
  (select string_agg(type || ' ' || cell_id || ' (' || severity || ')', ', ' order by opened_at)
     from incidents where opened_at > now() - interval '24 hours') as incidents_list,
  (select count(*) from incidents where status in ('open','may_lift')) as incidents_live,
  (select coalesce(jsonb_object_agg(level, n), '{}'::jsonb)
     from (select level, count(*) n from d group by level) x) as per_level,
  a.auto as resolved_by_agent,
  a.total as acted_on,
  case when a.total > 0 then round(100.0 * a.auto / a.total) end as resolution_rate_pct,
  (select count(*) from agent_log where ts > now() - interval '24 hours'
     and (action like 'SWITCH SOURCE%' or reason ilike '%switched to%')) as failovers,
  (select count(*) from decisions
     where level in ('L3_HOLD','L4_SPOOF_HOLD','BRAKE_HOLD') and human_answer is null) as pending_holds,
  (select string_agg(distinct sortie_id, ', ') from decisions
     where level in ('L3_HOLD','L4_SPOOF_HOLD','BRAKE_HOLD') and human_answer is null) as pending_hold_sorties,
  to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as generated_at
from acted a;
