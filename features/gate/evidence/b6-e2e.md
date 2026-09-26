# B6: WF3 Gate + WF6 Respond end to end on test cell 89.5_179.0 (2026-09-26)

Everything below ran live: n8n Cloud, Supabase, the sheet "AirGuard Sorties" and the Telegram group "AirGuard Ops".
Only test data was used: sorties `T-*`, cell `89.5_179.0`, and quiet fillers in the empty cell `89.0_179.0`. All of it was deleted afterwards (see Cleanup).

## Result

- **Every level** came out of one WF3 run exactly as `decide.js` predicted locally beforehand: L3 (priority), L1, L3 (routine without a slot), L2, WATCH (5 h out).
- **Every button** changed the sheet: Keep HOLD, Launch anyway, False alarm, Keep HOLD (all), False alarm (all). Each card was then edited to show the outcome, with its buttons removed.
- **A tap from a non-allowlisted account was refused** twice: a "Not authorised" alert and a log line, and nothing else changed.
- **A double tap** on the same button was answered "Already answered"; the claim in `claim.sql` is atomic.
- **Running WF3 again changed nothing**. After phase A (runs 2 and 3) and at the end (run 6), `decide` returned 0 items.
- **The BRAKE** tripped when one incident touched 9 of 29 upcoming sorties (31%): one batch card, no cancels or reschedules.
- **False alarm** raised the cell threshold 0.30 → 0.35 → 0.40 and closed each incident with `[false alarm: <name>]`.

## Setup

- n8n: `AirGuard WF3 Gate` (id `Le4bs7kBbUkQs0QD`) and `AirGuard WF6 Respond` (id `Hgy90vEntiE4A95h`), imported through the API from the repo exports, Config from `.env`, error workflow WF4.
  - WF3 is **published**: this n8n refuses to publish a workflow whose Execute Workflow node calls an unpublished one, which will hold for WF2 → WF3 too. WF3 has no trigger of its own, so it only runs when called.
  - WF6 is active. It is the bot's only Telegram Trigger; Telegram `getWebhookInfo` shows `allowed_updates: [callback_query]`.
  - WF3 runs were started by a temporary harness workflow (webhook → Execute WF3, plus sheet add/delete limited to `T-*` rows), deleted afterwards.
- `AirGuard LLM`: no such credential exists yet. The LLM briefing node returned `Credentials not found`, continued (`onError: continueRegularOutput`) and every card used the plan's template line.
- Supabase: incident #9 (JAMMED, open, high, `4/5 aircraft degraded, 2 checks in a row`) and 2 observations 5 min apart (5 aircraft, 4 degraded) on `89.5_179.0`. Phase B used incident #10 and 2 more observations.
- Sheet, phase A: T-001..T-006 on `89.5_179.0`, launching in 90 min (T-005: 5 h). Plus 20 fillers T-101..T-120 in `89.0_179.0`, 3–11 h out.
  - The fillers make no decision (an UNKNOWN cell only matters inside 1 h); they keep one incident at 6 of 26 upcoming sorties (23%), under the 25% brake.
  - Without them, the sheet (otherwise empty) would have put every test sortie into one BRAKE batch.

## Phase A, WF3 run 1 (execution 40, 20:58:01 UTC)

| node | items out |
|---|---|
| Start | 1 |
| Config | 1 |
| Read sorties | 26 |
| Cell status | 121 |
| Done keys | 1 |
| Recent incidents | 1 |
| decide | 6 |
| Decision rows | 6 |
| Insert decisions | 6 |
| Acted | 6 |
| Switch level | 2 / 3 / 0 / 0 |
| Update sheet | 2 |
| Telegram FYI | 2 |
| HOLD in sheet | 3 |
| LLM briefing | 3 |
| Card | 3 |
| Telegram card | 3 |
| agent_log lines | 6 |
| Insert agent_log | 6 |

Telegram, as delivered in the group (times are local, Europe/Amsterdam):

