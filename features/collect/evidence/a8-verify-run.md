# A8: WF1 verifies every run with Apify (2026-09-26)

The webhook that starts WF1 is public and unauthenticated. Before this change, WF1 fetched whatever dataset id the POST body named, so anyone who guessed the n8n host could inject fake jamming data. Now WF1 asks Apify about the run itself (`GET /actor-runs/{id}` with our token, the id URL-encoded) and `checkRun.js` accepts it only if it is a **run of our actor**, **SUCCEEDED**, and **finished less than 15 min ago** (a replay of an older run, e.g. one listed in these evidence files, is refused). The dataset and key-value store come only from Apify's answer. A refused webhook writes a `REJECT WEBHOOK` line (the id reduced to letters and digits) and no observations.

## Three forged webhooks, sent to the live WF1 at 22:00:55 UTC

| Attack | Body |
|---|---|
| forged run id | `{"resource": {"id": "T0forgedRun000000", "actId": "jy8UIKwgtSEdMN00I", "status": "SUCCEEDED", "defaultDatasetId": "attackerDataset01", …}}` |
| replay of a real, old run | `{"resource": {"id": "7Q9oUX81Q8J3EWEAi", "defaultDatasetId": "attackerDataset01", …}}` |
| path traversal | `{"resource": {"id": "../../users/me"}}` |

WF1 executions 118–120 all ended `success` (no error, so no WF4 alert spam). Observations written: **0**. `agent_log` (these test rows were deleted after this copy):

```
{"id":"59","ts":"2026-09-26T22:00:58.048Z","workflow":"WF1","action":"REJECT WEBHOOK","reason":"webhook ignored: Apify does not confirm run usersme (record-not-found)","outcome":"no observations written"}
{"id":"60","ts":"2026-09-26T22:00:58.061Z","workflow":"WF1","action":"REJECT WEBHOOK","reason":"webhook ignored: Apify does not confirm run T0forgedRun000000 (record-not-found)","outcome":"no observations written"}
{"id":"61","ts":"2026-09-26T22:00:58.080Z","workflow":"WF1","action":"REJECT WEBHOOK","reason":"webhook ignored: run 7Q9oUX81Q8J3EWEAi finished 2026-09-26T19:26:37.700Z, more than 15 min ago","outcome":"no observations written"}
```

## The next scheduled run still passes

```
{"wf1_execution":"121","check_run":{"ok":true,"run_id":"D4OWiKlqhwIhB2fTq","reason":"run confirmed by Apify"},"nodes":"Apify run succeeded=1 Config=1 Verify run=1 Check run=1 Verified?=1/0 Get RUN_META=1 Get dataset items=50 binCells=42 Any cells?=42/0 Insert observations=42 Failover?=0/1 Execute WF2=0"}
{"ts":"2026-09-26T22:05:03.532Z","source":"adsb.lol","cells":"42"}
```

WF1 121 → WF2 122 → WF3 123, all `success`.
