# features/gate: the sortie gate (Person B)

Every cycle, **WF3 Gate** compares every upcoming sortie in the sheet with the current cell picture. On its own it only
takes actions that lower risk: reschedule, cancel a low-priority sortie, HOLD. A HOLD card asks the duty officer
whenever an action would raise risk. Decisions are rules only (`decide.js`, SQL). The LLM rephrases one line on
a HOLD card and falls back to the template.

| File | What |
|---|---|
| `decide.js` | The gate (plan §5.3): sorties + cell picture + done keys → C6 decisions |
| `act.js` | WF3 after the decision row: sheet change, Telegram text, C7 buttons, C8 log line, LLM briefing guard |
| `gen-sorties.js` | 48 demo sorties in cells with real sensor coverage → `sorties.demo.csv` |
| `wf3-gate.json` | n8n export: credential ids removed, Config holds the `.env.example` dummies |

## WF3 Gate (published, no trigger of its own: it runs only when WF2 calls it)

```
Start → Config → Read sorties → Cell status → Done keys → Recent incidents → decide → Decision rows
  → Insert decisions (on conflict (key) do nothing returning *) → Acted (only the rows the insert returned)
  → Switch level ─ L1 / L2      → Update sheet · Telegram FYI
                 ├ L3 / L4      → HOLD in sheet · LLM briefing → Card → Telegram card [Keep HOLD] [Launch anyway] [False alarm]
                 ├ BRAKE        → HOLD all in sheet · Batch cards → Telegram batch card [Keep HOLD (all)] [False alarm (all)]
                 └ UNVERIFIED   → Telegram UNVERIFIED          (WATCH has no branch: log only)
  → agent_log lines → Insert agent_log   (placed lowest on the canvas, so n8n v1 runs it after every branch)
```

Publish WF3 before WF2: this n8n will not publish a workflow whose Execute Workflow node calls an unpublished one
(and likewise WF2 before WF1's `Execute WF2` is enabled).

## Config values (set at import, never committed)

| Config field (WF3) | `.env` key |
|---|---|
| `telegram_chat_id` | `TELEGRAM_CHAT_ID` (where the cards go) |
| `allowed_user_ids` | `TELEGRAM_ALLOWED_USER_IDS` (comma-separated Telegram user ids that may answer) |
| `sheet_id` | `GOOGLE_SHEET_ID` (the sheet "AirGuard Sorties", tab `sorties`) |

## Credentials to pick after import

| Credential | Nodes |
|---|---|
| `AirGuard Postgres` | WF3: Cell status, Done keys, Recent incidents, Insert decisions, Insert agent_log |
| `AirGuard Sheets` | WF3: Read sorties, Update sheet, HOLD in sheet, HOLD all in sheet |
| `AirGuard Telegram` | every Telegram node |
| `AirGuard LLM` (type **Anthropic**) | WF3: LLM briefing (`claude-opus-5`, low effort). Without it, cards use the template line. |

## Demo sorties (integration)

```bash
node features/gate/gen-sorties.js             # last 6 h of observations via the anon key in .env → sorties.demo.csv
node features/gate/gen-sorties.js --fixture   # same from the contract fixture, reproducible
```

It prints the coverage and how many routes cross each cell. If one cell is on more than 25% of the routes, any single
incident there trips the brake. Import the CSV into the sheet via **File → Import → Upload**, choosing
**Replace current sheet** and **Convert text to numbers, dates and formulas: off**. That keeps timestamps as UTC text.

## Tests

`npm test` covers `decide.js` (every plan §8 case), `act.js`, `gen-sorties.js`, and the WF3 export (C9 and
embedded code in sync with the files).
