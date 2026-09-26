# Video script (≤ 2 min)

Owner: Person C. Adapted from `docs/research.md` §9 to AirGuard. Every `{…}` is a placeholder for a real value from the overnight run. Take each value from the query named in `docs/evidence.md` (shot numbers in brackets). **Say nothing the logs can't show.**

Target: 1:55. About 130 words per minute, so each line is timed at speaking pace.

| Time | Shot (screen) | Voice-over |
|---|---|---|
| 0:00–0:12 | **Map, live** [E7]: red cells around Kaliningrad and the Gulf of Finland. Slow zoom. | "Right now, {N_DEGRADED} of {N_TOTAL} aircraft over the Baltic are flying with degraded GPS. A border-guard drone launched into that goes blind, drifts, or crosses the border." |
| 0:12–0:30 | **Sensor diagram** (README architecture) → Apify run list → n8n canvas of WF2. | "AirGuard uses every airliner overhead as a free GPS sensor. Apify collects them every five minutes. n8n turns them into jammed cells with plain SQL: at least three aircraft, two checks in a row. No LLM decides anything." |
| 0:30–0:40 | **Sheet "AirGuard Sorties"**: 48 rows, `DEMO` in the unit name. | "This is tomorrow's plan for a fictional border drone squadron. The sorties are demo data. The jamming is real." |
| 0:40–1:05 | **The night incident** [E1, E2]: `agent_log` lines scroll, timestamps highlighted `{T_INCIDENT_LOCAL}`. Cut to the sheet rows changing. | "Last night at {T_INCIDENT_LOCAL}, while we slept, cell {CELL} went red: {EVIDENCE}. Within the same cycle AirGuard rescheduled {N_L1} routine sorties, cancelled {N_L2} low-priority ones, and put priority sortie {SORTIE_HOLD} on HOLD." |
| 1:05–1:22 | **Telegram card** [E3] on the phone: `⛔ HOLD · {SORTIE_HOLD}`, three buttons. A thumb taps *Keep HOLD*. The card updates and the sheet shows `decided_by = human:…`. | "Making a sortie safer, it does alone. Making one riskier needs an officer: one card, three buttons, decided in seconds. It never lifts a HOLD. It never says 'safe'. Only blocked, at risk, unverified, or no known issue." |
| 1:22–1:35 | **Failover** [E4]: `SWITCH SOURCE TO ADSB.FI` line at `{T_FAILOVER_LOCAL}`, then the stale alarm and the map going grey [E5]. | "At {T_FAILOVER_LOCAL} our main data source went down. It switched sources by itself and logged why. When data went stale, the map went grey: no data means unknown, never fine." |
| 1:35–1:45 | **Morning report** [E6] on the phone at 07:00. | "At seven it briefed the commander: {N_INCIDENTS} incidents, {RATE}% of affected sorties resolved without waking anyone, {N_PENDING} HOLDs waiting for a decision." |
| 1:45–1:55 | **Map + README one-liner.** | "AirGuard. Pre-launch jamming guard for the drone units already on the eastern flank. No hardware, no classified feeds, and it never says safe." |

## Placeholders → source

| Placeholder | Source ([shot] in `docs/evidence.md`) |
|---|---|
| `{N_DEGRADED}`, `{N_TOTAL}` | E7 query: sum over the latest cycle |
| `{T_INCIDENT_LOCAL}`, `{CELL}`, `{EVIDENCE}` | E1: `opened_at` shown in Europe/Amsterdam time |
| `{N_L1}`, `{N_L2}`, `{SORTIE_HOLD}` | E2: decisions for that incident |
| `{T_FAILOVER_LOCAL}` | E4 |
| `{N_INCIDENTS}`, `{RATE}`, `{N_PENDING}` | E6: the report message itself |

## Rules for the edit

- Burn the UTC timestamp into every log shot, and say local time in the voice-over.
- Show the word `DEMO` on screen once while the sorties are shown.
- No green in any overlay, lower-third or transition.
- If the night had no incident with sorties inside the 2 h window, replace 0:40–1:05 with the best real incident + WATCH lines, and say so. Never stage a "real" incident from fixture data.
