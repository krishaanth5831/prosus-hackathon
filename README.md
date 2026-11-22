# AirGuard

_Repo: `prosus-hackathon`._

**AirGuard: an autonomous pre-launch sortie guard that uses aircraft overhead as GPS-jamming sensors and reroutes, reschedules, cancels or holds drone sorties before they launch into jammed airspace. It never says "safe".**

Apify (collection) → n8n Cloud (all logic) → Supabase Postgres → Google Sheet (sortie plan) → Telegram (human gate) → Leaflet map on Vercel.
What and why: `docs/prd.md` · how: `docs/plan.md` · contracts: `shared/contracts/CONTRACTS.md` · slices: `docs/TASKS.md` · rules for Claude Code: `CLAUDE.md`.

**Live map:** https://airguard-map.vercel.app (`?fixture=1` for the contract fixtures) · **Evidence:** [`docs/evidence.md`](docs/evidence.md) · **Video script:** [`docs/video-script.md`](docs/video-script.md)

## Status

Built in one weekend in Amsterdam for **Build Weekend 26 (Young Creators × Prosus)**; the demo video was due on 2026-09-27. Everything described below ran as a hosted, unattended pipeline on the team's own Apify, n8n Cloud, Supabase, Telegram and Google accounts during the hackathon. This repo holds the code and the n8n workflow exports, not those accounts: to run the full pipeline yourself you need your own of each (see [Setup](#setup)). The map page was still online on 2026-11-22; whether the pipeline behind it is still running was not checked.

What runs with no accounts at all:

```bash
npm test                                   # Node >= 20, zero dependencies, 122 tests
python3 -m http.server 8000                # from the repo root, then open:
# http://localhost:8000/features/map/index.html?fixture=1   (the map on the contract fixtures)
```

## AirGuard in one minute (for judges)

Border-guard and ISR drone units on NATO's eastern flank plan patrol sorties hours ahead. GPS jamming around Kaliningrad, Belarus and the Gulf of Finland appears and moves almost every day. A drone that launches into it drifts, gets lost, or crosses a border.

AirGuard turns every airliner overhead into a free GPS-quality sensor. Each ADS-B aircraft broadcasts NIC and NACp, which rate how far its own GPS fix can be trusted. One bad aircraft is noise. Many bad aircraft in the same 0.5° cell on two checks in a row is jamming. Every 5 minutes AirGuard checks every upcoming sortie against that picture, **before launch**. It acts on its own when an action makes a sortie *safer*, and it asks an officer on Telegram whenever an action would make a sortie *riskier*.

### It never says "safe"

AirGuard has four words for a cell and none of them is "safe":

| State | Rule (SQL, no LLM) | Map |
|---|---|---|
| **JAMMED** | ≥ 3 sensor aircraft and degraded ratio ≥ threshold (default 0.3) on 2 consecutive checks | red |
| **SPOOF** | ≥ 2 aircraft with a GPS-vs-baro altitude gap > 1500 ft on 2 consecutive checks | purple |
| **UNKNOWN** | < 3 sensor aircraft, or data older than 15 min. **Missing data is never read as good.** | grey hatched |
| **NO KNOWN ISSUE** | enough aircraft, below threshold | outline only |

There is no green on the map, and no sortie status called "clear". A sortie with no known issue simply stays `PLANNED`. A jammed cell that quiets down for 30 minutes *with coverage* becomes **MAY-LIFT**, which is a notification only. The agent never lifts a HOLD.

### Architecture

```
 adsb.lol ──┐ (fallback adsb.fi)
            ▼
 ┌─ APIFY ───────────────────────┐  webhook RUN.SUCCEEDED ──► n8n WF1
 │ adsb-collector  (every 5 min) │  webhook RUN.FAILED    ──► n8n WF4
 └───────────────────────────────┘
 ┌─ n8n Cloud ──────────────────────────────────────────────────────────┐
 │ WF1 Collect ─► WF2 Detect ─► WF3 Gate ──► Telegram: FYI text or card │
 │                                              │   (Hold/Launch/Cancel) │
 │ WF6 Respond ◄── Telegram Trigger (button tap)┘                       │
 │ WF4 Heal (Error Trigger + Apify failure + stale watchdog)            │
 │ WF5 Report (07:00)                                                   │
 └──────────┬───────────────────────────────┬───────────────────────────┘
            ▼                               ▼
   Supabase Postgres                  Google Sheet "AirGuard Sorties"
   observations, incidents,           (the unit's sortie plan)
   decisions, agent_log, baselines,
   telegram_log (every message)
            ▲ read-only (RLS, anon key), live (Realtime)
   Leaflet map on Vercel · Ops console (npm run console, localhost)
```

