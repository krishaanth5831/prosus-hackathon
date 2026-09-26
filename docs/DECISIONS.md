# Decisions

One line each. Why we chose something, so nobody relitigates it at hour 30.

| Date | Decision | Why |
|---|---|---|
| 2026-09-18 | `main` + `dev`, feature branches off `dev` | `main` stays demo-ready at all times; `dev` absorbs integration churn |
| 2026-09-18 | `main` protected, Krish is sole CODEOWNER | One gate on the code we present |
| 2026-09-18 | Feature-based vertical slices, not layer-based folders | A task becomes a folder — 5 people rarely touch the same file |
| 2026-09-18 | Repo is public | Branch protection isn't enforceable on private repos on GitHub Free |
| 2026-09-18 | Schema + shared types have one owner (Krish) | Field renames merge cleanly and break at runtime — needs a human gate |
| 2026-09-26 | Idea = AirGuard: pre-launch sortie guard using ADS-B NIC/NACp as GPS-jamming sensors | Real live data, daily Baltic jamming, and a clear autonomy boundary: acts alone to make sorties safer, asks a human to make them riskier |
| 2026-09-26 | Feature folders `features/collect`, `gate`, `detect`, `map`; one owner each (A, B, C, C) | One workstream = one folder, so 3 parallel Claude Code sessions never touch the same files |
| 2026-09-26 | n8n Code-node logic lives as pure tested `.js` next to its `node --test` test | Code nodes cannot be unit-tested inside n8n; the node pastes the function + two glue lines |
| 2026-09-26 | One test cell per person (A `89.5_178.5`, B `89.5_179.0`, C `89.5_179.5`) + `T-*` sortie ids | Everyone tests on the shared Supabase and sheet without touching anyone else's data |
| | | |
| 2026-09-26 | Actor sends its own User-Agent and reads `ac ?? aircraft` (A2) | adsb.lol answers 403 to Node's default user-agent `node`, so every Apify run silently failed over; adsb.fi answers `{aircraft}`, not `{ac}`, so plan §5.1 got 0 aircraft from the fallback |
| 2026-09-26 | Every Telegram node sends `parse_mode: HTML` with `& < >` escaped (A6) | n8n's Telegram node defaults to Markdown, and the `_` in every cell id (`54.5_20.5`) makes Telegram reject the message ("can't parse entities") or eat the underscores |
| 2026-09-26 | WF3 Gate is **published**, not left inactive (B4) | This n8n refuses to publish a workflow whose Execute Workflow node calls an unpublished one, so WF2 → WF3 needs WF3 published (and WF1 → WF2 needs WF2 published). WF3 has no trigger of its own, so it still only runs when called |
| 2026-09-26 | WF1 verifies every run with the Apify API before reading any data (A8) | The WF1 webhook is public and unauthenticated: a forged POST could name any dataset and inject fake jamming data. Now only a SUCCEEDED run of our actor, finished < 15 min ago, is read, and only through the ids Apify returns |
| 2026-09-27 | `main` is the default branch; PRs go feature → `dev` and `dev` → `main` only, never `main` → `dev`; a GitHub Action fast-forwards `dev` to `main` after each release | `main` holds only released, working code and `dev` all work in progress; the Action keeps both on the same commit without back-merge PRs |
| 2026-09-27 | Drone GNSS reports (C12, WF7) are a second sensor, fed with simulated border-patrol MAVLink data labelled SIMULATED; a report is placed on its planned leg, never on the drone's GPS position; bad drone news opens an incident, good news only lifts UNKNOWN | ADS-B leaves cells near the border UNKNOWN; real border-guard telemetry is not public; a spoofed drone reports the wrong place, and a forged "all normal" report must never hide jamming |
