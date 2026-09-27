# AirGuard contracts

Owner: Krish. Every feature builds against these. A change here is announced out loud and lands
as a PR from Krish; nobody else edits this file. Fixtures for every shape live in `fixtures/` and
are checked by `contracts.test.js` (`npm test`).

## C1 cell_id

Lower-left corner of a 0.5° cell, 1 decimal, `lat_lon`:

```js
`${(Math.floor(lat/0.5)*0.5).toFixed(1)}_${(Math.floor(lon/0.5)*0.5).toFixed(1)}`   // → "56.5_21.0"
```

Regex: `/^-?\d+\.\d_-?\d+\.\d$/`. Negative coordinates floor downwards: (-0.3, -0.3) → `"-0.5_-0.5"`.

## C2 Actor output

Dataset row, one per aircraft (deduped by `hex`):

```
{ts, source, hex, flight, lat, lon, nic, nac_p, alt_geom, alt_baro}
```

If nothing came back from any source: exactly one row `{ts, empty: true, errors: [...]}`.

Key-value record `RUN_META`: `{ts, source, aircraft, failover, errors}`.

Fixtures: `actor-output.sample.json`, `run-meta.sample.json`, `apify-webhook.sample.json` (the webhook that hands WF1 the run).

## C3 Database

The database is `db/migrations/001_init.sql`. Krish owns `db/`.
Never edit a merged migration. A schema change = ask Krish → he adds `00N_*.sql`.

## C4 cell_status view

Columns: `cell_id, ts, n_total, n_degraded, ratio, incident_id, severity, evidence, state, drone_ts, drone_evidence`.
`state ∈ JAMMED | SPOOF | UNKNOWN | NO_KNOWN_ISSUE`.
**A cell missing from the view = UNKNOWN.**

`drone_ts, drone_evidence`: the latest drone report (C12) for the cell from the last 60 min, else null.
A NORMAL drone report lifts a cell with fewer than 3 aircraft from UNKNOWN to NO_KNOWN_ISSUE. It never outranks an incident.

Fixture: `cell_status.sample.json`.

## C5 Sortie sheet

Google Sheet **"AirGuard Sorties"**, tab **"sorties"**, header:

```
sortie_id | unit | priority | launch_at | window_end | cells | status | decided_by | note
```

- `priority ∈ priority | routine | low`
- `cells` joined by `;` (e.g. `56.5_21.0;56.5_21.5`)
- `status ∈ PLANNED | RESCHEDULED | REROUTED | CANCELLED | HOLD | LAUNCH_APPROVED`
- A reroute (C6 `L1_REROUTE`) rewrites `cells` to the cells it keeps; it never adds one.
- **There is never a "clear" or "safe" status.**

Fixture: `sorties.sample.csv`.

## C6 Decision levels

Levels: `WATCH L1_REROUTE L1_RESCHEDULE L2_CANCEL L3_AUTO_HOLD L3_HOLD L4_SPOOF_HOLD BRAKE_HOLD UNVERIFIED`.

- The agent acts alone and sends an FYI text (with a "Why:" line): `L1_REROUTE`, `L1_RESCHEDULE`, `L2_CANCEL`, `L3_AUTO_HOLD`.
- High risk, a card asks the duty officer (with a "Why you:" line): `L3_HOLD` (priority sortie), `L4_SPOOF_HOLD`, `BRAKE_HOLD`.
- Order for a routine or low sortie with a risky cell (JAMMED, SPOOF, or UNKNOWN jammed in the last 6 h): reroute if some
  cells are not risky, else reschedule +2 h (routine, slot left), cancel (low) or HOLD (routine, no slot left).

`decisions.key`:
- `"<sortie>|<incident>|<launch_at>"` (acted on)
- `"<sortie>|<incident>|watch"` (watched)
- `"<sortie>|unknown|<launch_at>"` (no coverage)

`decide()` returns:

```
[{sortie_id, launch_at, key, incident_id, level, human, reason, new_launch_at?, new_cells?, batch?}]
```

`new_cells` (a reroute: the kept cells joined by `;`) is stored in `decisions.new_cells` (`db/migrations/004`).

## C7 Telegram callback_data

At most **64 bytes**.

| callback_data | Button |
|---|---|
| `k\|<sortie>\|<decision_id>` | Hold |
| `l\|<sortie>\|<decision_id>` | Launch anyway |
| `c\|<sortie>\|<decision_id>` | Cancel |
| `bk\|<incident_id>` | Batch: Hold (all) |
| `bl\|<incident_id>` | Batch: Launch anyway (all) |
| `bc\|<incident_id>` | Batch: Cancel (all) |
| `f\|<sortie>\|<decision_id>`, `bf\|<incident_id>` | False alarm: only on cards sent before 2026-09-27, still answered |

`decisions.human_answer ∈ keep | launch | cancel | false_alarm`.

Only allowlisted user IDs (`TELEGRAM_ALLOWED_USER_IDS`) may answer.

Fixture: `telegram-callback.sample.json`.

## C8 agent_log

