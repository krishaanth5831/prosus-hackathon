// Owner: Person C (see CLAUDE.md)
const test = require('node:test');
const assert = require('node:assert/strict');
const { reportText } = require('./reportText.js');

const now = new Date('2026-09-27T05:00:00Z'); // 07:00 in Amsterdam (CEST)

test('full report: local time, rate, levels, failovers, pending HOLDs', () => {
  // pg returns bigint counts as strings
  const text = reportText({
    incidents_opened: '2', incidents_list: 'JAMMED 54.5_20.5 (high), SPOOF 59.5_25.0 (high)', incidents_live: '1',
    per_level: { WATCH: 4, L1_RESCHEDULE: 3, L2_CANCEL: 2, L3_HOLD: 2 }, resolved_by_agent: '5', acted_on: '7',
    resolution_rate_pct: '71', failovers: '1', pending_holds: '2', pending_hold_sorties: 'S-017, S-031',
  }, now);
  assert.match(text, /Sun 27 Sept?, 07:00 \(Amsterdam\)/);
  assert.match(text, /Incidents opened: 2 \(JAMMED 54\.5_20\.5 \(high\), SPOOF 59\.5_25\.0 \(high\)\)\. Live now: 1/);
  assert.match(text, /Agent resolved 5 \(71%\) by reschedule\/cancel; 2 went to a human\./);
  assert.match(text, /Per level: L1_RESCHEDULE 3 · L2_CANCEL 2 · L3_HOLD 2 · WATCH 4/);
  assert.match(text, /failovers handled: 1/);
  assert.match(text, /HOLDs waiting for an officer: 2 \(S-017, S-031\)/);
});

test('quiet night: zeros, no division, no "safe"/"clear" claim', () => {
  const text = reportText({ incidents_opened: '0', incidents_list: null, incidents_live: '0', per_level: {},
    resolved_by_agent: '0', acted_on: '0', resolution_rate_pct: null, failovers: '0', pending_holds: '0' }, now);
  assert.match(text, /Sorties acted on: 0\./);
  assert.match(text, /Per level: none/);
  assert.doesNotMatch(text, /NaN|undefined|null/);
  assert.doesNotMatch(text.replace('never says safe', ''), /\b(safe|clear|cleared)\b/i);
});
