// Owner: Person B (see CLAUDE.md)
// decide() against every gate case in docs/plan.md §8, on the C4 fixture cells and a fixed clock.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { decide } = require('./decide');

const FIXTURES = path.join(__dirname, '../../shared/contracts/fixtures');
// 54.5_20.5 JAMMED #41 high · 55.0_20.5 JAMMED #38 medium · 59.5_25.0 SPOOF #42 · 56.5_21.0 NO_KNOWN_ISSUE
// 55.0_21.0 UNKNOWN (2 aircraft) · a cell missing from the view is UNKNOWN too (C4)
const cells = Object.fromEntries(JSON.parse(fs.readFileSync(path.join(FIXTURES, 'cell_status.sample.json'), 'utf8'))
  .map((c) => [c.cell_id, c]));
const NOW = new Date('2026-09-26T21:05:00Z');
const at = (min) => new Date(NOW.getTime() + min * 60e3).toISOString().replace('.000Z', 'Z');
const JAM41 = 'JAMMED cell 54.5_20.5 (high): 5/8 aircraft degraded, 2 checks in a row';

const sortie = (o) => ({ sortie_id: 'T-001', unit: '3rd Border Drone Sqn (DEMO, fictional)', priority: 'routine',
  launch_at: at(60), window_end: at(60 + 6 * 60), cells: '54.5_20.5', status: 'PLANNED', decided_by: '', note: '', ...o });
// Upcoming sorties with no known issue on the route: nothing to act on, but they keep one incident
// at or under the 25% brake in the single-level tests.
const quiet = (n) => Array.from({ length: n }, (_, i) => sortie({ sortie_id: `Q-${i + 1}`, cells: '56.5_21.0' }));
const run = (sorties, o = {}) => decide({ sorties, cells, now: NOW, ...o });
const levels = (out) => out.map((a) => a.level);

test('routine, JAMMED cell, +2 h still inside its window → L1_RESCHEDULE, no human', () => {
  const s = sortie({ launch_at: at(60), window_end: at(60 + 6 * 60) });
  assert.deepEqual(run([s, ...quiet(3)]), [{
    sortie_id: 'T-001', launch_at: s.launch_at, key: `T-001|41|${s.launch_at}`, incident_id: 41,
    level: 'L1_RESCHEDULE', human: false, new_launch_at: '2026-09-27T00:05:00.000Z', reason: JAM41,
  }]);
  // +2 h landing exactly on window_end still fits
  assert.deepEqual(levels(run([sortie({ window_end: at(60 + 120) }), ...quiet(3)])), ['L1_RESCHEDULE']);
});

test('routine, no slot left in its window → L3_HOLD for a human', () => {
  const s = sortie({ window_end: at(60 + 60) });
  assert.deepEqual(run([s, ...quiet(3)]), [{
    sortie_id: 'T-001', launch_at: s.launch_at, key: `T-001|41|${s.launch_at}`, incident_id: 41,
    level: 'L3_HOLD', human: true, reason: JAM41,
  }]);
});

test('low, JAMMED cell → L2_CANCEL, no human', () => {
  const s = sortie({ priority: 'low', window_end: at(60 + 3 * 60) });
  assert.deepEqual(run([s, ...quiet(3)]), [{
    sortie_id: 'T-001', launch_at: s.launch_at, key: `T-001|41|${s.launch_at}`, incident_id: 41,
    level: 'L2_CANCEL', human: false, reason: JAM41,
  }]);
});

test('priority, JAMMED cell → L3_HOLD even with a slot left', () => {
  const s = sortie({ priority: 'priority', window_end: at(60 + 6 * 60) });
  assert.deepEqual(run([s, ...quiet(3)]), [{
    sortie_id: 'T-001', launch_at: s.launch_at, key: `T-001|41|${s.launch_at}`, incident_id: 41,
    level: 'L3_HOLD', human: true, reason: JAM41,
  }]);
});

