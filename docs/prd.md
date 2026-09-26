---
type: prd
version: 1.0
date: 2026-09-26
status: Draft
owner: K7
tags: [prd, hackathon, drones, defense, autonomy, n8n, apify]
---

# PRD: AirGuard, the autonomous sortie guard
**Version:** 1.0 | **Date:** 26 Sep 2026 | **Status:** Draft
**Owner:** K7 | **Stakeholders:** Build Weekend judges (video round + live pitch); future pilot: one Baltic border-guard or ISR drone unit

How to build it: (C) Build Plan — AirGuard · Research: 00 Research/JamWatch — GPS Jamming Early Warning (Build Weekend 26)

---

## 1. Summary
Drone units on NATO's eastern flank plan their surveillance sorties hours ahead. The GPS picture doesn't hold still: jamming and spoofing zones around Kaliningrad, Belarus and the Gulf of Finland appear and move almost every day. A drone that launches into one drifts, gets lost, or crosses a border. AirGuard is a software-only agent. It uses aircraft overhead as free GPS-quality sensors, detects jamming zones as they form, and checks every upcoming sortie against them before launch. It acts on its own when the action makes a sortie *safer* (reschedule, cancel a low-priority sortie, HOLD). It calls a human for anything that would make a sortie *riskier*. **It never says "safe". It only says "blocked", "at risk", "unverified" or "no known issue".** Success means one real jamming event, handled end to end while nobody was watching, with a log that proves it.

## 2. Background & Context
**The pain is real and documented.**
- Units lose large numbers of commercial-grade drones to electronic warfare. Friendly jamming downs friendly drones too, and deconfliction is described as a first-order design problem.
- A lost border drone isn't just €10k–250k of hardware. It also means:
  - a coverage gap on the border
  - an airframe and data the other side can recover
  - escalation risk if it crosses the line

**The Baltic sees daily GNSS interference.** Tested 26 Sep: of 96 aircraft over the Baltic, 20 had degraded GPS integrity. Source: adsb.lol, free, no key. adsb.fi works as a fallback.

**How the sensing works.** Every ADS-B aircraft broadcasts NIC and NACp, which rate how much its GPS position can be trusted. One bad aircraft is noise. Many bad aircraft in one area at the same time is jamming.

**The gap.** Top-tier forces have classified EW intelligence and anti-jam hardware. Border guards and smaller ISR units fly commercial drones with neither. The public tools (gpsjam.org and similar maps) are passive maps that are usually a day old. No tool acts on *your* sorties, *now*.

**Why software, and why pre-launch.** AirGuard works before launch, so it needs no drone integration, no hardware and no classified access. It sits on top of however the unit plans today.

**The hackathon angle.** The event scores autonomy that "knows when to bring in a human and when to stop". AirGuard's core rule is exactly that boundary: it acts alone to make things safer and escalates to make things riskier.

## 3. Objective
**Enable border-guard and ISR drone units to stop sorties launching into GNSS-denied airspace without a person watching the jamming picture all night, so that fewer drones and patrol hours are lost.**

| Metric | Baseline | Target | Timeframe | Measured by |
|---|---|---|---|---|
| **Primary: autonomous resolution rate** (affected sorties resolved by the agent ÷ all affected sorties it acted on) | 0% (a human does it by hand) | **≥ 60%** on ≥ 1 real event | First unattended overnight run | `decisions.decided_by` |
| Detection → every affected sortie decided | Minutes to hours (manual) | Same 5-min cycle (< 60 s processing) | Every event | `incidents.opened_at` vs `decisions.ts` |
| Wrong auto-actions (agent made a sortie riskier on its own) | n/a | **0** | Whole run | Manual review of `decisions` |
| Unattended uptime | n/a | ≥ 95% of 5-min cycles ran | Overnight run | n8n executions list |
| Self-handled failures | n/a | ≥ 1 real failover logged | Overnight run | `agent_log` |

**Good enough at launch:** one real jamming incident that triggers at least one reschedule or cancel and one human-approval card, one failover, and a morning report. All of it must be in the logs with timestamps from when nobody was at the laptop.

> Honesty note: the resolution rate depends on the demo sortie mix (priority sorties always go to a human). The mix is fixed up front: 25% priority, 50% routine, 25% low. Say so in the video.

## 4. Market Segments
| Segment | Problem | Size | Today's workaround |
|---|---|---|---|
| **A: Border-guard drone units** (LT, LV, EE, PL, FI) | Patrol sorties along Kaliningrad/Belarus/Russia borders, where GNSS interference is daily | Unknown (open question) | Pilot checks apps/NOTAMs before launch; finds out mid-flight |
| **B: NATO eastern-flank ISR and reserve units on commercial drones** | No EW intel feed at small-unit level | Unknown | Word of mouth, lost airframes |
| **C (expansion): Civil operators in the same airspace** (inspection, survey, SAR) | Same jamming, same blind spot | Unknown | Same |

