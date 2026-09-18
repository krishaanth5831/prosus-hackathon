# Decisions

One line each. Why we chose something, so nobody relitigates it at hour 30.

| Date | Decision | Why |
|---|---|---|
| 2026-09-18 | `main` + `dev`, feature branches off `dev` | `main` stays demo-ready at all times; `dev` absorbs integration churn |
| 2026-09-18 | `main` protected, Krish is sole CODEOWNER | One gate on the code we present |
| 2026-09-18 | Feature-based vertical slices, not layer-based folders | A task becomes a folder — 5 people rarely touch the same file |
| 2026-09-18 | Repo is public | Branch protection isn't enforceable on private repos on GitHub Free |
| 2026-09-18 | Schema + shared types have one owner (Krish) | Field renames merge cleanly and break at runtime — needs a human gate |
| | | |