test('SPOOF cell → L4_SPOOF_HOLD even for a low sortie; SPOOF wins over JAMMED on the same route', () => {
  const s = sortie({ priority: 'low', cells: '54.5_20.5;59.5_25.0' });
  assert.deepEqual(run([s, ...quiet(3)]), [{
    sortie_id: 'T-001', launch_at: s.launch_at, key: `T-001|42|${s.launch_at}`, incident_id: 42,
    level: 'L4_SPOOF_HOLD', human: true,
    reason: 'SPOOF cell 59.5_25.0 (high): 2 aircraft with GPS/baro altitude gap > 1500 ft, 2 checks in a row',
  }]);
});

test('launch 5 h out → WATCH, keyed once per sortie and incident, no human', () => {
  const s = sortie({ launch_at: at(5 * 60), window_end: at(11 * 60) });
  assert.deepEqual(run([s, ...quiet(3)]), [{
    sortie_id: 'T-001', launch_at: s.launch_at, key: 'T-001|41|watch', incident_id: 41,
    level: 'WATCH', human: false, reason: JAM41,
  }]);
});

test('window edges: 2 h out acts, 2 h 1 min watches, 12 h watches, past 12 h is ignored', () => {
  const at_ = (min) => levels(run([sortie({ launch_at: at(min), window_end: at(min + 6 * 60) }), ...quiet(3)]));
  assert.deepEqual(at_(120), ['L1_RESCHEDULE']);
  assert.deepEqual(at_(121), ['WATCH']);
  assert.deepEqual(at_(12 * 60), ['WATCH']);
  assert.deepEqual(at_(12 * 60 + 1), []);
});

test('UNKNOWN cell, launch < 1 h, no recent jamming → UNVERIFIED notice; the sortie is not touched', () => {
  const s = sortie({ launch_at: at(40), cells: '56.5_21.0;55.0_21.0;60.0_30.0' });
  assert.deepEqual(run([s]), [{
    sortie_id: 'T-001', launch_at: s.launch_at, key: `T-001|unknown|${s.launch_at}`, incident_id: null,
    level: 'UNVERIFIED', human: false, reason: 'no sensor coverage in 55.0_21.0, 60.0_30.0',
  }]);
  assert.deepEqual(run([sortie({ launch_at: at(61), cells: '55.0_21.0' })]), [], 'more than 1 h out: nothing yet');
});

test('UNKNOWN cell that was jammed in the last 6 h → L3_HOLD, not a notice', () => {
  const s = sortie({ launch_at: at(40), cells: '56.5_21.0;55.0_21.0' });
  assert.deepEqual(run([s], { recentlyJammed: ['55.0_21.0'] }), [{
    sortie_id: 'T-001', launch_at: s.launch_at, key: `T-001|unknown|${s.launch_at}`, incident_id: null,
    level: 'L3_HOLD', human: true, reason: 'no sensor coverage in 55.0_21.0, which was jammed in the last 6 h',
  }]);
});

test('BRAKE: one incident on > 25% of upcoming sorties → all HOLD in one batch, no cancel or reschedule', () => {
  const hit = [
    sortie({ sortie_id: 'T-001', priority: 'routine' }), // alone: L1
    sortie({ sortie_id: 'T-002', priority: 'low' }), //      alone: L2
    sortie({ sortie_id: 'T-003', priority: 'priority' }), // alone: L3
  ];
  const out = run([...hit, ...quiet(7)]); // 3 of 10 = 30%
  assert.deepEqual(out.map((a) => [a.sortie_id, a.level, a.human, a.batch, a.new_launch_at]), [
    ['T-001', 'BRAKE_HOLD', true, '41', undefined],
    ['T-002', 'BRAKE_HOLD', true, '41', undefined],
    ['T-003', 'BRAKE_HOLD', true, '41', undefined],
  ]);
  assert.deepEqual(out.map((a) => a.key), hit.map((s) => `${s.sortie_id}|41|${s.launch_at}`), 'the brake replaces actions, adds none');
});

test('BRAKE: exactly 25% does not brake; WATCH counts toward it but stays WATCH; L4 is never rewritten', () => {
  const two = [sortie({ sortie_id: 'T-001' }), sortie({ sortie_id: 'T-002', launch_at: at(5 * 60), window_end: at(11 * 60) })];
  assert.deepEqual(levels(run([...two, ...quiet(6)])), ['L1_RESCHEDULE', 'WATCH']); // 2 of 8 = 25%
  assert.deepEqual(levels(run([...two, ...quiet(5)])), ['BRAKE_HOLD', 'WATCH']); //    2 of 7 = 29%
  const spoof = [sortie({ sortie_id: 'T-003', cells: '59.5_25.0' }), sortie({ sortie_id: 'T-004', cells: '59.5_25.0', priority: 'low' })];
  assert.deepEqual(run([...spoof, ...quiet(1)]).map((a) => [a.level, a.batch]), // 2 of 3 on #42
    [['L4_SPOOF_HOLD', undefined], ['L4_SPOOF_HOLD', undefined]]);
});

