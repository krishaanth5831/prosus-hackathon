// Owner: Person C (see CLAUDE.md)
// The WF2 export follows C9 and stays in sync with the .sql and .js files they embed.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const text = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8').replace(/\r\n/g, '\n');
const load = (f) => JSON.parse(text(f));
const CREDENTIALS = ['AirGuard Postgres', 'AirGuard Telegram', 'AirGuard Sheets', 'AirGuard Apify', 'AirGuard LLM'];
const TRIGGERS = ['n8n-nodes-base.executeWorkflowTrigger'];
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
  // the brand line "never says safe" is the one allowed use of the word
  assert.doesNotMatch(JSON.stringify(wf).replace(/never says safe/g, ''), /\b(safe|clear|cleared)\b/i, 'never says safe or clear');
  assert.doesNotMatch(JSON.stringify(wf), /🟢|✅|green/i, 'no green');
}

test('WF2 Detect export', () => {
  const wf = load('wf2-detect.json');
  assert.equal(wf.name, 'AirGuard WF2 Detect');
  followsC9(wf);
  assert.equal(node(wf, 'Start').type, 'n8n-nodes-base.executeWorkflowTrigger');
  assert.deepEqual(['Config', 'detect.sql', 'lift.sql', 'close.sql'].map((n) => next(wf, n)),
    [['detect.sql'], ['lift.sql'], ['close.sql'], ['agent_log lines', 'Execute WF3']]);
  for (const f of ['detect.sql', 'lift.sql', 'close.sql']) {
    assert.equal(node(wf, f).parameters.query, text(`sql/${f}`), `${f} node = sql/${f}`);
    assert.equal(node(wf, f).executeOnce, true, `${f} runs once per cycle`);
    assert.equal(node(wf, f).alwaysOutputData, true, `${f} continues on 0 rows`);
  }
  assert.ok(node(wf, 'agent_log lines').parameters.jsCode.startsWith(text('logLines.js')), 'Code node = logLines.js + glue');
  assert.deepEqual(next(wf, 'MAY-LIFT?'), ['Telegram MAY-LIFT']);
  const wf3 = node(wf, 'Execute WF3');
  assert.deepEqual([wf3.disabled, wf3.notes], [true, 'wire at integration']);
});
