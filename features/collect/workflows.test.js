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
  const wf2 = node(wf, 'Execute WF2');
  assert.deepEqual([wf2.disabled, wf2.notes], [true, 'wire at integration']);
});