**Out of scope:**
- Frontline tactical units. Their jamming is local and low-altitude, so ADS-B at airliner altitude won't see it.
- Strike, targeting or weapons use of any kind.

## 5. Value Propositions
- **A and B get:**
  - Sorties stopped *before* launch instead of lost after it.
  - No night-watch headcount spent staring at a map.
  - One card on the phone for the few decisions that need an officer.
  - An auditable decision log per sortie.
- **C gets:** the same engine, sold per fleet.

**Why AirGuard and not the alternatives:**
1. **A sensor network that costs nothing:** live, unclassified GNSS-quality data from aircraft that are already flying.
2. **Explicit authority limits.** The agent can always make a sortie safer and never makes one riskier. That's easy to explain to a commander and easy to audit.
3. **It sits on top of any planner** (a spreadsheet today, fleet software later), so the unit replaces nothing.
4. **Against hardware:** anti-jam antennas cost thousands per drone and are often export-controlled. AirGuard protects the fleet a unit already has.

## 6. Solution

### Core rule
Never "safe" or "clear".
- A sortie with no known issue stays *planned* and is shown as "no known issue".
- Missing sensor data means **UNKNOWN**. UNKNOWN is never read as good.

### What the agent sees (cell states, rule-based, no LLM)
| State | Rule |
|---|---|
| **JAMMED** | 0.5° cell with ≥ 3 sensor aircraft and degraded ratio ≥ threshold (default 0.3) on **2 consecutive** checks. An aircraft is degraded if `nic < 7` or `nac_p < 8`. |
| **SPOOF** | ≥ 2 aircraft in the cell with a GPS-vs-barometric altitude gap above 1500 ft, on 2 consecutive checks |
| **UNKNOWN** | < 3 sensor aircraft, or no fresh data (older than 15 min) |
| **NO KNOWN ISSUE** | Enough aircraft, below threshold. Never labelled "clear" or shown green. |
| **MAY-LIFT** | A jammed cell has been below threshold for 30 min *with coverage*. The agent sends a notification only. |

### What the agent does (decision levels)
Sorties are checked every cycle. The agent **acts** on sorties launching within 2 h. It **watches** sorties launching 2–12 h out: it logs them as at risk and changes nothing, because jamming often clears.

| Level | When | Agent does | Human |
|---|---|---|---|
| WATCH | Route crosses a bad cell, launch is 2–12 h away | Logs "at risk" once | No |
| **L1 Reschedule** | Routine sortie, JAMMED cell, launch +2 h still fits its window | Moves the launch +2 h, notifies | No |
| **L2 Cancel** | Low-priority sortie, JAMMED cell | Cancels, notifies | No |
| **L3 HOLD** | Priority sortie, or a routine one with no slot left, or an UNKNOWN cell that was jammed in the last 6 h | HOLD + Telegram card | **Yes** |
| **L4 Spoof HOLD** | Any SPOOF cell on the route | HOLD + card, flagged as spoofing | **Always** |
| UNVERIFIED | Route has an UNKNOWN cell, launch < 1 h, no recent jamming | Notifies "no sensor coverage", changes nothing | Officer decides |
| **BRAKE** | One incident hits > 25% of upcoming sorties | HOLDs all of them (reversible), sends **one** batch card | **Yes** |

**Authority limits (hard rules):**
1. The agent never lifts a HOLD and never marks anything safe.
2. It never proposes a route through JAMMED, SPOOF or UNKNOWN cells.
3. Cancelling and rescheduling happen only one sortie at a time. The brake stops mass changes.
4. Only allow-listed Telegram users can answer a card.
5. The LLM writes briefings only. Every decision comes from rules and can be explained line by line.

### User stories
- As a **duty officer**, I load tomorrow's sorties once and go to sleep, so that I'm not watching a jamming map all night.
- As a **duty officer**, I'm woken only for sorties that need my call, and the evidence is on one card, so that I can decide in under a minute.
- As a **duty officer**, I can mark an alert as a false alarm, so that the agent gets less jumpy in that cell.
- As a **unit commander**, I get a 07:00 report of what happened, what the agent did and what my officers decided, so that I can trust or correct it.
- As an **investigator**, I can see the GNSS picture for the time and place of any decision, so that losses can be explained.

