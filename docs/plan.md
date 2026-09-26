---
type: build-plan
date: 2026-09-26
status: active
tags: [build, repo, n8n, apify, supabase, telegram]
---

# Build plan: AirGuard

What and why: (C) PRD — AirGuard · Research: 00 Research/JamWatch — GPS Jamming Early Warning (Build Weekend 26) · Team split: (C) Team Split — 3 Parallel Claude Code Prompts

---

## 1. Architecture

```
 adsb.lol ──┐ (fallback adsb.fi)
            ▼
 ┌─ APIFY ───────────────────────┐  webhook RUN.SUCCEEDED ──► n8n WF1
 │ adsb-collector  (every 5 min) │  webhook RUN.FAILED    ──► n8n WF4
 │ notam-scraper   (Should)      │
 └───────────────────────────────┘
 ┌─ n8n Cloud ──────────────────────────────────────────────────────────┐
 │ WF1 Collect ─► WF2 Detect ─► WF3 Gate ──► Telegram card (3 buttons)  │
 │                                              │                       │
 │ WF6 Respond ◄── Telegram Trigger (button tap)┘                       │
 │ WF4 Heal (Error Trigger + Apify failure + stale watchdog)            │
 │ WF5 Report (07:00)                                                   │
 └──────────┬───────────────────────────────┬───────────────────────────┘
            ▼                               ▼
   Supabase Postgres                  Google Sheet "AirGuard Sorties"
   observations, incidents,           (the unit's sortie plan: status,
   decisions, agent_log, baselines     launch, decided_by, note)
            ▲ read-only (RLS)
   Leaflet map on Vercel
```

**Three rules the architecture enforces:**
1. **Collection happens only in Apify, logic only in n8n.** This keeps both visible for the 20% criterion.
2. **Decisions are made in SQL and in pure JS Code nodes, never by the LLM.** The LLM only phrases the briefing on a card.
3. **The gate is state-based, not event-based.** Every cycle, it compares all upcoming sorties with the current cell picture. A `decisions.key` makes each action happen exactly once. Late-added and rescheduled sorties are therefore never missed.

## 2. Stack and accounts

| Piece | Service | Why this one | Set up |
|---|---|---|---|
| Collection | Apify (free plan) | 20% criterion. Schedules and webhooks built in | Actor, schedule, 2 webhooks |
| Orchestration | n8n Cloud (TZ Europe/Amsterdam) | Hosted 24/7, Error Trigger, Telegram nodes | 6 workflows, credentials |
| Storage | Supabase Postgres (free) | SQL for detection, RLS for the public map | Run `001_init.sql` |
| Sortie plan | Google Sheet | Judges read it at a glance; stands in for the unit's planner | Import `sorties.demo.csv` |
| Human gate | Telegram bot | Buttons on the phone; works at 3am | BotFather token, your user ID |
| Briefing text | LLM node in n8n (any provider) | Phrasing only. Template fallback if it fails | 1 credential |
| Map | Leaflet on Vercel | One static file | Deploy `features/map/` |
| Code | GitHub `krishaanth5831/prosus-hackathon` | Proof, backup, clean README for judges | See §3 |

**Credentials go in n8n and Apify only.** Env names are in `.env.example`, never values.

## 3. Repo