- `workflow ∈ WF1..WF8`
- `action` = UPPERCASE verb + object (`"HOLD S-017"`)
- `reason` = plain English + evidence (`"JAMMED 54.5_20.5 high: 9/14 aircraft degraded, 2 checks in a row"`)
- `outcome`

## C9 n8n

- Workflow names: `AirGuard WF1 Collect`, `AirGuard WF2 Detect`, `AirGuard WF3 Gate`, `AirGuard WF4 Heal`, `AirGuard WF5 Report`, `AirGuard WF6 Respond`, `AirGuard WF7 Telemetry`, `AirGuard WF8 Console`.
- Webhook paths: `airguard-apify` (WF1), `airguard-apify-failed` (WF4), `airguard-drone` (WF7) and `airguard-console` (WF8), both with the header `X-AirGuard-Token`.
- WF2 and WF3 start with an Execute Workflow Trigger named **"Start"**.
- The first node after every trigger is a Set node **"Config"** with the non-secret config (chat id, allowlist, sheet id).
- Secrets only in credentials `AirGuard Postgres`, `AirGuard Telegram`, `AirGuard Sheets`, `AirGuard Apify`, `AirGuard LLM`, `AirGuard Drone Intake`, `AirGuard Console`.
- Error workflow = WF4.
- Exports live in the owner's feature folder as `wfN-<name>.json`, credential IDs removed.

## C10 Time

Timestamps are UTC ISO 8601 (`2026-09-26T21:05:00Z`). Local time only in human-facing text.

## C11 Test data

- Sortie ids `T-*`.
- Test cells: Person A `89.5_178.5`, Person B `89.5_179.0`, Person C `89.5_179.5`.
- Delete your test rows afterwards. Never touch another person's test cell.

## C12 Drone report

A drone's GNSS health for one sortie, POSTed by the ground station (or `features/collect/sim-drone.js`) to WF7:

```
{ source, drone_id, sortie_id,
  legs:    [{ cell_id, from, to }],                                   // the PLANNED route, in time order
  samples: [{ t, fix_type, satellites_visible, h_acc, jamming_state, spoofing_state, lat, lon }] }
```

- Field names follow MAVLink `GPS_RAW_INT` (`fix_type`, `satellites_visible`, `h_acc` in mm) and PX4 `SensorGps`
  (`jamming_state` 0 unknown · 1 ok · 2 warning · 3 critical, `spoofing_state` 0 unknown · 1 none · 2 indicated · 3 multiple).
- A sample counts for the leg whose `from..to` holds `t`. **`lat`/`lon` are never used to place it**: a spoofed drone reports the wrong place.
- Per leg with 10+ samples: degraded = `fix_type < 3` or `h_acc > 10000` or `jamming_state >= 2`; spoof = `spoofing_state >= 2`.
  Verdict `SPOOF` if spoof ≥ 20 %, else `JAMMED` if degraded ≥ 30 %, else `NORMAL`. One `drone_reports` row per leg (`db/migrations/002`).
- `source` starting with `sim:` is simulated. Every evidence string from it starts with `SIMULATED`.
- WF2 opens an incident on one JAMMED/SPOOF report from the last 60 min. Confidence is `medium (drone only)`, or `high (ADS-B + drone)` when both sensors agree.

Fixture: `drone-report.sample.json`.

## C13 Console data

The ops console (`features/console`) reads Supabase with the anon key, live through Supabase Realtime (`db/migrations/003`).

- `sorties`: a mirror of the sheet tab `sorties` (C5 columns, kept as the sheet's text) plus `changed_at`. The sheet stays the source of truth.
  WF3 syncs it every cycle, right after it reads the sheet; WF8 syncs it after each console request. Both call `sync_sorties(rows jsonb, by)`, which only the postgres role may run.
- `sheet_sync`: one row, `{synced_at, n_rows, by}`.
- Realtime tables: `agent_log`, `incidents`, `decisions`, `drone_reports`, `observations`, `sorties`, `sheet_sync`. `decisions` is readable by anon.
- The console shows a sortie's status as the mirror row plus any decision made after `sheet_sync.synced_at`, mapped as `act.js` and `respond.js` write the sheet.
- WF8 writes and removes only test sorties (`T-*`, C11).

## C14 Telegram log

`telegram_log` (`db/migrations/004`): everything AirGuard sends to the Telegram ops group and every tap on a card, for
the ops console's Telegram view. n8n writes a row right after each Telegram call (a "Telegram log" node in WF2–WF5; WF6:
"Log tap", "Log edit", "Log refused tap"), with the query and parameters in `features/console/telegramLog.js`.

```
{id, ts, workflow, kind: message | edit | tap, message_id, text, buttons, who}
```

- `message`: `text` as the group shows it, `buttons` the card's button labels row by row (`[["Hold","Launch anyway","Cancel"]]`) or null.
- `edit`: the new text of the message with that `message_id` (an answered card: the answer added, the buttons gone).
- `tap`: `text` is the button label, `who` is `human:<first name>`, or `not on the allowlist` (no name).
- Never a chat id or a user id. Anon can read it, like `agent_log`; realtime is on.
