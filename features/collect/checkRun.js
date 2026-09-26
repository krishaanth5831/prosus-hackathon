// Owner: Person A (see CLAUDE.md)
// Pure function, pasted into the WF1 Code node "Check run". The webhook that starts WF1 is public and
// unauthenticated, so WF1 asks Apify about the run itself (GET /actor-runs/{id} with our token) and takes
// the dataset and key-value store only from that answer, never from the webhook body.

const MAX_AGE_MS = 15 * 60 * 1000;   // the cell_status window: an older run is a replay, and stale anyway

// checkRun(runId from the webhook, answer = body of GET /actor-runs/{runId}, our actor id, now)
//   -> { ok: true, run_id, dataset_id, kv_id, reason } | { ok: false, run_id, reason }
function checkRun(runId, answer, actorId, now = Date.now()) {
  const id = String(runId ?? '').replace(/[^A-Za-z0-9]/g, '').slice(0, 20) || 'without an id';   // only letters and digits reach the log
  const run = answer && typeof answer.data === 'object' && answer.data !== null ? answer.data : null;
  let why = null;
  if (!run || run.id !== runId) why = `Apify does not confirm run ${id}${answer?.error?.type ? ` (${answer.error.type})` : ''}`;
  else if (run.actId !== actorId) why = `run ${id} is not a run of the AirGuard actor`;
  else if (run.status !== 'SUCCEEDED') why = `run ${id} is ${run.status}, not SUCCEEDED`;
  else if (!(now - Date.parse(run.finishedAt) < MAX_AGE_MS)) why = `run ${id} finished ${run.finishedAt}, more than 15 min ago`;
  if (why) return { ok: false, run_id: id, reason: `webhook ignored: ${why}` };
  return { ok: true, run_id: run.id, dataset_id: run.defaultDatasetId, kv_id: run.defaultKeyValueStoreId, reason: 'run confirmed by Apify' };
}

if (typeof module !== 'undefined') module.exports = { checkRun };
// n8n glue (Code node, "Run once for all items"):
// return [{ json: checkRun($('Apify run succeeded').first().json.body?.resource?.id, $input.first().json, $('Config').first().json.actor_id) }];