**GitHub: [krishaanth5831/prosus-hackathon](https://github.com/krishaanth5831/prosus-hackathon)** (public). This plan follows the working rules already in the repo:
- **Branches:** `dev` is the default branch and every PR goes into it. `main` is protected and needs Krish's approval. Branches are named `name/feature` and live for hours.
- **Layout:** feature folders (vertical slices), one per workstream.
- **Hot files:** Krish owns the database schema, the shared contracts and `CLAUDE.md`. A merged migration is never edited; changes go in a new file.
- **Releases:** every time the demo works end to end, `dev` is merged into `main` and tagged `demo-vN`.

K7's local clone lives at `~/Desktop/personal_projects/github/prosus-hackathon/`, with its gitignored `.env`. The old vault clone in `03 System/` was removed on 26 Sep.

```
prosus-hackathon/
├── README.md  CLAUDE.md  package.json ("test": "node --test", zero deps)  .env.example  .gitignore
├── .github/                  CODEOWNERS (Krish) · pull_request_template.md · workflows/test.yml
├── db/migrations/001_init.sql              ← Krish (hot file)
├── shared/contracts/                       ← Krish (hot file)
│   ├── CONTRACTS.md                        cell_id, data shapes, names, enums, test cells
│   └── fixtures/                           sample actor output, webhook, cell_status, sorties, callback
├── features/
│   ├── collect/                            ← Person A
│   │   ├── actor/                          Apify actor: .actor/, Dockerfile, package.json, src/main.js
│   │   ├── binCells.js · binCells.test.js
│   │   ├── probe-apis.sh
│   │   ├── wf1-collect.json · wf4-heal.json
│   │   └── evidence/
│   ├── detect/                             ← Person C
│   │   ├── sql/                            detect.sql · lift.sql · close.sql · report.sql · investigate.sql
│   │   ├── fixtures/                       detect_fixture.sql · run-fixtures.sh
│   │   ├── wf2-detect.json · wf5-report.json
│   │   └── evidence/
│   ├── gate/                               ← Person B
│   │   ├── decide.js · decide.test.js
│   │   ├── gen-sorties.js · sorties.demo.csv
│   │   ├── wf3-gate.json · wf6-respond.json
│   │   └── evidence/
│   └── map/                                ← Person C: index.html · vercel.json
└── docs/                                   prd.md · plan.md · research.md (Krish) · DECISIONS.md · SETUP_PROMPT.md
                                            TASKS.md · n8n-import.md · video-script.md · evidence.md (Person C)
```

**Why the pure `.js` files exist:** you can't unit-test a Code node inside n8n. Each file is a pure function ending in `if (typeof module !== 'undefined') module.exports = {…}`. Its test sits next to it, and the n8n node pastes the function plus two glue lines.

## 4. Data model: `db/migrations/001_init.sql`

```sql
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
```

n8n connects with the Postgres credential: the Supabase pooler on port 6543, database user, SSL on. That credential bypasses RLS. The anon key can only read.

**Sheet `AirGuard Sorties`, one row per sortie:**
`sortie_id | unit | priority (priority/routine/low) | launch_at (UTC ISO) | window_end (UTC ISO) | cells ("56.5_21.0;56.5_21.5") | status | decided_by | note`
Status is one of `PLANNED`, `RESCHEDULED`, `CANCELLED`, `HOLD` or `LAUNCH_APPROVED`. **There is no "clear" or "safe" status.**

## 5. Components

### 5.1 Apify actor: `features/collect/actor/src/main.js`

```js
import { Actor, log } from 'apify';

await Actor.init();
const input = (await Actor.getInput()) ?? {};
const points = input.points?.length ? input.points : [
  { lat: 56.5, lon: 21.0, nm: 250 },   // Latvia/Lithuania coast + Kaliningrad approach
  { lat: 59.8, lon: 25.0, nm: 200 },   // Gulf of Finland / Estonia
  { lat: 54.5, lon: 18.5, nm: 150 },   // Gdańsk / Kaliningrad west
];
const SOURCES = [
  { name: 'adsb.lol', url: (p) => `https://api.adsb.lol/v2/point/${p.lat}/${p.lon}/${p.nm}` },
  { name: 'adsb.fi',  url: (p) => `https://opendata.adsb.fi/api/v2/lat/${p.lat}/lon/${p.lon}/dist/${p.nm}` },
];
const sources = input.forceFallback ? SOURCES.slice(1) : SOURCES;
// adsb.lol answers 403 to Node's default user-agent ("node"), so say who we are
const headers = { 'user-agent': 'airguard-adsb-collector/0.1 (+https://github.com/krishaanth5831/prosus-hackathon)' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ts = new Date().toISOString();
const seen = new Map();          // dedupe by hex: the query circles overlap
const errors = input.forceFallback ? ['forceFallback: adsb.lol skipped on purpose'] : [];
let used = null;

for (const src of sources) {
  for (const p of points) {
    try {
      const res = await fetch(src.url(p), { headers, signal: AbortSignal.timeout(15000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      const ac = body.ac ?? body.aircraft ?? [];   // adsb.lol answers {ac}, adsb.fi answers {aircraft}
      for (const a of ac) if (a.hex && a.lat != null && (a.seen_pos ?? 0) <= 60) seen.set(a.hex, a);
    } catch (e) { errors.push(`${src.name} @${p.lat},${p.lon}: ${e.message}`); }
    await sleep(1500);
  }
  if (seen.size > 0) { used = src.name; break; }   // primary gave nothing → try the next source
}

const rows = [...seen.values()].map((a) => ({
  ts, source: used, hex: a.hex, flight: a.flight?.trim() || null,
  lat: a.lat, lon: a.lon, nic: a.nic ?? null, nac_p: a.nac_p ?? null,
  alt_geom: a.alt_geom ?? null, alt_baro: typeof a.alt_baro === 'number' ? a.alt_baro : null,
}));
await Actor.pushData(rows.length ? rows : [{ ts, empty: true, errors }]);
await Actor.setValue('RUN_META', { ts, source: used, aircraft: rows.length,
  failover: used !== null && used !== 'adsb.lol', errors });
log.info(`${rows.length} aircraft from ${used ?? 'no source'}`, { errors });
await Actor.exit();
```

**Source quirks (checked 26 Sep):**
- adsb.lol answers **403** to Node's default user-agent `node`, so the actor sends its own. It returns the aircraft under `ac`.
- adsb.fi uses the same readsb fields but returns the aircraft under **`aircraft`**, not `ac`.

**Apify setup** (`features/collect/apify-setup.sh` creates all of it and skips what exists):
- **Schedule:** `*/5 * * * *` UTC, exclusive, so two runs never overlap.
- **Run options:** 256 MB, 120 s timeout (the actor default and the schedule). Apify's default of 4096 MB / 3600 s would burn the $5 free credit. At 256 MB a run costs about $0.0007, so about $0.20/day.
- **Webhook 1:** `ACTOR.RUN.SUCCEEDED` → `{N8N_BASE_URL}/webhook/airguard-apify` (WF1).
- **Webhook 2:** `ACTOR.RUN.FAILED` and `ACTOR.RUN.TIMED_OUT` → `{N8N_BASE_URL}/webhook/airguard-apify-failed` (WF4).
- **Deploy:** `npx apify-cli push` from the actor folder. Apify builds it, so no local npm install is needed.

### 5.2 `features/collect/binCells.js`

```js
function cellId(lat, lon, size = 0.5) {
  return `${(Math.floor(lat / size) * size).toFixed(1)}_${(Math.floor(lon / size) * size).toFixed(1)}`;
}

function binCells(rows) {
  const cells = new Map();
  for (const a of rows) {
    if (a.empty || a.lat == null || a.lon == null) continue;
    if (a.nic == null && a.nac_p == null) continue;            // no integrity data → not a sensor
    const id = cellId(a.lat, a.lon);
    const c = cells.get(id) ?? { ts: a.ts, source: a.source, cell_id: id, n_total: 0, n_degraded: 0, n_spoof: 0 };
    c.n_total++;
    if ((a.nic ?? 99) < 7 || (a.nac_p ?? 99) < 8) c.n_degraded++;
    if (a.alt_geom != null && a.alt_baro != null && Math.abs(a.alt_geom - a.alt_baro) > 1500) c.n_spoof++;
    cells.set(id, c);
  }
  return [...cells.values()].map((c) => ({ ...c, ratio: c.n_degraded / c.n_total }));
}

if (typeof module !== 'undefined') module.exports = { binCells, cellId };
// n8n glue (Code node, "Run once for all items"):
// return binCells($input.all().map(i => i.json)).map(json => ({ json }));
```

### 5.3 `features/gate/decide.js` (the sortie gate)

```js
const HOUR = 3600e3;
const ACT_H = 2, WATCH_H = 12, UNVERIFIED_MIN = 60, BRAKE = 0.25, STEP_H = 2;

function levelFor(s, bad) {
  if (bad.state === 'SPOOF') return { level: 'L4_SPOOF_HOLD', human: true };
  if (s.priority === 'priority') return { level: 'L3_HOLD', human: true };
  if (s.priority === 'low') return { level: 'L2_CANCEL', human: false };
  const next = Date.parse(s.launch_at) + STEP_H * HOUR;
  if (next <= Date.parse(s.window_end))
    return { level: 'L1_RESCHEDULE', human: false, new_launch_at: new Date(next).toISOString() };
  return { level: 'L3_HOLD', human: true };                       // routine, no slot left
}

// sorties: sheet rows · cells: { cell_id: {state, incident_id, severity, evidence} } from cell_status
// done: decision keys already taken · recentlyJammed: cell_ids with an incident in the last 6 h
function decide({ sorties, cells, now = new Date(), done = [], recentlyJammed = [] }) {
  const t = now.getTime(), seen = new Set(done), recent = new Set(recentlyJammed);
  const upcoming = sorties.filter((s) => {
    const dt = Date.parse(s.launch_at) - t;
    return ['PLANNED', 'RESCHEDULED'].includes(s.status) && dt > 0 && dt <= WATCH_H * HOUR;
  });

  const out = [];
  for (const s of upcoming) {
    const dt = Date.parse(s.launch_at) - t;
    const route = String(s.cells).split(';').map((id) => id.trim())
      .map((id) => ({ cell_id: id, ...(cells[id] ?? { state: 'UNKNOWN' }) }));
    const bad = route.find((c) => c.state === 'SPOOF') ?? route.find((c) => c.state === 'JAMMED');
    const base = { sortie_id: s.sortie_id, launch_at: s.launch_at };

    if (bad) {
      const reason = `${bad.state} cell ${bad.cell_id} (${bad.severity}): ${bad.evidence}`;
      out.push(dt > ACT_H * HOUR
        ? { ...base, key: `${s.sortie_id}|${bad.incident_id}|watch`, incident_id: bad.incident_id, level: 'WATCH', human: false, reason }
        : { ...base, key: `${s.sortie_id}|${bad.incident_id}|${s.launch_at}`, incident_id: bad.incident_id, ...levelFor(s, bad), reason });
      continue;
    }
    const unknown = route.filter((c) => c.state === 'UNKNOWN');
    if (unknown.length && dt <= UNVERIFIED_MIN * 60e3) {
      const hot = unknown.find((c) => recent.has(c.cell_id));
      out.push({ ...base, key: `${s.sortie_id}|unknown|${s.launch_at}`, incident_id: null,
        ...(hot
          ? { level: 'L3_HOLD', human: true, reason: `no sensor coverage in ${hot.cell_id}, which was jammed in the last 6 h` }
          : { level: 'UNVERIFIED', human: false, reason: `no sensor coverage in ${unknown.map((c) => c.cell_id).join(', ')}` }) });
    }
  }

  // Blast-radius brake: one incident touching > 25% of the next 12 h → no cancels/reschedules, HOLD + one batch card
  const byInc = {};
  for (const a of out) if (a.incident_id) (byInc[a.incident_id] ??= []).push(a);
  for (const [id, list] of Object.entries(byInc))
    if (list.length / upcoming.length > BRAKE)
      for (const a of list)
        if (!['WATCH', 'L4_SPOOF_HOLD'].includes(a.level))
          Object.assign(a, { level: 'BRAKE_HOLD', human: true, batch: id, new_launch_at: undefined });

  return out.filter((a) => !seen.has(a.key));
}

if (typeof module !== 'undefined') module.exports = { decide, levelFor };
// n8n glue:
// const cells = Object.fromEntries($('Cell status').all().map(i => [i.json.cell_id, i.json]));
// return decide({ sorties: $('Read sorties').all().map(i => i.json), cells,
//   done: $('Done keys').all().map(i => i.json.key),
//   recentlyJammed: $('Recent incidents').all().map(i => i.json.cell_id) }).map(json => ({ json }));
```

**Why act only within 2 h:** jamming often clears within hours. Acting on a sortie 8 h out would cancel missions for nothing. A reschedule moves the launch +2 h, so the sortie leaves the act window and is re-checked when it comes back into it. That gives natural retries with no loop.

### 5.4 SQL queries

**`detect.sql` (WF2).** It opens incidents, re-arms MAY-LIFT incidents that jam again, and returns only the new ones.
```sql
with last2 as (
  select o.*, row_number() over (partition by cell_id order by ts desc) rn
  from observations o where ts > now() - interval '12 minutes'
), jam as (
  select l.cell_id, 'JAMMED' as type,
    case when min(l.ratio) >= 0.5 then 'high' else 'medium' end as severity,
    max(case when rn = 1 then n_degraded end) || '/' || max(case when rn = 1 then n_total end)
      || ' aircraft degraded, 2 checks in a row' as evidence
  from last2 l left join baselines b using (cell_id)
  where rn <= 2 and n_total >= 3 and ratio >= coalesce(b.threshold, 0.3)
  group by l.cell_id having count(*) = 2
), spoof as (
  select cell_id, 'SPOOF', 'high',
    max(case when rn = 1 then n_spoof end) || ' aircraft with GPS/baro altitude gap > 1500 ft, 2 checks in a row'
  from last2 where rn <= 2 and n_spoof >= 2
  group by cell_id having count(*) = 2
), hits as (select * from jam union all select * from spoof),
rearm as (
  update incidents i set status = 'open', may_lift_at = null
  from hits h where i.cell_id = h.cell_id and i.type = h.type and i.status = 'may_lift'
  returning i.id
)
insert into incidents (cell_id, type, status, severity, confidence, evidence)
select cell_id, type, 'open', severity, 'medium (ADS-B only)', evidence from hits
on conflict (cell_id, type) where status <> 'closed' do nothing
returning *;
```

**`lift.sql` (WF2).** "Quiet" only counts if there was coverage, because UNKNOWN is never clean.
```sql
update incidents i set status = 'may_lift', may_lift_at = now()
where i.status = 'open' and i.opened_at < now() - interval '30 minutes'
  and (select count(*) from observations o
       where o.cell_id = i.cell_id and o.ts > now() - interval '30 minutes' and o.n_total >= 3) >= 5
  and not exists (select 1 from observations o left join baselines b using (cell_id)
       where o.cell_id = i.cell_id and o.ts > now() - interval '30 minutes'
         and ((i.type = 'JAMMED' and o.ratio >= coalesce(b.threshold, 0.3))
           or (i.type = 'SPOOF'  and o.n_spoof >= 2)))
returning *;
-- second statement (separate Postgres node): close after 2 h of MAY-LIFT. Sorties are NOT touched.
update incidents set status = 'closed', closed_at = now()
where status = 'may_lift' and may_lift_at < now() - interval '2 hours' returning *;
```

**`report.sql` (WF5)** covers the last 24 h:
- incidents opened
- counts per level
- the resolution rate `(L1+L2) / (L1+L2+L3+L4+BRAKE)`, counting only decisions tied to an incident
- failovers
- HOLDs still pending

**`investigate.sql` (Could, F14)** takes a cell and a time. It returns the observations and incidents from ±1 h around that time.

## 6. Workflows (n8n)

Every workflow's settings point **Error workflow → WF4**.

| WF | Trigger | Nodes, in order | Done when |
|---|---|---|---|
| **WF1 Collect** | Webhook `POST /webhook/airguard-apify` (respond immediately) | 1. HTTP GET `key-value-stores/{resource.defaultKeyValueStoreId}/records/RUN_META`<br>2. HTTP GET `datasets/{resource.defaultDatasetId}/items?clean=true` (second, so the Code node's `$input.all()` is exactly the aircraft)<br>3. Code `binCells`<br>4. IF 0 cells → log *"no data from any source: every cell UNKNOWN"* and stop<br>5. Postgres insert `observations`<br>6. IF `failover` → log *"primary adsb.lol unavailable (errors), switched to adsb.fi"*<br>7. Execute WF2 | Rows land every 5 min with nobody touching it |
| **WF2 Detect** | Execute Workflow Trigger | 1. Postgres `detect.sql`<br>2. Postgres `lift.sql` (both statements)<br>3. One `agent_log` line per opened / may-lift / closed incident. MAY-LIFT → Telegram: *"cell X quiet 30 min with coverage. HOLDs there may be lifted by you."*<br>4. Execute WF3 | An incident opens on its own from real data |
| **WF3 Gate** | Execute Workflow Trigger | 1. Sheets: read all rows<br>2. Postgres `select * from cell_status`<br>3. Postgres done keys (last 2 days)<br>4. Postgres recently jammed cells (`opened_at > now()-6h or status <> 'closed'`)<br>5. Code `decide`<br>6. **Insert into `decisions` first** (`on conflict (key) do nothing returning`) and continue only for returned rows. Two runs that overlap therefore can't both act.<br>7. Switch on level:<br>&nbsp;&nbsp;• **L1/L2** → update sheet row → log → Telegram FYI<br>&nbsp;&nbsp;• **L3/L4** → sheet status HOLD → LLM briefing (template fallback) → Telegram message with inline keyboard → log<br>&nbsp;&nbsp;• **BRAKE** → all rows HOLD → one batch message → log<br>&nbsp;&nbsp;• **WATCH / UNVERIFIED** → log (+ Telegram for UNVERIFIED) | A real incident changes a sheet row and a card arrives |
| **WF4 Heal** | Error Trigger · Webhook `POST /webhook/airguard-apify-failed` · Schedule every 5 min | **Error:** log *"WFx failed at node Y: msg"* + Telegram.<br>**Apify failure:** log + Telegram.<br>**Watchdog:** `max(observations.ts)` older than 15 min and not already flagged → log *"data stale N min: every cell UNKNOWN, HOLD logic still active"* + Telegram; log again when data is fresh | One real failover and one stale alarm in `agent_log` |
| **WF5 Report** | Schedule 07:00 | 1. Postgres `report.sql`<br>2. (LLM phrasing, template fallback)<br>3. Telegram | The report arrives on the phone |
| **WF6 Respond** | Telegram Trigger (callback_query) | 1. IF `from.id` not in the allowlist → answer "not authorised", log, stop<br>2. Parse `callback_data` = `k\|S-017\|42` (action, sortie, decision id) or `bk\|inc` / `bf\|inc` for a batch<br>3. Switch:<br>&nbsp;&nbsp;• **k (Keep HOLD)** → note only<br>&nbsp;&nbsp;• **l (Launch anyway)** → status `LAUNCH_APPROVED`<br>&nbsp;&nbsp;• **f (False alarm)** → status `PLANNED`, `baselines` threshold +0.05 (max 0.6), incident closed with *"[false alarm: name]"*<br>4. Sheet `decided_by = human:<name>`, `decisions.human_answer`<br>5. Log<br>6. `answerCallbackQuery` + edit the message to show the outcome (buttons gone) | A tap on the phone changes the sheet |

**Why inline keyboard + WF6 and not send-and-wait:** Telegram send-and-wait in n8n offers only approve and decline, and we need three answers. It would also leave one execution waiting per card. A single Telegram Trigger owns the bot's webhook, so there's only one of them.

**Card text** (template; the LLM may rewrite the middle line only):
```
⛔ HOLD · S-017 · 3rd Border Drone Sqn (DEMO) · launch 04:30
JAMMED cell 54.5_20.5 (high): 9/14 aircraft degraded, 2 checks in a row
Agent: held. Needs your call. It never says safe.
[Keep HOLD] [Launch anyway] [False alarm]
```

**`agent_log` style:** one line that says what happened and why.
> `WF3 · RESCHEDULE S-022 04:30→06:30 · JAMMED 55.0_21.0 medium (6/15 degraded, 2 checks) · routine, slot inside window · done`

### Map (`features/map/index.html`)
- Leaflet reads `cell_status` and the last 20 `agent_log` rows every 60 s, using the anon key.
- Cell rectangles come from `cell_id` (the lower-left corner + 0.5°).
- Colours: red JAMMED, purple SPOOF, grey hatched UNKNOWN, **outline only** for NO_KNOWN_ISSUE. There is no green.
- Side panel: the live log.

### Demo sorties (`features/gate/gen-sorties.js`)
Run it once real observations exist.
1. Pick the cells with ≥ 3 aircraft in ≥ 60% of the last 6 h of cycles, since those are the ones with sensor coverage.
2. Prefer cells along the Kaliningrad/Lithuania and Gulf of Finland borders, where a border unit would actually patrol.
3. Generate 48 sorties with these settings:
   - Unit: `3rd Border Drone Sqn (DEMO, fictional)`
   - Priority mix: 12 priority / 24 routine / 12 low
   - Launches: every 30 min across the next 24 h
   - `window_end`: launch + 1 h (priority) / 6 h (routine) / 3 h (low)
   - Routes: 1–3 adjacent cells
   - Status: `PLANNED`
4. Import the CSV into the Sheet. **Say in the video that the sorties are demo data and the jamming data is real.**

## 7. Build order (dependency chain)

| # | Step | Done when | Proof / test |
|---|---|---|---|
| 0 | Accounts: Supabase, n8n Cloud, Apify, Telegram bot + your user ID, Google Sheet, GitHub | Every credential saved in n8n/Apify | `features/collect/probe-apis.sh` prints aircraft + degraded counts from both sources |
| 1 | Scaffold PR into `dev` (feature folders, contracts, fixtures, schema) | `npm test` green on a fresh clone | PR merged into `dev` |
| 2 | `001_init.sql` | Tables, view and RLS exist | The anon key can `select`; an anon `insert` fails |
| 3 | Apify actor + schedule + both webhooks | A dataset of ~90+ rows per run | A `forceFallback: true` run shows `source: adsb.fi` and `failover: true` |
| 4 | **WF1 Collect** | `observations` grows every 5 min unattended | `binCells.test` passes; row count grows over 3 cycles |
| 5 | **WF2 Detect** | An incident opens from real data | `run-fixtures.sh`: 1 high check → nothing; 2 → one incident; run again → still one |
| 6 | **WF4 Heal** | A failover and a stale alarm are logged | Force the fallback once; pause the Apify schedule for 20 min → stale alarm, map goes grey |
| 7 | Demo sorties → Sheet | 48 rows in cells with real traffic | Every `cells` value matches `cellId()` |
| 8 | **WF3 Gate + WF6 Respond** | A tap on the phone changes a row | `decide.test` covers every level, the brake and dedupe; one end-to-end run on a fixture incident; a tap from a non-allowlisted account is refused |
| 9 | **WF5 Report** | 07:00 message arrives | Run it manually once |
| 10 | Map on Vercel | Live cells render; no green | Open it on the phone |
| 11 | Should: spoof (after checking the real altitude-gap spread) → NOTAM actor (after verifying a source) | | Spoof: a fixture cell gives L4 |
| 12 | Could: false-alarm learning → loss investigator → reroute proposal | | |
| 13 | Harvest evidence into `features/*/evidence/` + `05 Attachments/` → video | Best real incident, failover, Telegram tap and morning report are captured | |

After each step works: export the workflow into its feature folder and open a PR into `dev`. Every time the demo works end to end: merge `dev` into `main` and tag `demo-vN`.

## 8. Test plan

| Path | Cases | How |
|---|---|---|
| `binCells` | negative coords, cell edges (56.5 exactly), missing nic/nac_p, `empty` row, spoof count | `features/collect/binCells.test.js` |
| `decide` | routine+slot → L1 · routine, no slot → L3 · low → L2 · priority → L3 · spoof → L4 even if low · launch 5 h out → WATCH · UNKNOWN <1 h → UNVERIFIED · UNKNOWN + recently jammed → L3 · incident on 30% of upcoming → BRAKE · key already done → nothing · CANCELLED/HOLD sorties ignored · past launches ignored | `features/gate/decide.test.js` |
| detect/lift SQL | 1 vs 2 checks · n_total < 3 · duplicate prevented · re-arm from may_lift · no MAY-LIFT without coverage | `features/detect/fixtures/run-fixtures.sh` (psql) |
| Human gate | each of the 3 buttons · batch buttons · non-allowlisted user | Manual, once each |
| Self-healing | forced fallback (`forceFallback: true`) · both sources return nothing (`points: [{lat: 89.9, lon: 178.9, nm: 1}]`, test cell `89.5_178.5`) · paused schedule · a node error (`POST {}` to WF1) | Forced, once each. Proof: `features/collect/evidence/` |
| Authority | no path sets a status to anything "clear"; MAY-LIFT/close never touches the sheet | grep the code + a log check |

## 9. Failure modes

| Failure | What happens | Handled by |
|---|---|---|
| adsb.lol down | The actor uses adsb.fi | Actor + WF1 failover log |
| Both sources down | Empty dataset | WF1 logs it; the view marks every cell UNKNOWN; UNVERIFIED notices go out |
| Apify run fails / quota | No webhook to WF1 | Failure webhook → WF4; the watchdog catches the gap |
| n8n webhook down | Data not processed | Watchdog → stale alarm |
| Two runs overlap | A double action would be possible | Unique `decisions.key` + a unique partial index on incidents |
| Telegram tap never comes | Sortie stays on HOLD | This is the correct fail-safe. The report lists pending HOLDs. |
| Sheets API error | A row isn't updated, but the decision is recorded | Error Trigger → log + Telegram |
| Night with few aircraft | Cells go UNKNOWN | UNVERIFIED notices, no mass HOLDs; shown honestly on the map |
| LLM fails | No briefing | Template text; the decision is unaffected |

## 10. Review findings & decisions

The review ran inline, as a single voice: CEO → Eng → DX.

| # | Phase | Finding | Decision | Type |
|---|---|---|---|---|
| 1 | Eng | Treating UNKNOWN as grounds to HOLD would put most sorties on HOLD every night (little traffic) and keep tripping the brake | UNKNOWN → **UNVERIFIED** notice. HOLD only if the cell was jammed in the last 6 h | Auto (critical) |
| 2 | Eng | Matching triggered only when an incident opens misses sorties added later and never re-checks rescheduled ones | Per-cycle state-based gate + unique `decisions.key` | Auto |
| 3 | Eng | Acting on sorties hours out cancels missions for jamming that may clear, and reschedules chain | Act ≤ 2 h, WATCH 2–12 h; a reschedule steps +2 h | Taste |
| 4 | Eng | n8n send-and-wait has only approve and decline | Inline keyboard + WF6 Telegram Trigger, allowlisted user IDs | Auto |
| 5 | Eng | MAY-LIFT would fire on cells that went quiet only because the aircraft left | MAY-LIFT needs ≥ 5 covered checks | Auto |
| 6 | Eng | Aircraft without NIC/NACp inflate `n_total` | Not counted as sensors | Auto |
| 7 | Eng | Duplicate incidents and double actions | Unique partial index + `on conflict`; decision is inserted before acting | Auto |
| 8 | Eng | Stale data would keep showing the old picture | The view only trusts the last 15 min, so staleness becomes UNKNOWN automatically | Auto |
| 9 | Eng | A 1500 ft altitude gap can come from temperature | ≥ 2 aircraft on 2 checks; look at the real spread before turning it on | Auto |
| 10 | CEO | The rubric wants Apify doing *all* collection; one actor looks thin | Apify failure webhook now; NOTAM actor as Should, only with a verified source | Auto |
| 11 | CEO | Demo sorties placed in empty cells would sit in UNKNOWN forever and never meet a real event | Generate them from observed cells; publish the fixed priority mix | Auto |
| 12 | CEO | A military customer is a risk with VC/Prosus judges | Lead with "drone units on NATO's eastern flank", keep it software/pre-launch/no weapons, keep civil as segment C | Taste |
| 13 | Eng | The brake needs a meaning | Brake = HOLD all (reversible), no cancels or reschedules, one batch card | Taste |
| 14 | DX | Code nodes can't be tested in n8n | Pure `.js` per feature + colocated `node --test`, zero dependencies | Auto |
| 15 | DX | Cell IDs like `113_42` mean nothing to a judge | `56.5_21.0` (lower-left corner in degrees); the map draws directly from it | Taste |
| 16 | DX | The repo would be unreadable from here if it lived on the Desktop | Local clone in `03 System/prosus-hackathon/`, gitignored from the vault. **Superseded 26 Sep:** the clone now lives at `~/Desktop/personal_projects/github/prosus-hackathon/` | Taste |

**Premises still unproven. Check them, don't assume them:**
1. Jamming seen at airliner altitude is useful early warning for drones.
2. Border/ISR units would trust unclassified civil data.

Both are handled in the pitch as "early-warning layer, never a guarantee". Neither is validated with a real unit.