```
🔁 RESCHEDULED · T-002 · 3rd Border Drone Sqn (DEMO, fictional) · launch 00:27 → 02:27
JAMMED cell 89.5_179.0 (high): 4/5 aircraft degraded, 2 checks in a row
Agent: moved +2 h, still inside its window. FYI, no answer needed.
```
```
✖️ CANCELLED · T-004 · 3rd Border Drone Sqn (DEMO, fictional) · launch 00:27
JAMMED cell 89.5_179.0 (high): 4/5 aircraft degraded, 2 checks in a row
Agent: cancelled this low-priority sortie. FYI, no answer needed.
```
```
⛔ HOLD · T-001 · 3rd Border Drone Sqn (DEMO, fictional) · launch 00:27
JAMMED cell 89.5_179.0 (high): 4/5 aircraft degraded, 2 checks in a row
Agent: held. Needs your call. It never says safe.
[Keep HOLD = k|T-001|1] [Launch anyway = l|T-001|1] [False alarm = f|T-001|1]
```
```
⛔ HOLD · T-003 · 3rd Border Drone Sqn (DEMO, fictional) · launch 00:27
JAMMED cell 89.5_179.0 (high): 4/5 aircraft degraded, 2 checks in a row
Agent: held. Needs your call. It never says safe.
[Keep HOLD = k|T-003|3] [Launch anyway = l|T-003|3] [False alarm = f|T-003|3]
```
```
⛔ HOLD · T-006 · 3rd Border Drone Sqn (DEMO, fictional) · launch 00:27
JAMMED cell 89.5_179.0 (high): 4/5 aircraft degraded, 2 checks in a row
Agent: held. Needs your call. It never says safe.
[Keep HOLD = k|T-006|6] [Launch anyway = l|T-006|6] [False alarm = f|T-006|6]
```

`decisions`, inserted before anything was acted on:

| id | key | level | new_launch_at | human_answer (at the end) |
|---|---|---|---|---|
| 1 | `T-001\|9\|2026-09-26T22:27:26Z` | L3_HOLD |  | launch |
| 2 | `T-002\|9\|2026-09-26T22:27:26Z` | L1_RESCHEDULE | 2026-09-27T00:27:26.000Z |  |
| 3 | `T-003\|9\|2026-09-26T22:27:26Z` | L3_HOLD |  | keep |
| 4 | `T-004\|9\|2026-09-26T22:27:26Z` | L2_CANCEL |  |  |
| 5 | `T-005\|9\|watch` | WATCH |  |  |
| 6 | `T-006\|9\|2026-09-26T22:27:26Z` | L3_HOLD |  | false_alarm |

## Taps (WF6)

Krishaanth (allowlisted) answered the three phase A cards within seconds of their arrival. Atharva, not yet on the allowlist, then did the refusal test on the phase B batch card. After that he was added to the allowlist and answered both batch cards.

| execution | UTC | who | button | path | toast | card now ends with |
|---|---|---|---|---|---|---|
| 42 | 20:58:22 | Krishaanth | `l\|T-001\|1` | Parse tap → Claim → Outcome → sheet → log → answer → edit | Launch approved: T-001 | 🚀 Launch approved by Krishaanth at 22:58. The agent did not approve it. |
| 43 | 20:58:23 | Krishaanth | `l\|T-001\|1` | Parse tap → Claim → Outcome → sheet → log → answer → edit | Already answered. Nothing changed. | Already answered. Nothing changed. |
| 44 | 20:58:28 | Krishaanth | `f\|T-006\|6` | Parse tap → Claim → Outcome → sheet → log → answer → edit | False alarm: T-006 back to PLANNED | ↩️ False alarm by Krishaanth at 22:58: T-006 back to PLANNED. Cell 89.5_179.0 threshold now 0.35, incident 9 closed. |
| 45 | 20:58:30 | Krishaanth | `k\|T-003\|3` | Parse tap → Claim → Outcome → sheet → log → answer → edit | Kept on HOLD: T-003 | ✋ Kept on HOLD by Krishaanth at 22:58. |
| 56 | 21:01:58 | Atharva | `bk\|10` | refused | Not authorised: your Telegram account is not on the AirGuard allowlist. Nothing changed. | (card untouched) |
| 57 | 21:02:19 | Atharva | `bk\|10` | refused | Not authorised: your Telegram account is not on the AirGuard allowlist. Nothing changed. | (card untouched) |
| 59 | 21:03:11 | Atharva | `bk\|10` | Parse tap → Claim → Outcome → sheet → log → answer → edit | Kept on HOLD: 7 sorties | ✋ All 7 kept on HOLD by Atharva at 23:03. |
| 65 | 21:04:04 | Atharva | `bf\|10` | Parse tap → Claim → Outcome → sheet → log → answer → edit | False alarm: 6 sorties back to PLANNED | ↩️ False alarm by Atharva at 23:04: 6 sorties back to PLANNED. Cell 89.5_179.0 threshold now 0.40, incident 10 closed. |

