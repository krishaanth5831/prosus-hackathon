# prosus-hackathon

**AirGuard: an autonomous pre-launch sortie guard that uses aircraft overhead as GPS-jamming sensors and holds, reschedules or cancels drone sorties before they launch into jammed airspace. It never says "safe".**

Apify (collection) → n8n Cloud (all logic) → Supabase Postgres → Google Sheet (sortie plan) → Telegram (human gate) → Leaflet map on Vercel.
What and why: `docs/prd.md` · how: `docs/plan.md` · contracts: `shared/contracts/CONTRACTS.md` · slices: `docs/TASKS.md` · rules for Claude Code: `CLAUDE.md`.

**Live map:** https://airguard-map.vercel.app (`?fixture=1` for the contract fixtures) · **Evidence:** [`docs/evidence.md`](docs/evidence.md) · **Video script:** [`docs/video-script.md`](docs/video-script.md)

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
 │ WF1 Collect ─► WF2 Detect ─► WF3 Gate ──► Telegram card (3 buttons)  │
 │                                              │                       │
 │ WF6 Respond ◄── Telegram Trigger (button tap)┘                       │
 │ WF4 Heal (Error Trigger + Apify failure + stale watchdog)            │
 │ WF5 Report (07:00)                                                   │
 └──────────┬───────────────────────────────┬───────────────────────────┘
            ▼                               ▼
   Supabase Postgres                  Google Sheet "AirGuard Sorties"
   observations, incidents,           (the unit's sortie plan)
   decisions, agent_log, baselines
            ▲ read-only (RLS, anon key)
   Leaflet map on Vercel
```

- **Apify** does all the collecting: 3 Baltic query points, adsb.lol with automatic failover to adsb.fi, deduped by aircraft.
- **n8n** does all the logic. Detection is plain SQL (`features/detect/sql/`) and the sortie gate is a pure, unit-tested JS function (`features/gate/decide.js`). **No LLM is in the decision path.**
- The gate is **state-based**: every cycle it compares all upcoming sorties with the current cell picture. A unique `decisions.key` makes each action happen exactly once, even when two runs overlap.

### Autonomy and the human gate

The agent **acts** on sorties launching within 2 h and **watches** sorties launching 2–12 h out.

| Situation | Level | Agent does on its own | Human? |
|---|---|---|---|
| Route crosses a bad cell, launch 2–12 h away | WATCH | Logs "at risk" once, changes nothing (jamming often goes away) | No |
| Routine sortie, JAMMED cell, launch +2 h still fits its window | **L1 Reschedule** | Moves the launch +2 h, notifies | No |
| Low-priority sortie, JAMMED cell | **L2 Cancel** | Cancels, notifies | No |
| Priority sortie · routine with no slot left · UNKNOWN cell jammed in the last 6 h | **L3 HOLD** | HOLD + Telegram card | **Yes** |
| Any SPOOF cell on the route | **L4 Spoof HOLD** | HOLD + card flagged as spoofing | **Always** |
| UNKNOWN cell, launch < 1 h, no recent jamming | UNVERIFIED | Notifies "no sensor coverage", changes nothing | Officer decides |
| One incident hits > 25% of upcoming sorties | **BRAKE** | HOLDs all of them (reversible), sends **one** batch card | **Yes** |

**Authority limits:** the agent may always make a sortie safer and may never make one riskier. It never lifts a HOLD. It never marks anything safe. It never routes through a JAMMED, SPOOF or UNKNOWN cell. It changes one sortie at a time, and the brake stops mass changes. Only allow-listed Telegram users can answer a card: **Keep HOLD**, **Launch anyway** or **False alarm**. A false alarm raises that cell's threshold by 0.05.

**Self-healing:** source failover inside the actor, an Apify-failure webhook, and a watchdog that raises a stale-data alarm after 15 min (the map goes grey). Every node error lands in `agent_log` and on Telegram. At 07:00 a morning report lists incidents, what the agent did, the resolution rate and any HOLDs still waiting for an officer.

### Real vs demo data (honesty note)

- **Real:** every aircraft, every NIC/NACp value and every jamming incident comes from live ADS-B (adsb.lol / adsb.fi). Nothing on the map is simulated.
- **Demo:** the sorties. The 48 sorties of the *3rd Border Drone Sqn (DEMO, fictional)* are generated, but they are placed in cells that really had aircraft coverage, and the priority mix is fixed up front (12 priority / 24 routine / 12 low). Priority sorties always go to a human, so the mix drives the autonomous resolution rate.
- **Limits:** jamming seen at airliner altitude is a wide-area early warning. A weak, local, low-altitude jammer can be missed. That's exactly why AirGuard never says "safe".

### Setup

1. `cp .env.example .env` and fill in the values (Supabase, n8n API, Apify, Telegram, Google Sheet). Never commit `.env`.
2. Supabase: run `db/migrations/001_init.sql`.
3. Apify: push `features/collect/actor`, add a */5 schedule and the two webhooks (`airguard-apify`, `airguard-apify-failed`).
4. n8n: create the five credentials and import WF1–WF6 in the order given in [`docs/n8n-import.md`](docs/n8n-import.md).
5. Sorties: `node features/gate/gen-sorties.js`, then import the CSV into the sheet **"AirGuard Sorties"**, tab `sorties`.
6. Map: see [`docs/n8n-import.md`](docs/n8n-import.md#map-vercel). `?fixture=1` works without any backend.
7. Tests: `npm test` (Node ≥ 20, zero dependencies). Detection SQL: `bash features/detect/fixtures/run-fixtures.sh`.

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

Then: **claim a task on the board before you start it.** Nothing else in this README matters as much as that line.

---

## Branches

Two permanent branches. Everything else is temporary.

| Branch | What it is | Rules |
|---|---|---|
| `main` | Always-working code. What we demo from. | Protected. PR only, Krish approves. No force-push. No direct commits. |
| `dev` | Integration branch. Default branch — PRs land here. | No force-push, no deletion. Should be working most of the time. |
| `name/feature` | Your work. Lives **hours, not days**. | Delete after merge. |

### The loop

```bash
git switch dev && git pull            # before EVERY task, not once a day
git switch -c krish/checkout-flow     # your-name/what-it-does

# ...build for 2-4 hours...

git push -u origin krish/checkout-flow
# open PR into dev -> someone skims it -> merge -> delete branch

git switch dev && git pull            # immediately, so you're never stale
```

If your branch has been open more than ~2 hours, pull `dev` into it. Conflicts compound —
three small merges are far cheaper than one big one at hour 40.

### dev -> main

**Every time the demo works end to end, merge `dev` into `main` and tag it.**

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

## Code structure: vertical slices

Once we pick the idea, we organise **by feature, not by layer**:

```
src/
  features/
    auth/          # UI + API calls + types for auth, all together
    <feature>/
    <feature>/
  shared/          # only things genuinely used by 3+ features
  lib/             # api client, db client, config
```

Why: layer-based folders (`components/`, `services/`, `utils/`) force all 5 of us into the
same files all weekend. Feature folders mean a task **is** a folder — you live in
`features/checkout/` for three hours and touch nothing anyone else is in. We get
collision-free work without permanently assigning anyone an area.

**Colocate aggressively.** Component, hook, styles, API call and types for a feature stay in
its folder. Duplication between features is fine at hackathon scale — a premature `shared/`
abstraction drags everyone back into the same files, which is the exact thing we're avoiding.

---

## Hot files (where conflicts actually happen)

Feature folders kill ~90% of conflicts. The rest land in these, so handle them deliberately:

| File | Rule |
|---|---|
| Router / route registry | Keep it one line per feature. **Append at the end**, never edit the middle. |
| DB schema / migrations | **Krish owns it.** Never edit a merged migration — add a new file. |
| Shared types / API contract | **Krish owns it.** Every change gets announced out loud. |
| `package.json` / lockfiles | Whoever adds a dep says so and merges within minutes. Don't hand-resolve a lockfile — take the base version and re-run install. |
| App entry / env config | Touch it, announce it, merge it fast. |

Silent breakage comes from the type/schema files: git merges a renamed field perfectly
cleanly and the app is broken at runtime. That's why they have one owner.

---

## Workflow

**The board is the source of truth.** GitHub Projects / Notion / whiteboard — doesn't matter,
as long as everyone can see it.

- **Nothing is worked on until it's on the board with your name on it.** Two people silently
  building the same thing costs more than any merge conflict.
- **Tasks are 2-4 hours and vertical:** "checkout flow end to end with fake payment", not
  "write the checkout service". Slice-shaped tasks map onto feature folders; layer-shaped ones don't.
- **Say it in the room:** *"I'm in `features/map` and the router for the next two hours."*
  One sentence prevents most collisions.
- **Review is a 2-minute skim**, not a code review: does it run, does it delete anyone's work.
  No PR sits longer than ~15 minutes — poke people out loud, don't wait on notifications.

### Roles

- **Integrator (Krish)** — owns `main`, shared types, schema, deploy, and the ugly conflicts.
- **Demo owner** — from the halfway point, their job is the 3-minute presentation, not features.
  Hackathons are won by the demo; teams that leave it to the last hour lose to worse code with a better story.
- **Everyone else** — build. Pair up on the two hardest tracks; 5 people is rarely 5 real workstreams.

### Cadence

- **Sync every ~4 hours, 2 minutes, standing:** what's merged / what you're on / what's blocking you.
- **Feature freeze ~4 hours before submission.** Bug fixes only after that.
- **Practice the demo twice on the deployed URL**, not localhost.

---

## Day 1 checklist

Before anyone writes a feature:

- [ ] Pick the idea, then run the prompt in `docs/SETUP_PROMPT.md` to generate the structure
- [ ] Push a **skeleton that runs** — empty pages, `/health` returning 200, hardcoded fake data.
      Everyone should clone something that already starts.
- [ ] **Lock the API contract** — endpoints + request/response JSON, written down. Frontend builds
      against mocks, backend fills them in, neither waits on the other.
- [ ] Fill `.env.example` with every key anyone needs
- [ ] Everyone runs the app locally and confirms it starts
- [ ] Board created, first ~10 tasks sliced

## Before the hackathon

Install the stack and run a hello-world **this week**. Wrong runtime version, missing
CUDA, an API key nobody has — environment setup routinely eats the first 3 hours of a
hackathon and is entirely preventable now.

---

## Docs

- `docs/SETUP_PROMPT.md` — the one prompt to run once we pick the idea
- `docs/DECISIONS.md` — one-liners: "we picked X over Y because Z"