- **Apify** does all the collecting: 3 Baltic query points, adsb.lol with automatic failover to adsb.fi, deduped by aircraft.
- **n8n** does all the logic. Detection is plain SQL (`features/detect/sql/`) and the sortie gate is a pure, unit-tested JS function (`features/gate/decide.js`). **No LLM is in the decision path.**
- The gate is **state-based**: every cycle it compares all upcoming sorties with the current cell picture. A unique `decisions.key` makes each action happen exactly once, even when two runs overlap.

### Autonomy and the human gate

The agent **acts** on sorties launching within 2 h and **watches** sorties launching 2–12 h out. A risky cell is a JAMMED or SPOOF cell, or an UNKNOWN cell that was jammed in the last 6 h.

| Situation | Level | What happens | Human? |
|---|---|---|---|
| Route crosses a risky cell, launch 2–12 h away | WATCH | Logs "at risk" once, changes nothing (jamming often goes away) | No |
| Routine or low sortie, some cells risky, others not | **L1 Reroute** | Drops the risky cells, flies the rest on time; FYI text | No |
| Routine sortie, every cell risky, +2 h still fits its window | **L1 Reschedule** | Moves the launch +2 h; FYI text | No |
| Low-priority sortie, every cell risky | **L2 Cancel** | Cancels; FYI text | No |
| Routine sortie, every cell risky, no slot left | **L3 HOLD by the agent** | HOLD; FYI text | No |
| Priority sortie, a risky cell on its route | **L3 HOLD** | HOLD + Telegram card | **Yes** |
| Any SPOOF cell on the route | **L4 Spoof HOLD** | HOLD + card flagged as spoofing | **Always** |
| UNKNOWN cell, launch < 1 h, no recent jamming | UNVERIFIED | Notifies "no sensor coverage", changes nothing | Officer decides |
| One incident hits > 25% of upcoming sorties | **BRAKE** | HOLDs all of them (reversible), sends **one** batch card | **Yes** |

**Telegram:** everything the agent does on its own is a plain FYI text in the ops group that says what it did and **why** (e.g. "Why: its only cell is at risk, so there is no reroute. It is routine and +2 h still ends inside its window…"). Only the high-risk cases (a priority sortie, possible spoofing, the brake) get a card, which says **why it needs a human** ("Why you: …") and asks **Hold**, **Launch anyway** or **Cancel**. Cards sent before this change still carry **False alarm**, and that button still works.

**Authority limits:** the agent may always make a sortie safer and may never make one riskier. It never lifts a HOLD and never approves a launch. It never marks anything safe. It never adds a cell to a route: a reroute only drops the risky cells and keeps the rest of the planned route (a kept cell with no sensor coverage still gets the UNVERIFIED notice). It changes one sortie at a time, and the brake stops mass changes. Only allow-listed Telegram users can answer a card.

**Self-healing:** source failover inside the actor, an Apify-failure webhook, and a watchdog that raises a stale-data alarm after 15 min (the map goes grey). Every node error lands in `agent_log` and on Telegram. At 07:00 a morning report lists incidents, what the agent did, the resolution rate and any HOLDs still waiting for an officer.

### Real vs demo data (honesty note)

- **Real:** every aircraft, every NIC/NACp value and every aircraft-based incident comes from live ADS-B (adsb.lol / adsb.fi).
- **Simulated:** the drones. Their border-patrol MAVLink telemetry comes from `features/console/fleet.js` or `features/collect/sim-drone.js`, and every drone report says SIMULATED (in `agent_log`, on the map, on Telegram).
- **Demo:** the sorties. The 48 sorties of the *3rd Border Drone Sqn (DEMO, fictional)* are generated, but they are placed in cells that really had aircraft coverage, and the priority mix is fixed up front (12 priority / 24 routine / 12 low). Priority sorties always go to a human, so the mix drives the autonomous resolution rate.
- **Limits:** jamming seen at airliner altitude is a wide-area early warning. A weak, local, low-altitude jammer can be missed. That's exactly why AirGuard never says "safe".

### Ops console

`npm run console`, then open http://localhost:8787 (it listens on 127.0.0.1 only). The switch in the header flies the simulated drones in real time, 10× or 20× (`npm run console:demo` starts at 10×). Only the drones speed up: sorties launch at their sheet times and the pipeline keeps its 5-minute cycle. The unit's operations screen, live:

- **Live airspace:** the eastern flank drawn from `features/console/geo.js`, locked to that region (you can zoom in, not out). Cells come from `cell_status`, aircraft from the last collect, drones from the simulated fleet. Click a drone for its planned patrol path (dotted) and what it has flown on this pass (solid cyan), its telemetry, what its autopilot decided and what AirGuard decided. Click a cell for its evidence, or to place a simulated jammer or spoofer that only the simulated drones feel.
- **Fleet, Sorties, Agent log, Telegram, Pipeline:** the drones in the air and those kept on the ground; the Google Sheet (through its Supabase mirror) with the gate's latest decisions and the Telegram cards waiting for the officer; every `agent_log` line; a live copy of the Telegram ops group (every text and card AirGuard sends, each officer's tap and the answered card, from `telegram_log`); the live state of Apify, n8n WF1–WF8, Supabase Realtime, the sheet mirror and the Telegram bot.
- It updates by itself: Supabase Realtime for the data, server-sent events every 2 s for the fleet. Times are CEST; hover one for UTC.
- **Load demo plan** writes 60 fictional sorties (T-301…T-360) on 16 stretches of the border into the sheet through WF8: ten launched in the last 50 minutes, so ten drones fly at once, and fifty launch over the next 11 hours. The gate checks them every cycle, so real Telegram messages follow. To see every kind of message, put a simulated jammer on Lazdijai `54.0_23.5` within 20 minutes of loading: T-301's drone reports it, and the next cycle reroutes T-312 (text), asks about priority T-313 (card) and reschedules T-314 (text). **Remove demo sorties** takes every T-* row out again.
- `.env` needs the Supabase URL and anon key (the only values the browser gets), `N8N_*`, `APIFY_TOKEN`, `TELEGRAM_BOT_TOKEN`, `DRONE_INTAKE_TOKEN` and `CONSOLE_TOKEN`. Options: `--no-fleet`, `--fleet-speed=N`, `--mirror-real`.

### Setup

