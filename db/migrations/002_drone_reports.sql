-- 002: drone GNSS reports (contract C12), a second sensor for cells aircraft don't cover.
-- One row per leg of a drone's planned route, written by WF7. cell_id is the PLANNED cell of that leg,
-- never the drone's own GPS position (a spoofed drone reports the wrong place).
create table drone_reports (
  id bigserial primary key,
  ts timestamptz not null,                 -- last sample of the leg (UTC)
  received_at timestamptz not null default now(),
  cell_id text not null,
  sortie_id text not null,
  drone_id text not null,
  n_samples int not null,
  n_degraded int not null,                 -- fix_type < 3, h_acc > 10 m or receiver jamming flag
  n_spoof int not null,                    -- receiver spoofing flag
  verdict text not null check (verdict in ('JAMMED','SPOOF','NORMAL')),
  evidence text not null,
  source text not null                     -- 'sim:...' = simulated, shown as SIMULATED
);
create index on drone_reports (cell_id, ts desc);

alter table drone_reports enable row level security;
create policy "public read" on drone_reports for select using (true);

-- cell_status gains two columns at the end (C4 columns unchanged). A drone report counts for 60 min.
-- Bad news counts more than good news: a JAMMED/SPOOF report opens an incident through detect.sql;
-- a NORMAL report only lifts a cell with too few aircraft from UNKNOWN to NO_KNOWN_ISSUE, never an incident.
create or replace view cell_status with (security_invoker = on) as
with latest as (
  select distinct on (cell_id) cell_id, ts, n_total, n_degraded, ratio
  from observations where ts > now() - interval '15 minutes'
  order by cell_id, ts desc
), live as (
  select distinct on (cell_id) cell_id, id as incident_id, type, severity, evidence
  from incidents where status in ('open','may_lift')
  order by cell_id, (type = 'SPOOF') desc, opened_at desc
), drone as (
  select distinct on (cell_id) cell_id, ts as drone_ts, verdict, evidence as drone_evidence
  from drone_reports where ts > now() - interval '60 minutes'
  order by cell_id, ts desc
)
select cell_id, l.ts, l.n_total, l.n_degraded, l.ratio, v.incident_id, v.severity, v.evidence,
  case when v.type is not null then v.type
       when coalesce(l.n_total, 0) >= 3 then 'NO_KNOWN_ISSUE'
       when d.verdict = 'NORMAL' then 'NO_KNOWN_ISSUE'
       else 'UNKNOWN' end as state,
  d.drone_ts, d.drone_evidence
from latest l full join live v using (cell_id) full join drone d using (cell_id);
