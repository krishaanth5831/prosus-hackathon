# A5: Apify schedule + webhooks, 3 unattended cycles (2026-09-26)

Created with the Apify API at 19:37:33 UTC (`features/collect/apify-setup.sh` does the same and skips what exists):

```
{"schedule":"PQhN7U3p4ngaiGkfG","name":"airguard-adsb-every-5-min","cronExpression":"*/5 * * * *","timezone":"UTC","isEnabled":true,"isExclusive":true,"runOptions":{"build":"latest","timeoutSecs":120,"memoryMbytes":256}}
{"webhook":"KCqYR9qFJN5LbgC7I","eventTypes":["ACTOR.RUN.SUCCEEDED"],"requestUrl":"<N8N_BASE_URL>/webhook/airguard-apify","condition":{"actorId":"jy8UIKwgtSEdMN00I"}}
{"webhook":"rTIVUbrQZ6qrdicAx","eventTypes":["ACTOR.RUN.FAILED","ACTOR.RUN.TIMED_OUT"],"requestUrl":"<N8N_BASE_URL>/webhook/airguard-apify-failed","condition":{"actorId":"jy8UIKwgtSEdMN00I"}}
```

## Scheduled runs (origin SCHEDULER) → WF1 executions → observations

Nobody touched anything between these runs: the schedule starts the actor, Apify's ACTOR.RUN.SUCCEEDED webhook starts WF1, WF1 writes `observations`.
WF1 executions 4 and 7 (errors) are the A6 Error Trigger tests (`POST {}`), not scheduled runs. A scheduled run costs about $0.0007, so 288 runs a day cost about $0.20.

```
{"run":"vv99ExZjBbBUYXKh0","startedAt":"2026-09-26T19:40:03.970Z","status":"SUCCEEDED","usd":0.000702439360641771}
{"run":"Q1hZLtceqiVlYhAbY","startedAt":"2026-09-26T19:45:02.590Z","status":"SUCCEEDED","usd":0.000676738571021292}
{"run":"rDdppV7JLzquGmUUt","startedAt":"2026-09-26T19:50:05.543Z","status":"SUCCEEDED","usd":0.0006788142997291353}
{"wf1_execution":"3","status":"success","startedAt":"2026-09-26T19:40:24.722Z"}
{"wf1_execution":"4","status":"error","startedAt":"2026-09-26T19:41:27.353Z"}
{"wf1_execution":"7","status":"error","startedAt":"2026-09-26T19:42:24.019Z"}
{"wf1_execution":"9","status":"success","startedAt":"2026-09-26T19:45:21.613Z"}
{"wf1_execution":"11","status":"success","startedAt":"2026-09-26T19:50:24.154Z"}
{"ts":"2026-09-26T19:40:07.847Z","source":"adsb.lol","cells":"75","sensors":"98","degraded":"21","cells_with_3_sensors":"6"}
{"ts":"2026-09-26T19:45:06.150Z","source":"adsb.lol","cells":"77","sensors":"93","degraded":"28","cells_with_3_sensors":"3"}
{"ts":"2026-09-26T19:50:09.247Z","source":"adsb.lol","cells":"72","sensors":"92","degraded":"27","cells_with_3_sensors":"4"}
```
