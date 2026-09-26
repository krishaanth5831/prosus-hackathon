# n8n import guide

Owner: Person C. Names follow `shared/contracts/CONTRACTS.md` C9. Every export in the repo has its credential IDs removed, so each credential gets picked by hand after import.

## 1. Credentials (create these once, with exactly these names)

| Name | n8n credential type | Values (from `.env` / the service) |
|---|---|---|
| `AirGuard Postgres` | Postgres | Host, database `postgres`, user and password from the Supabase **Session pooler** string (`SUPABASE_DB_URL`). Port as in that string. SSL: **require**. |
| `AirGuard Telegram` | Telegram API | Access token = `TELEGRAM_BOT_TOKEN` |
| `AirGuard Sheets` | Google Sheets OAuth2 API | Sign in with the Google account that owns the sheet "AirGuard Sorties" |
| `AirGuard Apify` | Header Auth | Name `Authorization`, value `Bearer <APIFY_TOKEN>` |
| `AirGuard LLM` | any chat-model credential | Only used to phrase WF3 card briefings. Every message has a template fallback. |

## 2. Import order

Import callees before callers, so every *Execute Workflow* node and the error-workflow setting has a target to point at.

| # | Workflow | File | Owner | Trigger |
|---|---|---|---|---|
| 1 | `AirGuard WF4 Heal` | `features/collect/wf4-heal.json` | A | Error Trigger · webhook `airguard-apify-failed` · schedule 5 min |
| 2 | `AirGuard WF3 Gate` | `features/gate/wf3-gate.json` | B | Execute Workflow Trigger `Start` |
| 3 | `AirGuard WF2 Detect` | `features/detect/wf2-detect.json` | C | Execute Workflow Trigger `Start` |
| 4 | `AirGuard WF1 Collect` | `features/collect/wf1-collect.json` | A | webhook `airguard-apify` |
| 5 | `AirGuard WF6 Respond` | `features/gate/wf6-respond.json` | B | Telegram Trigger (callback_query) |
| 6 | `AirGuard WF5 Report` | `features/detect/wf5-report.json` | C | Schedule 07:00 |

Click by click, for each file: n8n → **Overview** → **Create workflow** → **⋯** (top right) → **Import from File…** → pick the file → open every node with a red warning triangle → pick the credential with the matching name → **Save**.

Or import through the API, for example for WF2 (the chat id is filled in on the way in, because the repo copy holds a placeholder):

```bash
set -a; . ./.env; set +a
jq --arg c "$TELEGRAM_CHAT_ID" '(.nodes[] | select(.name=="Config") | .parameters.assignments.assignments[] | select(.name=="telegram_chat_id") | .value) = $c' \
  features/detect/wf2-detect.json |
curl -sS -X POST "$N8N_BASE_URL/api/v1/workflows" -H "X-N8N-API-KEY: $N8N_API_KEY" -H 'content-type: application/json' -d @- | jq '{id, name}'
```

The API can't attach credentials, so credentials still get picked in the editor afterwards.

## 3. Config node values

The first node after every trigger is a Set node called **Config**. It holds non-secret config only.

| Workflow | Field | Value |
|---|---|---|
| WF1 | `apify_api` | `https://api.apify.com/v2` (already set) |
| WF2 | `telegram_chat_id` | `TELEGRAM_CHAT_ID` (repo placeholder `SET_TELEGRAM_CHAT_ID`) |
| WF5 | `telegram_chat_id` | `TELEGRAM_CHAT_ID` (repo placeholder `SET_TELEGRAM_CHAT_ID`) |
| WF3, WF6 | chat id, allowlist (`TELEGRAM_ALLOWED_USER_IDS`), sheet id (`GOOGLE_SHEET_ID`) | see `features/gate/` |
| WF4 | chat id | see `features/collect/` |

## 4. Settings and wiring (integration, Krish)

1. Every workflow → **⋯** → **Settings** → **Error workflow** = `AirGuard WF4 Heal` → Save.
2. WF1 node `Execute WF2`: pick `AirGuard WF2 Detect`, then enable the node (right-click → **Activate**).
3. WF2 node `Execute WF3`: pick `AirGuard WF3 Gate`, then enable the node.
4. The instance timezone is Europe/Amsterdam. WF2 and WF5 also set it per workflow.
5. Activate WF1, WF4, WF5 and WF6. WF2 and WF3 are only ever called, so they don't need activating.

### Workflow IDs (fill in after import)

| Workflow | ID |
|---|---|
| WF1 Collect | `P3O5FiMEeifY2hjQ` |
| WF2 Detect | _pending_ |
| WF3 Gate | _pending_ |
| WF4 Heal | _pending_ |
| WF5 Report | _pending_ |
| WF6 Respond | _pending_ |

## Map (Vercel)

The map is one static file, `features/map/index.html`. The Supabase URL and **anon** key reach the browser through `features/map/config.js`, which is **never committed**. It's written just before the deploy and deleted right after:

```bash
set -a; . ./.env; set +a
printf 'window.AIRGUARD = { url: "%s", key: "%s" };\n' "$SUPABASE_URL" "$SUPABASE_ANON_KEY" > features/map/config.js
(cd features/map && npx vercel --prod)
rm features/map/config.js
```

The anon key is select-only through RLS (`observations`, `incidents`, `agent_log`, `cell_status`), so publishing it with the page is what it's for. `?fixture=1` renders the contract fixtures without any backend.
