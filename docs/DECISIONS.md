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
