// Owner: Person A (see CLAUDE.md)
// The n8n exports in this folder follow C9: names, webhook paths, Config after every trigger,
// credential names only (no IDs), and never the words "safe" or "clear".
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const load = (f) => JSON.parse(fs.readFileSync(path.join(__dirname, f), 'utf8'));
const CREDENTIALS = ['AirGuard Postgres', 'AirGuard Telegram', 'AirGuard Sheets', 'AirGuard Apify', 'AirGuard LLM'];
const TRIGGERS = ['n8n-nodes-base.webhook', 'n8n-nodes-base.errorTrigger', 'n8n-nodes-base.scheduleTrigger',
  'n8n-nodes-base.executeWorkflowTrigger'];
const node = (wf, name) => wf.nodes.find((n) => n.name === name);
const next = (wf, name) => (wf.connections[name]?.main ?? []).flat().map((c) => c.node);

function followsC9(wf) {
  for (const n of wf.nodes) {
    for (const ref of Object.values(n.credentials ?? {})) {
      assert.ok(CREDENTIALS.includes(ref.name), `${n.name}: credential "${ref.name}"`);
      assert.equal(ref.id, undefined, `${n.name}: credential id removed`);
    }
  }
  for (const t of wf.nodes.filter((n) => TRIGGERS.includes(n.type))) {
    assert.deepEqual(next(wf, t.name), ['Config'], `${t.name} → Config`);
  }
  assert.equal(node(wf, 'Config').type, 'n8n-nodes-base.set');
  assert.doesNotMatch(JSON.stringify(wf), /\b(safe|clear|cleared)\b/i, 'never says safe or clear');
}

test('WF1 Collect export', () => {
  const wf = load('wf1-collect.json');
  assert.equal(wf.name, 'AirGuard WF1 Collect');
  followsC9(wf);
  const hook = node(wf, 'Apify run succeeded');
  assert.deepEqual([hook.parameters.path, hook.parameters.responseMode], ['airguard-apify', 'onReceived']);
  const binCells = fs.readFileSync(path.join(__dirname, 'binCells.js'), 'utf8');
  assert.equal(node(wf, 'binCells').parameters.jsCode,
    binCells + 'return binCells($input.all().map(i => i.json)).map(json => ({ json }));\n', 'Code node = binCells.js + glue');
  const wf2 = node(wf, 'Execute WF2');   // wired at integration
  assert.deepEqual([!!wf2.disabled, wf2.executeOnce, wf2.parameters.workflowId.cachedResultName], [false, true, 'AirGuard WF2 Detect']);
});

test('WF1 trusts only what Apify says about a run, never the webhook body', () => {
  const wf = load('wf1-collect.json');
  assert.deepEqual(['Config', 'Verify run', 'Check run'].map((n) => next(wf, n)), [['Verify run'], ['Check run'], ['Verified?']]);
  assert.deepEqual(wf.connections['Verified?'].main.map((o) => o.map((c) => c.node)), [['Get RUN_META'], ['Reject line']]);
  assert.deepEqual(next(wf, 'Reject line'), ['Log reject']);
  const verify = node(wf, 'Verify run').parameters;
  assert.match(verify.url, /\/actor-runs\/\{\{ encodeURIComponent\(/, 'the run id is encoded into the path');
  assert.equal(verify.options.response.response.neverError, true, 'a forged id is refused, not an error');
  const checkRun = fs.readFileSync(path.join(__dirname, 'checkRun.js'), 'utf8');
  const code = node(wf, 'Check run').parameters.jsCode;
  assert.ok(code.startsWith(checkRun), 'Code node = checkRun.js + glue');
  assert.ok(checkRun.includes(`// ${code.slice(checkRun.length).trim()}`), 'the glue line is the one documented in checkRun.js');
  assert.doesNotMatch(JSON.stringify(wf), /resource\.default(DatasetId|KeyValueStoreId)/, 'no storage id is read from the webhook body');
  for (const n of ['Get RUN_META', 'Get dataset items']) assert.match(node(wf, n).parameters.url, /\$\('Check run'\)/, n);
});

test('WF4 Heal export', () => {
  const wf = load('wf4-heal.json');
  assert.equal(wf.name, 'AirGuard WF4 Heal');
  followsC9(wf);
  const types = wf.nodes.map((n) => n.type);
  for (const t of ['n8n-nodes-base.errorTrigger', 'n8n-nodes-base.webhook', 'n8n-nodes-base.scheduleTrigger']) {
    assert.ok(types.includes(t), t);
  }
  const hook = wf.nodes.find((n) => n.type === 'n8n-nodes-base.webhook');
  assert.deepEqual([hook.parameters.path, hook.parameters.responseMode], ['airguard-apify-failed', 'onReceived']);
  assert.deepEqual(node(wf, 'Every 5 min').parameters.rule.interval, [{ field: 'minutes', minutesInterval: 5 }]);
  const chat = node(wf, 'Config').parameters.assignments.assignments.find((a) => a.name === 'telegram_chat_id');
  assert.equal(chat.value, '123456789', 'the export keeps the .env.example dummy; the real chat id is set at import');
  for (const n of wf.nodes.filter((x) => x.type === 'n8n-nodes-base.telegram')) {
    assert.equal(n.parameters.additionalFields.parse_mode, 'HTML', `${n.name}: the Markdown default breaks on "_" in cell ids`);
  }
});