### Functional requirements
| # | Requirement | Priority | Notes |
|---|---|---|---|
| F1 | Apify actor polls adsb.lol from 3 Baltic points every 5 min and falls back to adsb.fi | Must | Apify schedule + webhook to n8n |
| F2 | Binning aircraft into 0.5° cells → `observations` | Must | Aircraft without NIC/NACp are not sensors |
| F3 | JAMMED / MAY-LIFT / close rules → `incidents`, one live incident per cell | Must | SQL, idempotent |
| F4 | Per-cycle sortie gate: levels WATCH/L1/L2/L3/UNVERIFIED + brake, deduplicated | Must | Pure JS function, unit-tested |
| F5 | Telegram card with 3 buttons (Keep HOLD / Launch anyway / False alarm) that updates the sortie | Must | Inline keyboard + Telegram Trigger |
| F6 | Plain-English `agent_log` line for every decision: what, why, outcome | Must | The key judge artifact |
| F7 | Self-healing: source failover, Apify-failure webhook, stale-data watchdog | Must | ≥ 1 real failover overnight |
| F8 | 48 demo sorties for a fictional border squadron, placed in cells that have real traffic, labelled DEMO | Must | Generated from observed cells |
| F9 | 07:00 morning report | Should | |
| F10 | Leaflet map: red (jammed), purple (spoof), grey (unknown), outline only for no known issue. **No green.** | Should | Read-only via Supabase RLS |
| F11 | Spoof detection (level L4) | Should | Enable after checking the real altitude-gap spread |
| F12 | Second Apify source: official GNSS-interference NOTAMs fused into confidence | Should | Only if a working source is verified |
| F13 | False-alarm tap raises the cell threshold (+0.05, max 0.6) | Could | |
| F14 | Loss investigator: GNSS picture for a given time and place | Could | One SQL query + Telegram command |
| F15 | Reroute proposal around bad cells, human approves | Could | Proposal only, never automatic |
| F16 | Drone GNSS reports (C12) from the unit's ground station as a second sensor for cells without aircraft; WF7 intake, fused into incidents and `cell_status` | Should | Demo data is simulated border-patrol MAVLink, labelled SIMULATED. Placed by planned leg, never by the drone's GPS. Spec: `docs/drone-telemetry.md` |

### Non-functional requirements
- **Hosting:** runs hosted 24/7 on Apify schedules, n8n Cloud and Supabase. Nothing runs on the laptop.
- **Polling:** ≤ 3 calls per 5 min per source, with 1.5 s spacing.
- **Time:** all times in UTC. Only the Telegram cards and the report show local time.
- **Secrets:** none in the repo or in notes. They live in n8n credentials and Apify env vars.
- **Audit:** every sortie state change writes a `decisions` row and an `agent_log` line.
- **Map:** read-only, using the Supabase anon key with select-only RLS.

### Out of scope
- Anything onboard the drone.
- Weapons or targeting.
- Real military sortie data or real drone telemetry (F16 runs on simulated reports).
- Classified sources.
- Auto-lifting HOLDs.
- An LLM in the decision path.
- Altitude-aware routing.
- Automatic rerouting.

### Edge cases & open questions
| Case / question | Handling / owner |
|---|---|
| Night: few aircraft, many cells UNKNOWN | UNVERIFIED notice, not a HOLD (unless the cell was jammed recently). No mass HOLDs every night. |
| Incident clears while a sortie is on HOLD | MAY-LIFT notification. The HOLD stays until a human lifts it. |
| Rescheduled sortie is still in a jammed cell | Re-checked when it comes back inside the 2 h window. Reschedules again or goes to L3. |
| Same cell double-counted from overlapping query circles | The actor dedupes aircraft by `hex` |
| A working NOTAM source for EE/LV/LT/PL/FI | K7, before building F12 |
| Apify free-tier compute for 288 runs/day | K7, at the Apify workshop (estimate: well under the $5 credit) |
| Final name: AirGuard or JamWatch | K7, before the video |

## 7. Assumptions & Risks
| Assumption | Evidence | If wrong… |
|---|---|---|
| **Jamming seen at airliner altitude is a useful early warning for drones** | Wide-area jammers affect every altitude, and the Baltic events are wide-area | Weak local jammers are missed. That's why it never says "safe" and is pitched as early warning, not a guarantee. |
| **Military units would trust an unclassified civil-data tool** | Unvalidated | Pitch it as an unclassified early-warning layer that sits beside classified feeds. Segment C is the fallback customer. |
| A jamming event happens inside coverage during the unattended run | 20/96 degraded at test time; daily public reports | 3 query points including the Gulf of Finland. UNKNOWN and failover handling still show autonomy. |
| Free APIs tolerate 5-min polling | No rate headers seen | Fallback source + watchdog |
| A 1500 ft altitude gap means spoofing | Common heuristic, but temperature also shifts barometric altitude | Check the real spread first. Require 2 aircraft on 2 checks. It stays Should. |

## 8. Release Plan
- **Phase 1: hackathon.** F1–F8 hosted and running unattended overnight. The video is built from the real logs.
  - Success: the §3 targets.
- **Phase 2: pilot.**
  - Trigger: a top-10 finish, or one unit or operator saying "we'd use this".
  - Scope: real sortie import (CSV), NOTAM layer, 30 days in **shadow mode** (the agent proposes, humans execute).
  - Success: ≥ 80% of proposals accepted, 0 missed jamming events that a unit reports.
- **Phase 3: product.**
  - Trigger: pilot success.
  - Scope: integrations (fleet software exports, national C2 via file drop), loss investigator, weather layer. Autonomy is earned per decision type: a decision type becomes automatic only after N accepted proposals.
