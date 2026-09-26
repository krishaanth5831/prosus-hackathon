-- WF2 step 1 (plan §5.4). Opens JAMMED/SPOOF incidents after 2 consecutive bad aircraft checks, or on one
-- bad drone report (C12) from the last 60 min, re-arms MAY-LIFT incidents that go bad again, and returns
-- only the newly opened ones. A drone report older than the last close of that incident is not reused.
with last2 as (
  select o.*, row_number() over (partition by cell_id order by ts desc) rn
  from observations o where ts > now() - interval '12 minutes'
), jam as (
  select l.cell_id, 'JAMMED' as type,
    case when min(l.ratio) >= 0.5 then 'high' else 'medium' end as severity,
    max(case when rn = 1 then n_degraded end) || '/' || max(case when rn = 1 then n_total end)
      || ' aircraft degraded, 2 checks in a row' as evidence, 'ADS-B' as sensor
  from last2 l left join baselines b using (cell_id)
  where rn <= 2 and n_total >= 3 and ratio >= coalesce(b.threshold, 0.3)
  group by l.cell_id having count(*) = 2
), spoof as (
  select cell_id, 'SPOOF', 'high',
    max(case when rn = 1 then n_spoof end) || ' aircraft with GPS/baro altitude gap > 1500 ft, 2 checks in a row', 'ADS-B'
  from last2 where rn <= 2 and n_spoof >= 2
  group by cell_id having count(*) = 2
), drone as (
  select distinct on (d.cell_id, d.verdict) d.cell_id, d.verdict,
    case when d.verdict = 'SPOOF' or d.n_degraded >= 0.5 * d.n_samples then 'high' else 'medium' end,
    d.evidence, 'drone'
  from drone_reports d
  where d.ts > now() - interval '60 minutes' and d.verdict in ('JAMMED','SPOOF')
    and not exists (select 1 from incidents i
      where i.cell_id = d.cell_id and i.type = d.verdict and i.closed_at > d.received_at)
  order by d.cell_id, d.verdict, d.ts desc
), all_hits as (select * from jam union all select * from spoof union all select * from drone),
hits as (
  select cell_id, type,
    case when bool_or(severity = 'high') then 'high' else 'medium' end as severity,
    case when count(distinct sensor) = 2 then 'high (ADS-B + drone)'
         when min(sensor) = 'drone' then 'medium (drone only)' else 'medium (ADS-B only)' end as confidence,
    string_agg(evidence, '; ' order by sensor) as evidence
  from all_hits group by cell_id, type
), rearm as (
  update incidents i set status = 'open', may_lift_at = null
  from hits h where i.cell_id = h.cell_id and i.type = h.type and i.status = 'may_lift'
  returning i.id
)
insert into incidents (cell_id, type, status, severity, confidence, evidence)
select cell_id, type, 'open', severity, confidence, evidence from hits
on conflict (cell_id, type) where status <> 'closed' do nothing
returning *;
