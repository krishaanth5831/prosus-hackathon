# A7: healing, proven on the live system (2026-09-26)

## (a) Failover: a `forceFallback: true` run, end to end

Actor run `pW4t0e0OtkaTuzdnd` skipped adsb.lol on purpose. Apify's ACTOR.RUN.SUCCEEDED webhook started WF1 by itself, and WF1 wrote the cells and the failover line:

```
{"wf1_execution":"13","status":"success","mode":"webhook","startedAt":"2026-09-26T19:52:14.914Z"}
{"ts":"2026-09-26T19:51:59.006Z","source":"adsb.fi","cells":"64"}
{"id":"6","ts":"2026-09-26T19:52:18.058Z","workflow":"WF1","action":"SWITCH SOURCE TO ADSB.FI","reason":"primary adsb.lol unavailable (forceFallback: adsb.lol skipped on purpose), switched to adsb.fi","outcome":"94 aircraft from adsb.fi, 64 cells written"}
```

## (b) Stale data: Apify schedule paused until WF4 raised the alarm

`a7-stale-test` paused the schedule through the Apify API, waited for WF4's alarm, re-enabled the schedule, then waited for the fresh-again line:

```
2026-09-26T19:52:36Z pause schedule: {"isEnabled":false,"nextRunAt":"2026-09-26T19:55:00.000Z"}
2026-09-26T20:11:01Z stale alarm: {"id":"7","ts":"2026-09-26T20:10:30.560Z","workflow":"WF4","action":"ALERT DATA STALE","reason":"data stale 18 min: every cell UNKNOWN, HOLD logic still active (newest observation 2026-09-26T19:51:59.006Z)","outcome":"alerted on Telegram"}
2026-09-26T20:11:01Z re-enable schedule: {"isEnabled":true,"nextRunAt":null}
2026-09-26T20:16:05Z fresh line: {"id":"8","ts":"2026-09-26T20:15:30.286Z","workflow":"WF4","action":"END STALE ALARM","reason":"data fresh again: newest observation 2026-09-26T20:15:05.663Z (0 min old)","outcome":"logged"}

[exited with code 0]
```

Every WF4 watchdog run in that window (output of *Check freshness* → what WF4 did):

```
{"watchdog_run":"14","at":"2026-09-26T19:55:30.098Z","check":{"last_ts":"2026-09-26T19:51:59.006Z","age_min":3,"stale":false,"alarmed":false},"did":"nothing","telegram":null}
{"watchdog_run":"15","at":"2026-09-26T20:00:30.093Z","check":{"last_ts":"2026-09-26T19:51:59.006Z","age_min":8,"stale":false,"alarmed":false},"did":"nothing","telegram":null}
{"watchdog_run":"16","at":"2026-09-26T20:05:30.102Z","check":{"last_ts":"2026-09-26T19:51:59.006Z","age_min":13,"stale":false,"alarmed":false},"did":"nothing","telegram":null}
{"watchdog_run":"17","at":"2026-09-26T20:10:30.088Z","check":{"last_ts":"2026-09-26T19:51:59.006Z","age_min":18,"stale":true,"alarmed":false},"did":"ALERT DATA STALE + Telegram","telegram":{"message_id":15,"date":"2026-09-26T20:10:30Z","text":"⚠️ AirGuard: data stale 18 min: every cell UNKNOWN, HOLD logic still active (newest observation 2026-09-26T19:51:59.006Z)"}}
{"watchdog_run":"19","at":"2026-09-26T20:15:30.103Z","check":{"last_ts":"2026-09-26T20:15:05.663Z","age_min":0,"stale":false,"alarmed":true},"did":"END STALE ALARM","telegram":null}
```

`agent_log` rows (kept: these are the proof):

```
{"id":"7","ts":"2026-09-26T20:10:30.560Z","workflow":"WF4","action":"ALERT DATA STALE","reason":"data stale 18 min: every cell UNKNOWN, HOLD logic still active (newest observation 2026-09-26T19:51:59.006Z)","outcome":"alerted on Telegram"}
{"id":"8","ts":"2026-09-26T20:15:30.286Z","workflow":"WF4","action":"END STALE ALARM","reason":"data fresh again: newest observation 2026-09-26T20:15:05.663Z (0 min old)","outcome":"logged"}
```

Schedule after the test (re-enabled, run options unchanged):

```
{"isEnabled":true,"nextRunAt":"2026-09-26T20:20:00.000Z","runOptions":{"build":"latest","timeoutSecs":120,"memoryMbytes":256}}
```

## What is in agent_log from Person A, and what was cleaned up

- Row 1 `SWITCH SOURCE TO ADSB.FI` (19:34) is a real failover, but it was caused by our own bug (the actor's missing User-Agent, which adsb.lol answers with 403; fixed in A2), and its webhook was replayed by hand before the Apify webhooks existed (A4).
- Row 6 `SWITCH SOURCE TO ADSB.FI` is the forced failover from (a), through the live chain.
- The WF4 stale/fresh rows come from (b).
- The test rows (`FLAG NO DATA` on the test cell, the two `ALERT WF1 FAILURE` and the `ALERT APIFY RUN TIMED-OUT`) were copied into a4-wf1.md / a6-wf4.md and deleted.

```
{"observations_on_test_cell_89_5_178_5":"0"}
{"workflow":"WF1","action":"SWITCH SOURCE TO ADSB.FI","rows":"2"}
{"workflow":"WF4","action":"ALERT DATA STALE","rows":"1"}
{"workflow":"WF4","action":"END STALE ALARM","rows":"1"}
```