## Running WF3 again (executions 47 and 49, 20:58:46 and 20:58:49 UTC)

`decide` returned 0 items both times, so nothing was inserted, changed, sent or logged. By then Krishaanth's False alarm had closed incident #9, and held or cancelled sorties are never gated again.

## Phase B: the brake, the refusal and the batch buttons

WF3 run 4 (execution 55, 21:01:51 UTC) ran with incident #10 open and T-007..T-012 added. The incident touched 9 of 29 upcoming sorties (31% > 25%):

```
⛔ BRAKE · incident 10 · 7 sorties held
JAMMED cell 89.5_179.0 (high): 5/6 aircraft degraded, 2 checks in a row
T-006 00:27 · T-007 00:35 · T-008 00:39 · T-009 00:43 · T-010 00:47 · T-011 00:51 · T-012 00:55
Agent: held all of them. Needs your call. It never says safe.
[Keep HOLD (all) = bk|10] [False alarm (all) = bf|10]
```

The two sorties 2–12 h out (T-002, T-005) got WATCH. Every other affected sortie was held, and none was cancelled or rescheduled.

WF3 run 5 (execution 64, 21:03:52 UTC) ran after T-013..T-018 were added and gave a second batch card for the same incident, answered with **False alarm (all)**:

```
⛔ BRAKE · incident 10 · 6 sorties held
JAMMED cell 89.5_179.0 (high): 5/6 aircraft degraded, 2 checks in a row
T-013 00:40 · T-014 00:44 · T-015 00:48 · T-016 00:52 · T-017 00:56 · T-018 01:00
Agent: held all of them. Needs your call. It never says safe.
[Keep HOLD (all) = bk|10] [False alarm (all) = bf|10]
```

WF3 run 6 (execution 69, 21:04:35 UTC): `decide` returned 0 items. Counts before and after: `decisions` 21 → 21, `agent_log` 46 → 46.

## Sheet at the end (test rows)

