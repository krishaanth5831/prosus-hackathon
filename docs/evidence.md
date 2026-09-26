# Evidence checklist

Owner: Person C. Every shot in `docs/video-script.md` comes from one of these entries. Each one has the exact query or screen, and the file it gets saved to. Run the SQL in the Supabase **SQL editor** (or `psql "$SUPABASE_DB_URL"`). Times are UTC in the database. Convert with `at time zone 'Europe/Amsterdam'` only for captions.

Test data never goes into evidence: exclude cells `89.5_*` and sorties `T-*`.

## E1 Best real incident (ideally overnight, with decisions)

```sql
select i.id, i.cell_id, i.type, i.severity, i.evidence,
       i.opened_at, i.opened_at at time zone 'Europe/Amsterdam' as opened_local,
       i.may_lift_at, i.closed_at,
       count(d.id) filter (where d.level <> 'WATCH') as acted, count(d.id) as decisions
from incidents i left join decisions d on d.incident_id = i.id
where i.cell_id not like '89.5\_%'
group by i.id
order by acted desc, (extract(hour from i.opened_at at time zone 'Europe/Amsterdam') between 0 and 6) desc,
         i.severity desc, i.opened_at
limit 5;
```

Then the full GNSS picture around it (`features/detect/sql/investigate.sql`):

```sql
-- replace the two values; same query as investigate.sql
\set cell '''54.5_20.5'''
\set t '''2026-09-27T02:10:00Z'''
select 'observation' kind, ts, n_degraded || '/' || n_total || ' degraded, ' || source as detail
from observations where cell_id = :cell and ts between :t::timestamptz - interval '1 hour' and :t::timestamptz + interval '1 hour'
order by ts;
```

- [ ] Screenshot of the result → `features/detect/evidence/e1-incident.png`
- [ ] Query output pasted into `features/detect/evidence/e1-incident.md`

## E2 What the agent did about it, in order

```sql
select ts, workflow, action, reason, outcome from agent_log
where ts between '{opened_at}'::timestamptz - interval '10 minutes' and '{opened_at}'::timestamptz + interval '3 hours'
  and (reason like '%{cell_id}%' or action like 'SWITCH SOURCE%')
order by ts;

select ts, sortie_id, level, old_launch_at, new_launch_at, decided_by, human_answer, reason
from decisions where incident_id = {incident_id} order by ts;
```

Detection → decision latency (PRD target: same 5-min cycle):

```sql
select i.id, i.opened_at, min(d.ts) as first_decision, min(d.ts) - i.opened_at as latency
from incidents i join decisions d on d.incident_id = i.id where i.id = {incident_id} group by i.id;
```

- [ ] `agent_log` screenshot → `features/detect/evidence/e2-log.png`
- [ ] Sheet rows showing RESCHEDULED / CANCELLED / HOLD with `decided_by = agent` → `features/gate/evidence/e2-sheet.png`

## E3 A Telegram tap (human gate)

```sql
select ts, sortie_id, level, decided_by, human_answer, reason from decisions
where human_answer is not null and sortie_id not like 'T-%' order by ts desc limit 5;
select ts, action, reason, outcome from agent_log where workflow = 'WF6' order by ts desc limit 5;
```

- [ ] Phone screen recording: card arrives → tap → message edits to show the outcome → `features/gate/evidence/e3-tap.mp4` (kept out of git: `*.mp4` is ignored, so upload it to the video folder)
- [ ] Still of the card before and after → `features/gate/evidence/e3-card.png`
- [ ] A tap from a non-allowlisted account refused (`agent_log` line) → `features/gate/evidence/e3-refused.png`

## E4 Failover

```sql
select ts, ts at time zone 'Europe/Amsterdam' as local, action, reason, outcome
from agent_log where action like 'SWITCH SOURCE%' order by ts desc;
```

- [ ] Screenshot → `features/collect/evidence/e4-failover.png` (A7 already saves the raw proof)

## E5 Stale data alarm (map goes grey)

```sql
select ts, workflow, action, reason, outcome from agent_log
where workflow = 'WF4' and (reason ilike '%stale%' or reason ilike '%fresh again%') order by ts;
```

- [ ] Telegram stale alarm on the phone → `features/collect/evidence/e5-stale.png`
- [ ] Map during the gap: banner "No fresh sensor data: every cell is UNKNOWN" → `features/detect/evidence/e5-map-stale.png`

## E6 Morning report

```sql
select ts, reason from agent_log where action = 'SEND MORNING REPORT' order by ts desc limit 1;
```

Numbers behind it: run `features/detect/sql/report.sql` as-is.

- [ ] The 07:00 Telegram message on the phone → `features/detect/evidence/e6-report.png`
- [ ] `report.sql` output → `features/detect/evidence/e6-report.md`

## E7 The map

URL: https://airguard-map.vercel.app

- [ ] Live map with at least one red cell, on the phone, from the Vercel URL → `features/detect/evidence/e7-map-phone.png`
- [ ] Desktop view with the log panel → `features/detect/evidence/e7-map.png`

Headline number for the opening line (latest cycle):

```sql
select ts, sum(n_degraded) degraded, sum(n_total) total from observations
where ts = (select max(ts) from observations) group by ts;
```

## E8 It ran unattended (PRD §3 metrics)

```sql
-- uptime: expect 12 cycles per hour
select date_trunc('hour', ts) as hour, count(distinct ts) as cycles
from observations where ts > now() - interval '14 hours' group by 1 order by 1;

-- wrong auto-actions: must be 0 (the agent never answered a card itself, never approved a launch)
select count(*) from decisions where decided_by = 'agent' and human_answer is not null;
```

- [ ] n8n **Executions** list filtered to the night window → `features/detect/evidence/e8-executions.png`
- [ ] Both query outputs → `features/detect/evidence/e8-unattended.md`

## Before recording

- [ ] Test rows gone: `select count(*) from observations where cell_id like '89.5\_%'` returns 0, and there are no `T-*` rows in the sheet.
- [ ] Every screenshot shows a UTC timestamp.
- [ ] No green anywhere on screen.
