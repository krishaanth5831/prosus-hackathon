# A6: WF4 Heal, first tests (2026-09-26)

Workflow `AirGuard WF4 Heal` (n8n id `URm7RA1tXpvjQySq`, active). WF1's error workflow is set to WF4.
All three rows below came from forced tests; they were copied here and then deleted from `agent_log`.

## Error Trigger: WF1 fails

`POST {}` to WF1's production webhook, so *Get RUN_META* asks Apify for a key-value store called `undefined` and gets a 404.

- First try: WF1 execution 4 → WF4 execution 5. The log line was written, but Telegram rejected the message:
  `{"telegram_error":"Bad Request: can't parse entities: Can't find end of the entity starting at byte offset 43"}`.
  The n8n Telegram node sends Markdown by default, and the `_` in `RUN_META` opened an italic entity that never closed. Fix: `parse_mode: HTML` with `& < >` escaped. Every cell id has a `_`, so WF2/WF3/WF5 messages need the same fix.
- After the fix: WF1 execution 7 → WF4 execution 8, success. Telegram answered:

```
{"message_id":14,"date":"2026-09-26T19:42:24Z","text":"⚠️ AirGuard: WF1 failed at node Get RUN_META: The resource you are requesting could not be found\n<N8N_BASE_URL>/workflow/P3O5FiMEeifY2hjQ/executions/7"}
```

## Apify failure webhook: a run times out

Actor run `shQgIG8zvoSdGJAf5` started with `timeout=1` ended `TIMED-OUT`. Apify's `ACTOR.RUN.TIMED_OUT` webhook went to `/webhook/airguard-apify-failed` → WF4 execution 6, success. Telegram answered:

```
{"message_id":13,"date":"2026-09-26T19:41:40Z","text":"⚠️ AirGuard: Apify run shQgIG8zvoSdGJAf5 ended TIMED-OUT at 2026-09-26T19:41:29.243Z: no data this cycle, the watchdog covers a longer gap"}
```

## agent_log rows (deleted after this copy)

```
{"id":"3","ts":"2026-09-26T19:41:28.395Z","workflow":"WF4","action":"ALERT WF1 FAILURE","reason":"WF1 failed at node Get RUN_META: The resource you are requesting could not be found","outcome":"alerted on Telegram, execution 4"}
{"id":"4","ts":"2026-09-26T19:41:40.527Z","workflow":"WF4","action":"ALERT APIFY RUN TIMED-OUT","reason":"Apify run shQgIG8zvoSdGJAf5 ended TIMED-OUT at 2026-09-26T19:41:29.243Z: no data this cycle, the watchdog covers a longer gap","outcome":"alerted on Telegram"}
{"id":"5","ts":"2026-09-26T19:42:24.836Z","workflow":"WF4","action":"ALERT WF1 FAILURE","reason":"WF1 failed at node Get RUN_META: The resource you are requesting could not be found","outcome":"alerted on Telegram, execution 7"}
```