| sortie | priority | launch_at | status | decided_by | note |
|---|---|---|---|---|---|
| T-001 | priority | 2026-09-26T22:27:26Z | LAUNCH_APPROVED | human:Krishaanth | launch approved by Krishaanth at 20:58 UTC despite: JAMMED cell 89.5_179.0 (high): 4/5 ... |
| T-002 | routine | 2026-09-27T00:27:26Z | RESCHEDULED | agent | moved +2 h 22:27→00:27 UTC: JAMMED cell 89.5_179.0 (high): 4/5 aircraft degraded, 2 che... |
| T-003 | routine | 2026-09-26T22:27:26Z | HOLD | human:Krishaanth | HOLD kept by Krishaanth at 20:58 UTC: JAMMED cell 89.5_179.0 (high): 4/5 aircraft degra... |
| T-004 | low | 2026-09-26T22:27:26Z | CANCELLED | agent | cancelled: JAMMED cell 89.5_179.0 (high): 4/5 aircraft degraded, 2 checks in a row |
| T-005 | routine | 2026-09-27T01:57:26Z | PLANNED |  |  |
| T-006 | priority | 2026-09-26T22:27:26Z | HOLD | human:Atharva | HOLD kept by Atharva at 21:03 UTC: JAMMED cell 89.5_179.0 (high): 5/6 aircraft degraded... |
| T-007 | routine | 2026-09-26T22:35:10Z | HOLD | human:Atharva | HOLD kept by Atharva at 21:03 UTC: JAMMED cell 89.5_179.0 (high): 5/6 aircraft degraded... |
| T-008 | routine | 2026-09-26T22:39:10Z | HOLD | human:Atharva | HOLD kept by Atharva at 21:03 UTC: JAMMED cell 89.5_179.0 (high): 5/6 aircraft degraded... |
| T-009 | routine | 2026-09-26T22:43:10Z | HOLD | human:Atharva | HOLD kept by Atharva at 21:03 UTC: JAMMED cell 89.5_179.0 (high): 5/6 aircraft degraded... |
| T-010 | routine | 2026-09-26T22:47:10Z | HOLD | human:Atharva | HOLD kept by Atharva at 21:03 UTC: JAMMED cell 89.5_179.0 (high): 5/6 aircraft degraded... |
| T-011 | routine | 2026-09-26T22:51:10Z | HOLD | human:Atharva | HOLD kept by Atharva at 21:03 UTC: JAMMED cell 89.5_179.0 (high): 5/6 aircraft degraded... |
| T-012 | routine | 2026-09-26T22:55:10Z | HOLD | human:Atharva | HOLD kept by Atharva at 21:03 UTC: JAMMED cell 89.5_179.0 (high): 5/6 aircraft degraded... |
| T-013 | routine | 2026-09-26T22:40:10Z | PLANNED | human:Atharva | false alarm (Atharva, 21:04 UTC): JAMMED cell 89.5_179.0 (high): 5/6 aircraft degraded,... |
| T-014 | routine | 2026-09-26T22:44:10Z | PLANNED | human:Atharva | false alarm (Atharva, 21:04 UTC): JAMMED cell 89.5_179.0 (high): 5/6 aircraft degraded,... |
| T-015 | routine | 2026-09-26T22:48:10Z | PLANNED | human:Atharva | false alarm (Atharva, 21:04 UTC): JAMMED cell 89.5_179.0 (high): 5/6 aircraft degraded,... |
| T-016 | routine | 2026-09-26T22:52:10Z | PLANNED | human:Atharva | false alarm (Atharva, 21:04 UTC): JAMMED cell 89.5_179.0 (high): 5/6 aircraft degraded,... |
| T-017 | routine | 2026-09-26T22:56:10Z | PLANNED | human:Atharva | false alarm (Atharva, 21:04 UTC): JAMMED cell 89.5_179.0 (high): 5/6 aircraft degraded,... |
| T-018 | routine | 2026-09-26T23:00:10Z | PLANNED | human:Atharva | false alarm (Atharva, 21:04 UTC): JAMMED cell 89.5_179.0 (high): 5/6 aircraft degraded,... |

## Incidents and baselines at the end

| incident | type | status | opened | closed | evidence |
|---|---|---|---|---|---|
| #9 | JAMMED | closed | 20:57:37 | 20:58:28 | 4/5 aircraft degraded, 2 checks in a row [false alarm: Krishaanth] |
| #10 | JAMMED | closed | 21:01:40 | 21:04:04 | 5/6 aircraft degraded, 2 checks in a row [false alarm: Atharva] |

`baselines`: `89.5_179.0 threshold 0.4, false_alarms 2` (started at the default 0.3).

## agent_log (42 lines, all from this test)

