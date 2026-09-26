# AirGuard: rules for every Claude Code session in this repo

AirGuard is a software-only pre-launch sortie guard for border-guard and ISR drone units on NATO's eastern flank.
It uses aircraft overhead (ADS-B NIC/NACp) as GPS-jamming sensors and marks jammed 0.5° cells.
It checks every upcoming sortie: it reschedules, cancels or HOLDs on its own, and asks a human (Telegram) only to make a sortie riskier.

Spec: `docs/prd.md` (what, why) · `docs/plan.md` (how) · `shared/contracts/CONTRACTS.md` (shapes and names, binding).

## Hard rules

- AirGuard **never says "safe" or "clear"**: not in a status, a label, a colour (no green), a message or a log line. It says blocked, at risk, unverified or no known issue.
- **No LLM in the decision path.** Decisions come from SQL and pure JS. An LLM may only phrase briefing text, always with a template fallback.
- **All timestamps are UTC ISO 8601.** Local time only in human-facing text.
- **No secrets in the repo.** Values live in `.env` (gitignored), n8n credentials and Apify env vars. `.env.example` holds names and dummy values only.
- **Minimal code.** No frameworks, no build tools, zero dependencies at the root. The only dependency in the repo is `apify` in `features/collect/actor/package.json`. Tests are `node --test` (`npm test`).

## Ownership

| Who | Owns |
|---|---|
| Person A `<github-username-A>` | `features/collect/` |
| Person B `<github-username-B>` | `features/gate/` |
| Person C `<github-username-C>` | `features/detect/`, `features/map/`, `README.md`, `docs/TASKS.md`, `docs/n8n-import.md`, `docs/video-script.md`, `docs/evidence.md` |
| **KRISH ONLY** (hot files) | `CLAUDE.md`, `db/`, `shared/`, `package.json`, `.github/`, `.gitignore`, `.env.example`, `docs/prd.md`, `docs/plan.md`, `docs/research.md`, `docs/SETUP_PROMPT.md` |
| Anyone | `docs/DECISIONS.md`: APPEND one row at the end. Never edit existing rows. |

**Only edit files you own. If you need a change anywhere else, STOP and tell your human exactly what and why. Never edit someone else's tests.**

## Git

Follow `README.md`.
- `git switch dev && git pull` before every slice.
- Branch `<name>/<slice>`.
- One PR per slice into dev: `gh pr create --base dev`, filling in the PR template.
- Never push to `dev` or `main` directly.
- Pull dev into your branch after every merge (`git pull origin dev`).

## Vault rules

The (C) filename prefix and note rules from parent vault CLAUDE.md files do NOT apply inside this repo.
