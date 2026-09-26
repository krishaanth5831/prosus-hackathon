// Owner: Person C (see CLAUDE.md)
const test = require('node:test');
const assert = require('node:assert/strict');
const { logLines } = require('./logLines.js');

const inc = (over) => ({ id: 41, cell_id: '54.5_20.5', type: 'JAMMED', severity: 'high',
  evidence: '9/14 aircraft degraded, 2 checks in a row', ...over });

test('one line per opened, may-lift and closed incident, in that order', () => {
  const lines = logLines([inc(), inc({ id: 42, cell_id: '59.5_25.0', type: 'SPOOF' })], [inc({ id: 7 })], [inc({ id: 3 })]);
  assert.deepEqual(lines.map((l) => l.action),
    ['OPEN JAMMED 54.5_20.5', 'OPEN SPOOF 59.5_25.0', 'MAY-LIFT JAMMED 54.5_20.5', 'CLOSE JAMMED 54.5_20.5']);
  assert.equal(lines[0].reason, 'JAMMED 54.5_20.5 high: 9/14 aircraft degraded, 2 checks in a row');
  for (const l of lines) {
    assert.deepEqual(Object.keys(l), ['workflow', 'action', 'reason', 'outcome'], 'exactly the agent_log columns');
    assert.equal(l.workflow, 'WF2');
    assert.match(l.action, /^[A-Z-]+ [A-Z]+ /, 'C8: UPPERCASE verb + object');
  }
});

test('empty results ({} from "always output data") give no lines', () => {
  assert.deepEqual(logLines([{}], [{}], [{}]), []);
  assert.deepEqual(logLines([], undefined, null), []);
});

test('MAY-LIFT and CLOSE never touch sorties and never say safe or clear', () => {
  const lines = logLines([inc()], [inc()], [inc()]);
  assert.match(lines[1].outcome, /HOLD stays until a human lifts it/);
  assert.match(lines[2].outcome, /sorties untouched/);
  assert.doesNotMatch(JSON.stringify(lines), /\b(safe|clear|cleared)\b/i);
});