test('dedupe: a key already in decisions is never acted on twice', () => {
  const sorties = [sortie({ sortie_id: 'T-001' }), sortie({ sortie_id: 'T-002', priority: 'low' }), ...quiet(6)];
  const first = run(sorties);
  assert.deepEqual(levels(first), ['L1_RESCHEDULE', 'L2_CANCEL']);
  assert.deepEqual(run(sorties, { done: first.map((a) => a.key) }), []);
  assert.deepEqual(run(sorties, { done: [first[0].key] }).map((a) => a.sortie_id), ['T-002']);
});

test('only PLANNED and RESCHEDULED are gated: HOLD, CANCELLED and LAUNCH_APPROVED are left alone', () => {
  const sorties = ['PLANNED', 'RESCHEDULED', 'HOLD', 'CANCELLED', 'LAUNCH_APPROVED']
    .map((status, i) => sortie({ sortie_id: `T-00${i + 1}`, status }));
  assert.deepEqual(run([...sorties, ...quiet(7)]).map((a) => [a.sortie_id, a.level]),
    [['T-001', 'L1_RESCHEDULE'], ['T-002', 'L1_RESCHEDULE']]);
});

test('launches in the past or right now are ignored', () => {
  assert.deepEqual(run([
    sortie({ sortie_id: 'T-001', launch_at: at(-1) }),
    sortie({ sortie_id: 'T-002', launch_at: at(0) }),
    sortie({ sortie_id: 'T-003', launch_at: at(-10), cells: '55.0_21.0' }),
  ]), []);
});

// RFC 4180 fields: the unit name is quoted because it contains a comma
const splitCsv = (line) => [...line.matchAll(/(?:^|,)("(?:[^"]|"")*"|[^,]*)/g)]
  .map(([, f]) => (f.startsWith('"') ? f.slice(1, -1).replace(/""/g, '"') : f));

test('contract fixtures: sorties.sample.csv against cell_status.sample.json at 21:05Z gives C6 rows', () => {
  const [header, ...lines] = fs.readFileSync(path.join(FIXTURES, 'sorties.sample.csv'), 'utf8').trim().split(/\r?\n/);
  const cols = header.split(',');
  const out = run(lines.map((l) => Object.fromEntries(splitCsv(l).map((v, i) => [cols[i], v]))));
  // 8 upcoming (T-009 CANCELLED, T-010 HOLD). #41 and #38 each touch 3 of 8 = 37.5% → brake; T-007 only watches.
  assert.deepEqual(Object.fromEntries(out.map((a) => [a.sortie_id, [a.level, a.batch ?? a.incident_id]])), {
    'T-001': ['BRAKE_HOLD', '41'], 'T-002': ['BRAKE_HOLD', '41'], 'T-004': ['BRAKE_HOLD', '41'],
    'T-003': ['BRAKE_HOLD', '38'], 'T-008': ['BRAKE_HOLD', '38'], 'T-007': ['WATCH', 38],
    'T-005': ['L4_SPOOF_HOLD', 42],
    'T-006': ['UNVERIFIED', null],
  });
  const C6 = ['sortie_id', 'launch_at', 'key', 'incident_id', 'level', 'human', 'reason', 'new_launch_at', 'batch'];
  for (const a of out) {
    for (const k of Object.keys(a)) assert.ok(C6.includes(k), `${a.sortie_id}: ${k} is a C6 field`);
    assert.match(a.key, /^T-\d+\|(\d+\|(watch|[\dT:-]+Z)|unknown\|[\dT:-]+Z)$/);
    assert.equal(typeof a.human, 'boolean');
  }
  assert.doesNotMatch(JSON.stringify(out), /\b(safe|clear)\b/i, 'never says safe or clear');
});
