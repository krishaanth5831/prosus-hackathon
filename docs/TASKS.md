# Tasks

One PR per slice into `dev`. Claim a slice (put your name on it) before you start. Order within a workstream matters.
Specs: `docs/plan.md` · contracts: `shared/contracts/CONTRACTS.md`.

| Slice | What | Owner | Folder | Done (demo-visible) | Status |
|---|---|---|---|---|---|
| **A1** | probe-apis.sh: curl + jq against adsb.lol and adsb.fi | Person A `krishaanth5831` | `features/collect/` | Running it prints "source: N aircraft, M degraded" for both sources | todo |
| **A2** | Apify actor (plan §5.1), deployed with `apify push` | Person A | `features/collect/actor/` | A normal run gives C2 rows; a `forceFallback:true` run shows `source: adsb.fi`, `failover: true` | todo |
| **A3** | binCells.js + binCells.test.js | Person A | `features/collect/` | `npm test` green on negative coords, the 56.5 edge, missing nic/nac_p, empty row, spoof count | todo |
| **A4** | WF1 Collect (`wf1-collect.json`), Execute WF2 left disabled | Person A | `features/collect/` | An Apify run lands rows in `observations` | todo |
| **A5** | Apify schedule */5 + success/failure webhooks | Person A | `features/collect/` | `observations` grows on 3 consecutive cycles, unattended | todo |
| **A6** | WF4 Heal (`wf4-heal.json`): Error Trigger, Apify-failure webhook, stale watchdog | Person A | `features/collect/` | A broken node produces a log line + Telegram message | todo |
| **A7** | Prove healing: forced failover + 20 min paused schedule | Person A | `features/collect/evidence/` | Failover line, stale alarm on the phone, "fresh again" line, all saved as evidence | todo |
| **B1** | decide.js + decide.test.js (plan §5.3, every §8 case) | Person B `Atharva-cloud-1` | `features/gate/` | `npm test` green on L1, L2, L3, L4, WATCH, UNVERIFIED, BRAKE, dedupe, ignored statuses | todo |
| **B2** | gen-sorties.js (+ `--fixture` mode) → sorties.demo.csv | Person B | `features/gate/` | Fixture mode writes 48 C5-valid sorties (12/24/12) | todo |
| **B3** | Telegram: team user IDs, chat id, allowlist | Person B | `features/gate/` | Config values for TELEGRAM_CHAT_ID + allowlist handed to Krish | todo |
| **B4** | WF3 Gate (`wf3-gate.json`), decisions inserted before acting | Person B | `features/gate/` | A fixture incident changes a sheet row and a HOLD card arrives on the phone | todo |
| **B5** | WF6 Respond (`wf6-respond.json`), allowlist + C7 parsing | Person B | `features/gate/` | A tap on Keep / Launch / False alarm changes the sheet; a stranger's tap is refused | todo |
| **B6** | End-to-end on test cell `89.5_179.0` with T-001..T-005 | Person B | `features/gate/evidence/` | Every level seen on the sheet + phone, second run does nothing, proof saved, test rows deleted | todo |
| **C1** | SQL: detect, lift, close, report, investigate | Person C `ShivamK12345` | `features/detect/sql/` | Each file runs clean against the schema | PR #8 · runs clean on 001_init.sql |
| **C2** | detect_fixture.sql + run-fixtures.sh on test cell `89.5_179.5` | Person C | `features/detect/fixtures/` | Script prints pass for 1 vs 2 checks, n_total < 3, dedupe, re-arm, MAY-LIFT coverage; exits 0 | PR #9 · 14/14 pass on Supabase (evidence/c2-fixtures-live.md) |
| **C3** | WF2 Detect (`wf2-detect.json`), Execute WF3 left disabled | Person C | `features/detect/` | An incident opens from data with an agent_log line; MAY-LIFT sends a Telegram message | PR #10 · imported `KPCB3810HyAh8FUm`, creds attached, error WF = WF4 |
| **C4** | WF5 Report (`wf5-report.json`), 07:00 Europe/Amsterdam | Person C | `features/detect/` | A manual run puts the morning report on the phone | PR #11 · imported `smqvjqaMQhKFdwbg`, active 07:00; manual run pending |
| **C5** | Leaflet map (`index.html`, `vercel.json`), `?fixture=1` mode | Person C | `features/map/` | Live cells render on the phone from the Vercel URL; no green anywhere | PR #14 · fixture mode verified; Vercel deploy pending |
| **C6** | README AirGuard sections + docs/n8n-import.md | Person C | `README.md`, `docs/` | A judge understands the system from the README alone | PR open · workflow IDs + map URL filled in after import/deploy |
| **C7** | docs/video-script.md + docs/evidence.md | Person C | `docs/` | ≤ 2 min script with a shot list tied to exact SQL/screens | PR open · placeholders filled from the overnight run |

Integration (Krish, after A/B/C are done): wire WF1→WF2→WF3, error workflow = WF4, real `gen-sorties` run, dev → main, tag `demo-v1`.