```
20:58:06 WF3 · HOLD T-001 · JAMMED cell 89.5_179.0 (high): 4/5 aircraft degraded, 2 checks in a row; priority sortie, a human decides · sheet HOLD, card sent, awaiting duty officer
20:58:06 WF3 · RESCHEDULE T-002 · JAMMED cell 89.5_179.0 (high): 4/5 aircraft degraded, 2 checks in a row; routine, +2 h still inside its window · launch 22:27→00:27 UTC, sheet RESCHEDULED, FYI sent
20:58:06 WF3 · HOLD T-003 · JAMMED cell 89.5_179.0 (high): 4/5 aircraft degraded, 2 checks in a row; routine, no slot left in its window · sheet HOLD, card sent, awaiting duty officer
20:58:06 WF3 · CANCEL T-004 · JAMMED cell 89.5_179.0 (high): 4/5 aircraft degraded, 2 checks in a row; low priority · sheet CANCELLED, FYI sent
20:58:06 WF3 · WATCH T-005 · JAMMED cell 89.5_179.0 (high): 4/5 aircraft degraded, 2 checks in a row; launch in 5 h · at risk, logged once; nothing changed (jamming often goes away before launch)
20:58:06 WF3 · HOLD T-006 · JAMMED cell 89.5_179.0 (high): 4/5 aircraft degraded, 2 checks in a row; priority sortie, a human decides · sheet HOLD, card sent, awaiting duty officer
20:58:24 WF6 · IGNORE TAP T-001 · human:Krishaanth tapped a card that was already answered · nothing changed
20:58:24 WF6 · APPROVE LAUNCH T-001 · human:Krishaanth tapped Launch anyway: JAMMED cell 89.5_179.0 (high): 4/5 aircraft degraded, 2 checks in a row · sheet LAUNCH_APPROVED by a human; the agent never approves a launch
20:58:28 WF6 · MARK FALSE ALARM T-006 · human:Krishaanth marked it a false alarm: JAMMED cell 89.5_179.0 (high): 4/5 aircraft degraded, 2 checks in a row · sheet PLANNED, the gate checks it again every cycle
20:58:28 WF6 · RAISE THRESHOLD 89.5_179.0 · false alarm on incident #9, marked by human:Krishaanth · threshold now 0.35 (+0.05, max 0.6), incident #9 closed
20:58:31 WF6 · KEEP HOLD T-003 · human:Krishaanth tapped Keep HOLD: JAMMED cell 89.5_179.0 (high): 4/5 aircraft degraded, 2 checks in a row · sheet stays HOLD, decision #3 answered
21:01:54 WF3 · WATCH T-002 · JAMMED cell 89.5_179.0 (high): 5/6 aircraft degraded, 2 checks in a row; launch in 3.4 h · at risk, logged once; nothing changed (jamming often goes away before launch)
21:01:54 WF3 · WATCH T-005 · JAMMED cell 89.5_179.0 (high): 5/6 aircraft degraded, 2 checks in a row; launch in 4.9 h · at risk, logged once; nothing changed (jamming often goes away before launch)
21:01:54 WF3 · HOLD T-006 · brake: incident 10 touches more than 25% of the sorties in the next 12 h, so no cancels or reschedules; JAMMED cell 89.5_179.0 (high): 5/6 aircraft degraded, 2 checks in a row · sheet HOLD, batch card for incident 10 sent, awaiting duty officer
21:01:54 WF3 · HOLD T-007 · brake: incident 10 touches more than 25% of the sorties in the next 12 h, so no cancels or reschedules; JAMMED cell 89.5_179.0 (high): 5/6 aircraft degraded, 2 checks in a row · sheet HOLD, batch card for incident 10 sent, awaiting duty officer
21:01:54 WF3 · HOLD T-008 · brake: incident 10 touches more than 25% of the sorties in the next 12 h, so no cancels or reschedules; JAMMED cell 89.5_179.0 (high): 5/6 aircraft degraded, 2 checks in a row · sheet HOLD, batch card for incident 10 sent, awaiting duty officer
21:01:54 WF3 · HOLD T-009 · brake: incident 10 touches more than 25% of the sorties in the next 12 h, so no cancels or reschedules; JAMMED cell 89.5_179.0 (high): 5/6 aircraft degraded, 2 checks in a row · sheet HOLD, batch card for incident 10 sent, awaiting duty officer
21:01:54 WF3 · HOLD T-010 · brake: incident 10 touches more than 25% of the sorties in the next 12 h, so no cancels or reschedules; JAMMED cell 89.5_179.0 (high): 5/6 aircraft degraded, 2 checks in a row · sheet HOLD, batch card for incident 10 sent, awaiting duty officer
21:01:54 WF3 · HOLD T-011 · brake: incident 10 touches more than 25% of the sorties in the next 12 h, so no cancels or reschedules; JAMMED cell 89.5_179.0 (high): 5/6 aircraft degraded, 2 checks in a row · sheet HOLD, batch card for incident 10 sent, awaiting duty officer
21:01:54 WF3 · HOLD T-012 · brake: incident 10 touches more than 25% of the sorties in the next 12 h, so no cancels or reschedules; JAMMED cell 89.5_179.0 (high): 5/6 aircraft degraded, 2 checks in a row · sheet HOLD, batch card for incident 10 sent, awaiting duty officer
21:01:58 WF6 · REFUSE TAP INCIDENT 10 · a Telegram account that is not on the allowlist tapped a card button · answered "not authorised", nothing changed
21:02:21 WF6 · REFUSE TAP INCIDENT 10 · a Telegram account that is not on the allowlist tapped a card button · answered "not authorised", nothing changed
21:03:14 WF6 · KEEP HOLD T-006 · human:Atharva tapped Keep HOLD: JAMMED cell 89.5_179.0 (high): 5/6 aircraft degraded, 2 checks in a row · sheet stays HOLD, decision #9 answered
21:03:14 WF6 · KEEP HOLD T-007 · human:Atharva tapped Keep HOLD: JAMMED cell 89.5_179.0 (high): 5/6 aircraft degraded, 2 checks in a row · sheet stays HOLD, decision #10 answered
21:03:14 WF6 · KEEP HOLD T-008 · human:Atharva tapped Keep HOLD: JAMMED cell 89.5_179.0 (high): 5/6 aircraft degraded, 2 checks in a row · sheet stays HOLD, decision #11 answered
21:03:14 WF6 · KEEP HOLD T-009 · human:Atharva tapped Keep HOLD: JAMMED cell 89.5_179.0 (high): 5/6 aircraft degraded, 2 checks in a row · sheet stays HOLD, decision #12 answered
21:03:14 WF6 · KEEP HOLD T-010 · human:Atharva tapped Keep HOLD: JAMMED cell 89.5_179.0 (high): 5/6 aircraft degraded, 2 checks in a row · sheet stays HOLD, decision #13 answered
21:03:14 WF6 · KEEP HOLD T-011 · human:Atharva tapped Keep HOLD: JAMMED cell 89.5_179.0 (high): 5/6 aircraft degraded, 2 checks in a row · sheet stays HOLD, decision #14 answered
21:03:14 WF6 · KEEP HOLD T-012 · human:Atharva tapped Keep HOLD: JAMMED cell 89.5_179.0 (high): 5/6 aircraft degraded, 2 checks in a row · sheet stays HOLD, decision #15 answered
21:03:54 WF3 · HOLD T-013 · brake: incident 10 touches more than 25% of the sorties in the next 12 h, so no cancels or reschedules; JAMMED cell 89.5_179.0 (high): 5/6 aircraft degraded, 2 checks in a row · sheet HOLD, batch card for incident 10 sent, awaiting duty officer
21:03:54 WF3 · HOLD T-014 · brake: incident 10 touches more than 25% of the sorties in the next 12 h, so no cancels or reschedules; JAMMED cell 89.5_179.0 (high): 5/6 aircraft degraded, 2 checks in a row · sheet HOLD, batch card for incident 10 sent, awaiting duty officer
21:03:54 WF3 · HOLD T-015 · brake: incident 10 touches more than 25% of the sorties in the next 12 h, so no cancels or reschedules; JAMMED cell 89.5_179.0 (high): 5/6 aircraft degraded, 2 checks in a row · sheet HOLD, batch card for incident 10 sent, awaiting duty officer
21:03:54 WF3 · HOLD T-016 · brake: incident 10 touches more than 25% of the sorties in the next 12 h, so no cancels or reschedules; JAMMED cell 89.5_179.0 (high): 5/6 aircraft degraded, 2 checks in a row · sheet HOLD, batch card for incident 10 sent, awaiting duty officer
21:03:54 WF3 · HOLD T-017 · brake: incident 10 touches more than 25% of the sorties in the next 12 h, so no cancels or reschedules; JAMMED cell 89.5_179.0 (high): 5/6 aircraft degraded, 2 checks in a row · sheet HOLD, batch card for incident 10 sent, awaiting duty officer
21:03:54 WF3 · HOLD T-018 · brake: incident 10 touches more than 25% of the sorties in the next 12 h, so no cancels or reschedules; JAMMED cell 89.5_179.0 (high): 5/6 aircraft degraded, 2 checks in a row · sheet HOLD, batch card for incident 10 sent, awaiting duty officer
21:04:05 WF6 · MARK FALSE ALARM T-013 · human:Atharva marked it a false alarm: JAMMED cell 89.5_179.0 (high): 5/6 aircraft degraded, 2 checks in a row · sheet PLANNED, the gate checks it again every cycle
21:04:05 WF6 · MARK FALSE ALARM T-014 · human:Atharva marked it a false alarm: JAMMED cell 89.5_179.0 (high): 5/6 aircraft degraded, 2 checks in a row · sheet PLANNED, the gate checks it again every cycle
21:04:05 WF6 · MARK FALSE ALARM T-015 · human:Atharva marked it a false alarm: JAMMED cell 89.5_179.0 (high): 5/6 aircraft degraded, 2 checks in a row · sheet PLANNED, the gate checks it again every cycle
21:04:05 WF6 · MARK FALSE ALARM T-016 · human:Atharva marked it a false alarm: JAMMED cell 89.5_179.0 (high): 5/6 aircraft degraded, 2 checks in a row · sheet PLANNED, the gate checks it again every cycle
21:04:05 WF6 · MARK FALSE ALARM T-017 · human:Atharva marked it a false alarm: JAMMED cell 89.5_179.0 (high): 5/6 aircraft degraded, 2 checks in a row · sheet PLANNED, the gate checks it again every cycle
21:04:05 WF6 · MARK FALSE ALARM T-018 · human:Atharva marked it a false alarm: JAMMED cell 89.5_179.0 (high): 5/6 aircraft degraded, 2 checks in a row · sheet PLANNED, the gate checks it again every cycle
21:04:05 WF6 · RAISE THRESHOLD 89.5_179.0 · false alarm on incident #10, marked by human:Atharva · threshold now 0.40 (+0.05, max 0.6), incident #10 closed
```

