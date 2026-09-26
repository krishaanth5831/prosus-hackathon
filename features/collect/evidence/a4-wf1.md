# A4: WF1 Collect, first runs (2026-09-26)

`Execute WF2` is disabled until integration: it runs nothing and only passes its input through.

Workflow `AirGuard WF1 Collect` (n8n id `P3O5FiMEeifY2hjQ`), webhook `POST /webhook/airguard-apify`. Both runs below were real Apify runs; their webhooks were replayed by hand because the Apify webhooks come in A5.

## Execution 1: run `7Q9oUX81Q8J3EWEAi` (19:26:26 UTC), a real failover

adsb.lol answered 403 to the actor's default user-agent (fixed in A2), so the actor switched to adsb.fi on its own.

| node | items out (true / false) |
|---|---|
| Apify run succeeded | 1 |
| Config | 1 |
| Get RUN_META | 1 |
| Get dataset items | 99 |
| binCells | 76 |
| Any cells? | 76 / 0 |
| Insert observations | 76 |
| Failover? | 1 / 0 |
| Failover line | 1 |
| Log failover | 1 |
| Execute WF2 | 76 |

Result: 76 rows in `observations` for `ts = 2026-09-26T19:26:26.341Z` (99 sensors, 23 degraded). `agent_log`:

```
{"id":"1","ts":"2026-09-26T19:34:30.411Z","workflow":"WF1","action":"SWITCH SOURCE TO ADSB.FI","reason":"primary adsb.lol unavailable (adsb.lol @56.5,21: HTTP 403; adsb.lol @59.8,25: HTTP 403; adsb.lol @54.5,18.5: HTTP 403), switched to adsb.fi","outcome":"99 aircraft from adsb.fi, 76 cells written"}
```

## Execution 2: run `hy6EaZBLSqnsd9CeM` on test cell 89.5_178.5 (`points: [{lat: 89.9, lon: 178.9, nm: 1}]`), no data

The actor wrote `[{"ts": "2026-09-26T19:35:03.910Z", "empty": true, "errors": []}]`.

| node | items out (true / false) |
|---|---|
| Apify run succeeded | 1 |
| Config | 1 |
| Get RUN_META | 1 |
| Get dataset items | 1 |
| binCells | 1 |
| Any cells? | 0 / 1 |
| No data line | 1 |
| Log no data | 1 |
| Execute WF2 | 1 |

`agent_log` (test row, deleted afterwards):

```
{"id":"2","ts":"2026-09-26T19:35:12.994Z","workflow":"WF1","action":"FLAG NO DATA","reason":"no data from any source: every cell UNKNOWN (sources answered with 0 aircraft)","outcome":"no observations written this cycle"}
```
