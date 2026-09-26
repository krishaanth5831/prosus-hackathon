# C4: WF5 Report, first manual run (2026-09-26T21:16Z)

Workflow `AirGuard WF5 Report` (n8n id `smqvjqaMQhKFdwbg`), execution `86`, mode `manual`, status `success`, started `2026-09-26T21:16:48Z`. Active afterwards: runs daily 07:00 Europe/Amsterdam.

Telegram message as received:

```
📋 AirGuard morning report · Sat 26 Sept, 23:16 (Amsterdam)
Last 24 h:
• Incidents opened: 0. Live now: 0
• Sorties acted on: 0. No incident touched a sortie inside the 2 h window.
• Per level: none
• Source failovers handled: 2
• HOLDs waiting for an officer: 0
AirGuard never says safe: sorties with no known issue stay PLANNED.
```

`agent_log` line written by the run:

```
2026-09-26T21:16:50Z | WF5 | SEND MORNING REPORT | last 24 h: 0 incidents opened, 0 sorties acted on, 0 HOLDs pending | sent to Telegram
```

The 2 failovers are the real WF1 `SWITCH SOURCE TO ADSB.FI` lines from Person A's A4/A7 runs.