## Phase C: a double tap cannot overwrite the outcome (after the fix)

In Krishaanth's double tap (executions 42 and 43), both executions edited the same card. The winner happened to finish
last, so the card showed the launch approval. With the order reversed, it would have ended "Already answered" and hidden
who approved. Fix: a tap that claims nothing gets the toast only and never edits the card (`outcome().edit = null`, node `Card edit`).
WF6 was re-imported with the fix and checked with one HOLD decision (#22, sortie T-019, a WF6 test fixture inserted directly)
and two identical cards for it:

| execution | UTC | tap | result |
|---|---|---|---|
| 76 | 21:11:39 | `k\|T-019\|22` on copy 1 (message 25) | claimed; card edited: "✋ Kept on HOLD by Atharva at 23:11.", buttons gone |
| 77–80 | 21:11:45–21:11:58 | `k\|T-019\|22` on copy 2 (message 26), 4 times | "Already answered. Nothing changed." toast only; card not edited |

```
21:11:40 WF6 · KEEP HOLD T-019 · human:Atharva tapped Keep HOLD: no sensor coverage in 89.5_179.0, which was jammed in the last 6 h · sheet stays HOLD, decision #22 answered
21:11:4x WF6 · IGNORE TAP T-019 · human:Atharva tapped a card that was already answered · nothing changed   (4 lines)
```

## Findings for integration

- **Publish WF3 before WF2.** This n8n will not publish a workflow whose Execute Workflow node calls an unpublished workflow.
  WF3 is published already. The same holds for WF2 before WF1's `Execute WF2` is enabled.
- **LLM.** Create the credential `AirGuard LLM` (type Anthropic) to get LLM-phrased evidence lines; until then every card uses the template.
- **Recently jammed includes false alarms.** WF3's query counts incidents a human closed as a false alarm.
  So after a False alarm, a PLANNED sortie in that cell becomes UNKNOWN + recently jammed → HOLD within 1 h of launch as soon as coverage goes stale.
  That query is plan §6 as written; changing it is a team decision (proposal: skip incidents whose evidence has `[false alarm:`).

## Cleanup (21:14 UTC)

- Sheet: all 39 `T-*` rows deleted by the harness, which re-read 0 data rows. The C5 header row stays.
- Supabase, in one transaction, then re-checked (every count below is 0):
  - 22 `decisions` (all `T-*`) and 47 `agent_log` lines (ids 9–55, all WF3/WF6 test lines)
  - incidents #9 and #10, the 4 test observations and the `baselines` row, all on `89.5_179.0`
  - Re-check: `decisions` where `T-%` → 0; `observations`, `incidents`, `baselines` on `89.5_%` → 0. `agent_log` is back to its 4 lines from before the test.
- Telegram: the two phase C copies (sent by hand, not by WF3) were deleted. WF3's cards and FYIs stay in the group as on-phone proof; they carry the `T-` ids.
- n8n: the harness workflow was unpublished and deleted. WF3 stays published and WF6 stays active.
