---
type: hackathon-project
event: Build Weekend 26 — Young Creators × Prosus
location: StartDock, Singel 126, Amsterdam
deadline: 2026-09-27 15:00
status: building
tags: [hackathon, defense, autonomy, n8n, apify, gnss]
---

# JamWatch — GPS Jamming Early Warning for Drone & Aviation Operators

> **One-liner:** An autonomous agent that uses aircraft overhead as free GPS-interference sensors, detects jamming zones as they form, and acts on specific planned flights. It never tells you it's safe to fly. It only tells you when it's not.

Working name: *JamWatch* (change freely).

---

## 1. Hackathon context

- **Rule:** the build must **act autonomously**: *"notices something, decides what to do, acts, learns, and tells you what happened."*
- **"Autonomous doesn't mean uncontrolled"**: judges want a system that knows what it handles alone, when to bring in a human, and when to stop.
- **Deadline:** video (max 2 min) due **Sunday 15:00**. Top 10 selected by 16:00 and pitch live at 16:15 (3 min pitch + ~5 min Q&A).
- **Team:** 2–4 people. Source: [Build Weekend Notion](https://youngcreatorscore.notion.site/build-weekend-26)

### Judging criteria → how JamWatch scores

| Criterion | Weight | Our answer |
|---|---|---|
| Autonomy | 25% | Runs every 5 min unattended. Opens and closes incidents, alerts, puts flights on HOLD, fails over by itself, has explicit escalation and stop rules (§5) |
| Proven in real use | 25% | Real live ADS-B data. Baltic jamming happens daily, so overnight unattended logs are near-guaranteed. Includes a handled failure (§6, WF4) |
| Apify & n8n | 20% | Apify = all data collection (ADS-B actor + NOTAM scraper + news/community corroboration). n8n = every workflow and decision (§6) |
| Problem fit | 15% | Specific: drone and small aviation operators in the Baltic/Poland/Finland fly into GNSS interference blind |
| Product & presentation | 15% | Live map with cells turning red, 3am incident log, Telegram HOLD alert. Strong visuals for a 2-min video |

---

## 2. The problem

- GNSS (GPS) jamming and spoofing is happening **daily** around the Baltic Sea, Kaliningrad, Poland, Finland and Estonia.
- Big airlines have crews trained for it. **Drone operators, survey and inspection firms, flight schools and small operators do not.** For them, losing GPS means a lost drone, a failed mission, or a safety incident.
- Existing tools (gpsjam.org, Flightradar24 overlays) are **passive maps, usually for the previous day**. Nobody acts on *your* flights, *now*.

**Verified at build time (Sat 26 Sep, ~11:40):** a single query to the free adsb.lol API for a 250 nm radius over the Baltic returned **96 aircraft, 20 with degraded GPS integrity** (NIC < 7 or NACp < 8). The signal is real and accessible with no API key.

---

## 3. How the sensing works

Every ADS-B-equipped aircraft broadcasts, alongside its position:
- **NIC** (Navigation Integrity Category): how much the position can be trusted
- **NACp** (Navigation Accuracy Category, position): how accurate it is

When GPS is jammed, these values drop. **One aircraft with a low value is noise. Many aircraft in the same area at the same time is jamming.**

Spoofing (fake positions) looks different: sudden position jumps, impossible speeds, and GPS altitude (`alt_geom`) disagreeing with barometric altitude (`alt_baro`).

### Detection logic (v1, keep it simple)
1. Split the region into a grid of **0.5° cells** (~50 km).
2. Every 5 minutes, per cell: `n_total`, `n_degraded`, `ratio = n_degraded / n_total`.
3. A cell is **JAMMED** when `n_total ≥ 3` **and** `ratio ≥ 0.3` for **2 consecutive checks** (the persistence rule avoids blips).
4. A cell is **UNKNOWN** when `n_total < 3` (not enough sensors). **Never "clear".**
5. A cell is **SPOOF-SUSPECT** when any aircraft shows a position jump > 5 km between checks at normal speed, or `|alt_geom − alt_baro|` > 1500 ft.
6. **Severity** = ratio × aircraft count × duration. Bumped one level if an official NOTAM confirms it.

### Confidence fusion (why Apify matters)
| ADS-B evidence | NOTAM / official notice | Confidence |
|---|---|---|
| Yes | Yes | **High** |
| Yes | No | Medium |
| No | Yes | "Declared, not observed" |
| Not enough aircraft | Any | **Unknown** |

---

## 4. Architecture

```
          ┌──────────── APIFY ────────────┐
          │ 1. ADS-B actor (grid polling, │
          │    primary + fallback API)    │
          │ 2. NOTAM scraper (GNSS notices)│
          │ 3. News/community scraper     │
          └──────────────┬────────────────┘
                         │ datasets / webhooks
          ┌──────────── n8n ──────────────┐
          │ WF1 Collect → WF2 Detect/Decide│
          │ → WF3 Act → WF5 Report/Learn   │
          │ WF4 Error handler / failover   │
          └───┬──────────────┬────────────┘
              │              │
        Supabase DB     Telegram / Slack
     (cells, incidents,   (alerts, HOLD,
      flights, logs)       approvals)
              │
        Leaflet map dashboard (Vercel)
```

### Data sources
| Source                                                           | Via                      | What for                                                        |
| ---------------------------------------------------------------- | ------------------------ | --------------------------------------------------------------- |
| adsb.lol `/v2/point/{lat}/{lon}/{radius_nm}` (aircraft under `ac`; needs a User-Agent, answers 403 to Node's default `node`) | Apify actor | Primary aircraft data (nic, nac_p, alt_geom, alt_baro, lat/lon) |
| adsb.fi `/api/v2/lat/{lat}/lon/{lon}/dist/{nm}` (readsb fields, but aircraft under `aircraft`, not `ac`) | Apify actor fallback | Failover when primary is down or rate-limited |
| airplanes.live (not checked)                                     | none yet                 | Possible second fallback                                        |
| FAA NOTAM search / national AIS sites (Finland, Estonia, Poland) | Apify scraper            | Official "GNSS INTERFERENCE" notices                            |
| News / aviation community posts                                  | Apify scraper (optional) | Corroboration and context for briefings                         |
| Client flight plans                                              | Google Sheet             | Simulated drone operator schedule (be honest about this)        |

> ⚠️ Check rate limits and terms of each API before the overnight run. Poll politely (every 5 min, a handful of points).

### Database tables (Supabase)
- `observations`: timestamp, cell_id, n_total, n_degraded, ratio, source
- `incidents`: id, cell_id, status (open/closed), type (jam/spoof), severity, confidence, opened_at, closed_at, notam_ref
- `flights`: id, operator, route (polyline or cell list), planned_time, status (planned/HOLD/rerouted/approved)
- `agent_log`: timestamp, workflow, action, reason, outcome. **This is the proof for the judges. Log everything in plain English.**
- `baselines`: cell_id, hour_of_day, normal_ratio, threshold (tuned by feedback)

---

## 5. Autonomy design — where the agent's authority ends

**Principle:** *"It never tells you it's safe. It can only tell you it's not."* Missing data = risk.

| Situation | Agent does | Human? |
|---|---|---|
| Jamming, no client flights nearby | Logs it, updates the map | No |
| Jamming near a planned flight, low severity | Alerts the operator with a briefing | No |
| Jamming overlaps a planned flight, high severity | **Sets the flight to HOLD automatically**, proposes a reroute or non-GPS fallback | Operator approves the reroute |
| Spoofing suspected | Escalates immediately, never proposes a route through it | **Always** |
| Primary data source down | Switches to fallback, logs it | No |
| All sources down / too few aircraft | Marks zones **UNKNOWN**, tells operators coverage is degraded | No, but flagged |
| Incident resolved (cell clean for 30 min) | Closes the incident, notifies operator that HOLD *may* be lifted | Operator lifts HOLD (the agent never auto-releases) |

**Stop conditions:** the agent never auto-releases a HOLD, never routes through spoofing, never reports "clear" without enough coverage.

**Learning:** operators can mark alerts "false alarm" via a Telegram button → that cell's threshold rises for that hour of day (stored in `baselines`). Show at least one example in the logs.

---

## 6. n8n workflows

### WF1 — Collect (Schedule: every 5 min)
1. Schedule trigger
2. Run the Apify ADS-B actor (or call its latest dataset)
3. Code node: assign each aircraft to a cell, compute n_total / n_degraded / ratio, flag spoof indicators
4. Insert into `observations`

### WF2 — Detect & Decide (triggered after WF1)
1. Load the last 2 observations per cell + baselines
2. Apply the detection rules (§3) → JAMMED / SPOOF-SUSPECT / UNKNOWN / normal
3. Open, update or close incidents
4. Pull the latest NOTAM dataset → fuse confidence
5. Write every decision + reason to `agent_log`

### WF3 — Act (on incident open/update)
1. Match the incident's cells against `flights` in the next X hours
2. LLM node writes a short operator briefing (where, severity, confidence, evidence, recommendation)
3. Low → Telegram alert. High → set flight to **HOLD** + Telegram "Send and wait for approval" with buttons: *Approve reroute / Keep on hold / False alarm*
4. Apply the answer, log it

### WF4 — Error handler / Self-healing (n8n Error Trigger)
1. Catch any failed execution
2. If an API failed → rerun with the fallback source, log "failover"
3. If coverage is too low → mark affected cells UNKNOWN, notify operators
4. **Make sure one real failure is in the logs** (e.g. block the primary endpoint for 10 min overnight) for the "failure it handled on its own" bonus

### WF5 — Daily report & learning (Schedule: 07:00)
1. Summarise the last 24h: incidents, flights held, failovers, false alarms
2. Update thresholds from feedback
3. Send the morning report to the operator (Telegram/email)

### Apify tasks (Schedule)
- ADS-B actor: every 5 min (or triggered by WF1)
- NOTAM scraper: every 30–60 min
- News scraper: every 1–2 h (optional, cut it first if short on time)

---

## 7. Dashboard (minimal)
- Leaflet map: grid cells coloured **green / red / purple (spoof) / grey (unknown)**
- Planned flights drawn as lines, HOLD in red
- Side panel: live `agent_log` feed in plain English
- Deploy on Vercel. It only needs to *look* clean; the logic lives in n8n.

---

## 8. Build timeline (now → Sun 15:00)

| When | What | Done? |
|---|---|---|
| Sat ~12:00–14:00 | Apify ADS-B actor + WF1 writing to Supabase. **Start collecting ASAP.** | [ ] |
| Sat 14:00 | Jet Skis workshop (optional) | |
| Sat 16:00 | **Apify workshop.** Go, and ask about scheduling actors and the NOTAM scraper | [ ] |
| Sat until 20:00 | WF2 detection + incidents + agent_log | [ ] |
| Sat until 23:00 | NOTAM scraper, WF4 failover. **Everything running before doors close.** | [ ] |
| Overnight | System runs unattended → real logs. Trigger one controlled failure. | [ ] |
| Sun 09:00–11:00 | WF3 alerts + HOLD/approval, WF5 report, map dashboard | [ ] |
| Sun 11:00–12:00 | Review the night's logs, pick the best 3am incident + failover, screenshot | [ ] |
| **Sun 12:00 — HARD STOP** | No new features. Record the video. | [ ] |
| Sun 14:30 | Submit (30 min buffer) | [ ] |

**Cut order if behind:** news scraper → learning loop → dashboard polish → spoofing detection. **Never cut:** overnight logs, HOLD + approval, failover.

---

## 9. Video script (≤ 2 min)

| Time | Shot | Line |
|---|---|---|
| 0:00–0:15 | Live map, red cells over the Baltic | "Right now, 1 in 5 aircraft over the Baltic is flying with degraded GPS. Drone operators find out when their drone does." |
| 0:15–0:35 | How it works (sensor diagram) | "JamWatch uses every aircraft overhead as a free GPS sensor. Apify collects the data, n8n decides and acts, every 5 minutes." |
| 0:35–1:05 | The 3am incident from the logs | "Last night at 3am, while we slept, it detected jamming, cross-checked an official notice, and put a survey flight on hold." |
| 1:05–1:25 | Telegram alert + approval buttons | "It holds automatically. Rerouting needs a human. It never says 'safe', only 'not safe' or 'unknown'." |
| 1:25–1:40 | Failover log | "At 04:12 our main data source went down. It switched sources by itself and flagged the gap." |
| 1:40–2:00 | Who pays + close | "Drone survey, inspection and training firms across the Baltic region. Early warning, on your flights, live." |

---

## 10. Pitch Q&A prep

- **"Aircraft fly at 10 km, drones at 100 m."** True. Jamming seen at altitude means a strong, wide-area jammer. Low-power local jammers can be missed. It's an early-warning layer, not a guarantee, which is why it never says "safe".
- **"What about night, when there are few flights?"** That's the UNKNOWN state. The system is honest about blind spots.
- **"gpsjam.org already exists."** It's a map of the previous day. We act on specific flights, live, with holds, approvals and audit logs.
- **"How do you avoid false alarms?"** Minimum aircraft count, persistence across 2 checks, per-cell baselines, NOTAM cross-checks, and operator feedback that tunes thresholds.
- **"Is the client real?"** The jamming data is real. The flight plans are a demo operator. (Upgrade: get one real drone firm to say "we'd use this".)
- **"Business model?"** SaaS per operator/fleet. Later: an incident log API for insurers and compliance reports.
- **"Why is this defense?"** GNSS interference is a hybrid-warfare tool. Resilience for civil operators on NATO's eastern flank is dual-use by nature.

---

## 11. Risks

| Risk | Mitigation |
|---|---|
| API rate limits / ToS | Poll politely, use a fallback source, check terms early |
| Apify looks bolted-on | Apify does *all* collection (ADS-B actor + NOTAMs + news), not a single API wrapper |
| No jamming event overnight | Very unlikely in the Baltic. Backup: widen the region to Poland/Finland |
| Overbuilding (the 80% pattern) | Hard stop at 12:00 Sunday. Cut order defined above |
| Laptop sleeps overnight | Run n8n Cloud / hosted instance + Apify schedules. **Don't rely on your laptop.** |

---

Related: 06 Ideas/Ideas · worked at a stealth startup
