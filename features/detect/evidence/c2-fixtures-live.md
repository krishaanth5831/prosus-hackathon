# C2: run-fixtures.sh against Supabase (2026-09-26T20:25Z)

`bash features/detect/fixtures/run-fixtures.sh`, test cell `89.5_179.5` only, one rolled-back transaction, exit 0.

```
PASS: 1 high check -> 0 incidents
PASS: 2 high checks -> 1 incident
PASS:   ...JAMMED high, evidence from the latest check
PASS: re-run detect -> still 1 incident
PASS: n_total < 3 (2/2 degraded, twice) -> 0 incidents
PASS: may_lift + 2 high checks -> re-armed to open
PASS:   ...still exactly 1 live incident
PASS: 6 quiet checks with n_total < 3 -> no MAY-LIFT
PASS: 4 covered quiet checks -> no MAY-LIFT
PASS: 5 covered quiet checks -> MAY-LIFT
PASS: 6 quiet + 1 high check in 30 min -> no MAY-LIFT
PASS: MAY-LIFT for > 2 h -> closed
PASS: ratio 0.4 twice under a 0.5 baseline -> 0 incidents
PASS: n_spoof >= 2 twice -> 1 SPOOF incident
ALL FIXTURES PASSED
cleanup: test cell 89.5_179.5 is empty
```

Afterwards: 0 observation rows for `89.5_179.5`; `incidents` still 0 (nothing leaked into real cells).

`report.sql` on live data at 20:26Z: 0 incidents, 0 decisions, **2 failovers** (Person A's WF1 lines), 0 pending HOLDs.

`c5-map-live-local.png`: `features/map/index.html` served locally against live Supabase at 20:27Z: 108 UNKNOWN, 2 NO KNOWN ISSUE, real WF1/WF4 log lines.
