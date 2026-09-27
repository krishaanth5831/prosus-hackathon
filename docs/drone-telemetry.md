# Drone GNSS telemetry: the build prompt

This is the prompt for the drone-telemetry slice, as given to Claude Code. It is kept so the slice can be rebuilt or extended the same way.
Status: built in PR "Drone GNSS telemetry (C12, WF7)". The data is **simulated** until a real unit connects its ground station.

---

You are working on AirGuard in `prosus-hackathon`. Krish is the only developer, so you may edit any file. Rules:
- CLAUDE.md still applies: never "safe"/"clear", no LLM in the decision path, UTC ISO 8601, no secrets in the repo, minimal code.
- No new dependencies. Tests use `node --test`.
- Branch from `dev` and open the PR into `dev`.

**Problem.** Aircraft (ADS-B NIC/NACp) are AirGuard's only sensor. Where no aircraft fly, a cell is UNKNOWN. That happens near the Belarus and Russia borders (airlines avoid them), at night, and for local low-altitude jammers.
Border-patrol drones fly exactly there, and their autopilot already records GNSS health.
Add the unit's own drones as a second sensor. Real border-guard telemetry is not public, so feed it with simulated border-patrol MAVLink data, and label that data as SIMULATED everywhere it shows.

**Build:**
1. **Contract C12 (drone report)** in `shared/contracts/CONTRACTS.md`, plus a fixture and a contract test. The shape is `{source, drone_id, sortie_id, legs:[{cell_id, from, to}], samples:[{t, fix_type, satellites_visible, h_acc, jamming_state, spoofing_state, lat, lon}]}`.
   Field names come from MAVLink `GPS_RAW_INT` and PX4 `SensorGps`. Also update C4 (new columns), C8 (WF7) and C9 (WF7 name, webhook `airguard-drone`, credential `AirGuard Drone Intake`).
2. **`db/migrations/002_drone_reports.sql`.**
   - Add a `drone_reports` table with one row per planned leg, select-only RLS for the map.
   - Make `cell_status` take the latest drone report of the last 60 min into account. Keep the C4 columns and add `drone_ts` and `drone_evidence` at the end.
3. **`features/collect/droneReport.js`**, a pure function with tests.
   - Validate the report. Place samples on the leg whose time window holds them, **never by the drone's GPS position** (a spoofed drone reports the wrong place).
   - A sample is degraded if `fix_type < 3`, `h_acc > 10 m` or the jamming flag ≥ warning. It is a spoof sample if the spoofing flag ≥ indicated.
   - Verdict per leg with 10+ samples: SPOOF ≥ 20 %, else JAMMED ≥ 30 %, else NORMAL.
   - Evidence starts with `SIMULATED` when `source` starts with `sim:`.
4. **`features/collect/sim-drone.js`**, a deterministic simulator (`normal | jammed | spoofed` per leg) with `source: "sim:border-patrol-mavlink"`. It prints the report, or POSTs it with `--post`.
5. **WF7 Telemetry** (`features/collect/wf7-telemetry.json`).
   - Webhook `airguard-drone` with header auth, because there is nobody to call back to verify a report.
   - The flow is Config → droneReport → valid? → insert `drone_reports` + one `agent_log` line, or → one REJECT line.
6. **Detection (`features/detect/sql/detect.sql`, `lift.sql`).**
   - Bad news counts more than good news: one JAMMED/SPOOF drone report from the last 60 min opens an incident, with confidence `medium (drone only)` or `high (ADS-B + drone)`.
   - A NORMAL report counts as coverage for MAY-LIFT, and only when no bad drone report is under 60 min old.
   - A report older than an incident's close never reopens it.
   - `decide.js` stays unchanged: it reads states and recent incidents only.
7. **Map:** the popup shows the drone evidence; the legend names drone reports and SIMULATED data.
8. **The Google Sheet is not reorganised.** The `sorties` header is C5, and WF3/WF6 match rows on it. Telemetry lives in Supabase.
9. **Deploy.** Apply 002, create the n8n credential (token in `.env` as `DRONE_INTAKE_TOKEN`), import and publish WF7 with the WF4 error workflow, and update WF2.
10. **Prove it live** on the test cells `89.5_*`:
    - a POST without the token is refused;
    - a simulated flight with jammed, spoofed and normal legs gives the rows, `agent_log` lines, incidents and `cell_status` states in C12;
    - then delete the test data.

**Limits to state in the pitch:**
- Drone reports exist only where a drone already flew. The first sortie into a deadspot still gets UNVERIFIED.
- Fixed GNSS monitoring receivers could later send the same C12 shape.
- A single drone's receiver can fail on its own, so drone-only incidents are `medium` confidence.
