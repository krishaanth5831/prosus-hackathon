-- all timestamps UTC. cell_id = lower-left corner in degrees, e.g. '56.5_21.0'
create table observations (
  id bigserial primary key,
  ts timestamptz not null,                 -- cycle time from the actor
  cell_id text not null,
  n_total int not null,                    -- aircraft that report NIC or NACp
  n_degraded int not null,                 -- nic < 7 or nac_p < 8
  ratio double precision not null,
  n_spoof int not null default 0,          -- |alt_geom - alt_baro| > 1500 ft
  source text not null
);
create index on observations (cell_id, ts desc);
create index on observations (ts desc);

create table incidents (
  id bigserial primary key,
  cell_id text not null,
  type text not null check (type in ('JAMMED','SPOOF')),
  status text not null check (status in ('open','may_lift','closed')),
  severity text not null check (severity in ('medium','high')),
  confidence text not null,
  evidence text not null,
  opened_at timestamptz not null default now(),
  may_lift_at timestamptz,
  closed_at timestamptz
);
create unique index one_live_incident on incidents (cell_id, type) where status <> 'closed';

create table decisions (
  id bigserial primary key,
  ts timestamptz not null default now(),
  key text not null unique,                -- sortie|incident|launch_at: each action happens once
  sortie_id text not null,
  incident_id bigint references incidents(id),
  level text not null,                     -- WATCH L1_RESCHEDULE L2_CANCEL L3_HOLD L4_SPOOF_HOLD BRAKE_HOLD UNVERIFIED
  batch text,                              -- incident id when the brake grouped it
  old_launch_at timestamptz, new_launch_at timestamptz,
  decided_by text not null,                -- 'agent' or 'human:<telegram name>'
  human_answer text,                       -- keep | launch | false_alarm
  reason text not null
);

create table agent_log (
  id bigserial primary key,
  ts timestamptz not null default now(),
  workflow text not null, action text not null, reason text not null, outcome text
);

create table baselines (
  cell_id text primary key,
  threshold double precision not null default 0.3,
  false_alarms int not null default 0
);

-- one row per cell: worst live incident, else UNKNOWN / NO_KNOWN_ISSUE. Stale data (>15 min) = UNKNOWN automatically.
create view cell_status with (security_invoker = on) as
with latest as (
  select distinct on (cell_id) cell_id, ts, n_total, n_degraded, ratio
  from observations where ts > now() - interval '15 minutes'
  order by cell_id, ts desc
), live as (
  select distinct on (cell_id) cell_id, id as incident_id, type, severity, evidence
  from incidents where status in ('open','may_lift')
  order by cell_id, (type = 'SPOOF') desc, opened_at desc
)
select cell_id, l.ts, l.n_total, l.n_degraded, l.ratio, v.incident_id, v.severity, v.evidence,
  case when v.type is not null then v.type
       when coalesce(l.n_total, 0) < 3 then 'UNKNOWN'
       else 'NO_KNOWN_ISSUE' end as state
from latest l full join live v using (cell_id);

-- map reads with the anon key: select only
alter table observations enable row level security;
alter table incidents    enable row level security;
alter table agent_log    enable row level security;
alter table decisions    enable row level security;
alter table baselines    enable row level security;
create policy "public read" on observations for select using (true);
create policy "public read" on incidents    for select using (true);
create policy "public read" on agent_log    for select using (true);
grant select on cell_status to anon;
