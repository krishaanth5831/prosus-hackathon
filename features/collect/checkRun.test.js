// Owner: Person A (see CLAUDE.md)
// checkRun: WF1 trusts only what Apify itself says about a run, never the unauthenticated webhook body.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { checkRun } = require('./checkRun.js');

const hook = require(path.join(__dirname, '../../shared/contracts/fixtures/apify-webhook.sample.json'));
const ACTOR = hook.resource.actId;
const RUN = hook.resource.id;
const NOW = Date.parse(hook.resource.finishedAt) + 60_000;                    // a minute after the run finished
const answer = (o = {}) => ({ data: { ...hook.resource, ...o } });           // GET /actor-runs/{id} body

test('a fresh succeeded run of our actor: ids come from the Apify answer', () => {
  const r = checkRun(RUN, answer({ defaultDatasetId: 'fromApifyDataset', defaultKeyValueStoreId: 'fromApifyKvStore' }), ACTOR, NOW);
  assert.deepEqual(r, { ok: true, run_id: RUN, dataset_id: 'fromApifyDataset', kv_id: 'fromApifyKvStore', reason: 'run confirmed by Apify' });
});

test('a run Apify does not know in our account is refused', () => {
  const r = checkRun('Fake1234567890123', { error: { type: 'record-not-found', message: 'Actor run was not found' } }, ACTOR, NOW);
  assert.deepEqual([r.ok, r.reason], [false, 'webhook ignored: Apify does not confirm run Fake1234567890123 (record-not-found)']);
  assert.equal(checkRun(RUN, 'not json', ACTOR, NOW).ok, false);
  assert.equal(checkRun(RUN, { data: { items: [] } }, ACTOR, NOW).ok, false, 'the runs list (empty id in the URL)');
});

test('another actor, a failed run and an old run (replay) are refused', () => {
  assert.match(checkRun(RUN, answer({ actId: 'someoneElsesActor' }), ACTOR, NOW).reason, /not a run of the AirGuard actor$/);
  assert.match(checkRun(RUN, answer({ status: 'FAILED' }), ACTOR, NOW).reason, /is FAILED, not SUCCEEDED$/);
  const late = Date.parse(hook.resource.finishedAt) + 16 * 60_000;
  assert.match(checkRun(RUN, answer(), ACTOR, late).reason, /more than 15 min ago$/);
  assert.equal(checkRun(RUN, answer({ finishedAt: null }), ACTOR, NOW).ok, false, 'no finish time');
});

test('the logged id is sanitised: only letters and digits reach agent_log', () => {
  const r = checkRun('../../users/me<script>', { error: { type: 'record-not-found' } }, ACTOR, NOW);
  assert.equal(r.run_id, 'usersmescript');
  assert.doesNotMatch(r.reason, /[<>/.]{2}/);
  assert.equal(checkRun(undefined, {}, ACTOR, NOW).run_id, 'without an id');
});