1. `cp .env.example .env` and fill in the values (Supabase, n8n API, Apify, Telegram, Google Sheet). Never commit `.env`.
2. Supabase: run `db/migrations/001_init.sql`, `002_drone_reports.sql`, `003_console.sql` and `004_telegram.sql`, in that order.
3. Apify: push `features/collect/actor`, add a */5 schedule and the two webhooks (`airguard-apify`, `airguard-apify-failed`).
4. n8n: create the credentials and import WF1–WF6 in the order given in [`docs/n8n-import.md`](docs/n8n-import.md), then WF7 (`features/collect/wf7-telemetry.json`, credential `AirGuard Drone Intake`) and WF8 (`features/console/wf8-console.json`, credential `AirGuard Console`).
5. Sorties: `node features/gate/gen-sorties.js`, then import the CSV into the sheet **"AirGuard Sorties"**, tab `sorties`.
6. Map: see [`docs/n8n-import.md`](docs/n8n-import.md#map-vercel). `?fixture=1` works without any backend.
7. Tests: `npm test` (Node ≥ 20, zero dependencies). Detection SQL: `bash features/detect/fixtures/run-fixtures.sh`.

### Layout

```
features/
  collect/   Person A  Apify actor (actor/), cell binning, WF1 Collect, WF4 Heal, WF7 drone telemetry, simulated drone
  detect/    Person C  detection SQL (sql/), SQL fixtures, WF2 Detect, WF5 Report
  gate/      Person B  the sortie gate (decide.js), Telegram actions and answers, WF3 Gate, WF6 Respond, demo sorties
  map/       Person C  the Leaflet map (one static index.html) deployed on Vercel
  console/             ops console (npm run console): server, simulated fleet, demo plan, WF8
db/migrations/         Supabase schema, 001-004, applied in order
shared/contracts/      CONTRACTS.md (binding shapes and names) + sample fixtures and their tests
docs/                  prd, plan, research, tasks, decisions, n8n import, evidence, video script, drone telemetry
.github/               CODEOWNERS, PR template, test workflow, sync-dev workflow
```

Each `features/*/evidence/` folder holds the proof captured from the hosted run. The `wf*.json` files are n8n exports with credential ids removed.

### Evidence

Everything below was captured from the unattended hosted run. The shot list and the exact query behind each shot are in [`docs/evidence.md`](docs/evidence.md).

- Best real incident, from detection to decision: `features/detect/evidence/`
- Failover and stale alarm: `features/collect/evidence/`
- Telegram card, tap and sheet update: `features/gate/evidence/`
- Morning report and map: `features/detect/evidence/`

---

# Team workflow

## Quick start (read this before you write a line of code)

```bash
git clone git@github.com:krishaanth5831/prosus-hackathon.git
cd prosus-hackathon
cp .env.example .env     # ask Krish for the real values
npm test                 # Node >= 20, zero dependencies
```

Then: **claim a slice in [`docs/TASKS.md`](docs/TASKS.md) before you start it**, and only edit files you own (see [Who owns what](#who-owns-what)).

---

## Branches

Two permanent branches. Everything else is temporary.

| Branch | What it is | Rules |
|---|---|---|
| `main` | **Default branch.** Always-working code. What we demo from. | Protected. PRs only from `dev`, Krish approves. No force-push. No direct commits. |
| `dev` | Integration branch: all work in progress. Feature PRs land here. | No force-push, no deletion. Should be working most of the time. Never gets PRs from `main`. |
| `name/feature` | Your work. Lives **hours, not days**. | Delete after merge. |

### The loop

```bash
git switch dev && git pull            # before EVERY task, not once a day
git switch -c krish/checkout-flow     # your-name/what-it-does

# ...build for 2-4 hours...

git push -u origin krish/checkout-flow
gh pr create --base dev               # always --base dev: the default branch is main
# someone skims it -> merge -> delete branch

git switch dev && git pull            # immediately, so you're never stale
```

If your branch has been open more than ~2 hours, pull `dev` into it. Conflicts compound —
three small merges are far cheaper than one big one at hour 40.

### dev -> main

**Every time the demo works end to end, merge `dev` into `main` and tag it.** PRs into `main` only ever come
from `dev`, never the other way round. When the merge lands, `.github/workflows/sync-dev.yml` fast-forwards
`dev` to the same commit, so the two branches never drift apart.

```bash
# PR dev -> main, Krish approves, merge. Then:
git switch main && git pull
git tag demo-v1 && git push --tags
```

This is the rule that keeps `main` honest. The failure mode of a two-branch model is
everything living on `dev` while `main` quietly rots back to the day-1 skeleton — at which
point "main always works" is a comforting lie. Tag every working state; if someone breaks
things at hour 47, we present the tag.

### Hard rules

- **Never force-push `main` or `dev`.** (Blocked server-side for everyone except Krish.)
- **Never rewrite history on a branch someone else has pulled.**
- **Nothing reaches `main` without Krish's approval.**
- If a branch can't merge within a day, it was scoped wrong — split it or merge it half-done behind a flag.

---

## Who owns what

Work is organised by feature folder, and every folder has one owner. The binding version of this table is in [`CLAUDE.md`](CLAUDE.md), which also holds the rules every Claude Code session in this repo follows.

| Who | Owns |
|---|---|
| Person A `krishaanth5831` | `features/collect/` |
| Person B `Atharva-cloud-1` | `features/gate/` |
| Person C `ShivamK12345` | `features/detect/`, `features/map/`, `README.md`, `docs/TASKS.md`, `docs/n8n-import.md`, `docs/video-script.md`, `docs/evidence.md` |
| Krish only (hot files) | `CLAUDE.md`, `db/`, `shared/`, `package.json`, `.github/`, `.gitignore`, `.env.example`, `docs/prd.md`, `docs/plan.md`, `docs/research.md`, `docs/SETUP_PROMPT.md` |
| Anyone | `docs/DECISIONS.md`: append one row at the end, never edit existing rows |

If you need a change in a file you don't own, ask its owner. Never edit a merged migration: add a new file in `db/migrations/`. Contract changes (`shared/contracts/`) get announced to everyone, because git merges a renamed field cleanly and the pipeline then breaks at runtime.

Slices are 2-4 hours, vertical and demo-visible, one PR each into `dev`. Review is a quick skim: does it run, does it delete anyone's work.

---

## Docs

- `docs/prd.md`: what AirGuard is and why · `docs/plan.md`: how it is built · `docs/research.md`: background research
- `shared/contracts/CONTRACTS.md`: shapes and names every part must follow (binding)
- `docs/TASKS.md`: the slices, who owned each, and where they ended up
- `docs/DECISIONS.md`: one-liners, "we picked X over Y because Z"
- `docs/n8n-import.md`: importing the workflows and deploying the map
- `docs/drone-telemetry.md`: the build prompt for the simulated drone GNSS telemetry slice (C12, WF7)
- `docs/evidence.md`, `docs/video-script.md`: the shot list and the demo video script
- `docs/SETUP_PROMPT.md`: the prompt used once to generate the repo structure
