// Owner: Krish (see CLAUDE.md)
// droneReport: a drone's GNSS report becomes one drone_reports row per planned leg (C12).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { droneReport } = require('./droneReport.js');
const { simulate, SOURCE } = require('./sim-drone.js');

const END = Date.parse('2026-09-27T10:00:00Z'), NOW = END + 60e3;
const flight = (legs, o = {}) => simulate({ sortie: 'T-101', drone: 'BG-UAV-07', legs, end: END, seed: 7, ...o });
const THREE = [{ cell_id: '89.5_178.5', scenario: 'jammed' }, { cell_id: '89.5_178.0', scenario: 'spoofed' },
  { cell_id: '89.5_177.5', scenario: 'normal' }];
const COLUMNS = ['ts', 'cell_id', 'sortie_id', 'drone_id', 'n_samples', 'n_degraded', 'n_spoof', 'verdict', 'evidence', 'source'];

test('jammed, spoofed and normal legs get the matching verdicts, one row per leg', () => {
  const r = droneReport(flight(THREE), NOW);
  assert.equal(r.ok, true);
  assert.deepEqual(r.rows.map((x) => [x.cell_id, x.verdict]), [['89.5_178.5', 'JAMMED'], ['89.5_178.0', 'SPOOF'], ['89.5_177.5', 'NORMAL']]);
  for (const x of r.rows) {
    assert.deepEqual(Object.keys(x).sort(), [...COLUMNS].sort(), 'the columns of drone_reports (db/migrations/002)');
    assert.equal(x.n_samples, 120, '10 min at one sample per 5 s');
    assert.match(x.ts, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
  }
  assert.equal(r.rows[0].ts, '2026-09-27T09:40:00.000Z', 'ts = last sample of the leg');
  assert.match(r.rows[0].evidence, /^SIMULATED drone BG-UAV-07 on T-101: \d+\/120 GNSS samples degraded, no 3D fix on \d+, receiver jamming flag CRITICAL$/);
  assert.match(r.rows[1].evidence, /receiver spoofing flag on \d+\/120$/);
  assert.equal(r.rows[2].evidence, 'SIMULATED drone BG-UAV-07 on T-101: 0/120 GNSS samples degraded, no jamming or spoofing flag');
  assert.deepEqual([r.log.workflow, r.log.action], ['WF7', 'INGEST DRONE REPORT T-101']);
  assert.match(r.log.reason, /^SIMULATED sim:border-patrol-mavlink from BG-UAV-07: 89\.5_178\.5 JAMMED \d+\/120 degraded; /);
});

test('samples go to the leg of their time window, never to the (spoofed) GPS position', () => {
  const report = flight([THREE[1]]);
  const [lat, lon] = [report.samples.at(-1).lat, report.samples.at(-1).lon];
  assert.ok(report.samples.some((s) => s.spoofing_state >= 2 && s.lat < 89.5), 'the simulator moves spoofed fixes out of the planned cell');
  const r = droneReport(report, NOW);
  assert.deepEqual([r.rows.length, r.rows[0].cell_id, r.rows[0].n_samples], [1, '89.5_178.0', 120], `${lat},${lon} is ignored`);
});

test('a leg with fewer than 10 samples gets no verdict; a report with none is refused', () => {
  const report = flight(THREE);
  report.legs[2].to = new Date(Date.parse(report.legs[2].from) + 40e3).toISOString();   // 8 samples left in the window
  const r = droneReport(report, NOW);
  assert.deepEqual(r.rows.map((x) => x.cell_id), ['89.5_178.5', '89.5_178.0']);
  assert.match(r.log.reason, /under 10 samples, no verdict: 89\.5_177\.5$/);
  report.legs = [report.legs[2]];
  assert.deepEqual([droneReport(report, NOW).ok, droneReport(report, NOW).log.action], [false, 'REJECT DRONE REPORT']);
});

test('bad reports are refused and nothing from them reaches the log', () => {
  const ok = () => flight([THREE[0]]);
  const cases = {
    'no body': undefined,
    'bad cell id': { ...ok(), legs: [{ cell_id: '89.5_178.5;drop table', from: ok().legs[0].from, to: ok().legs[0].to }] },
    'id with markup': { ...ok(), sortie_id: '<b>T-1</b>' },
    'no sortie': { ...ok(), sortie_id: undefined },
    'uppercase source': { ...ok(), source: 'REAL' },
    'from after to': { ...ok(), legs: [{ ...ok().legs[0], from: ok().legs[0].to, to: ok().legs[0].from }] },
    'no fix_type': { ...ok(), samples: ok().samples.map(({ fix_type, ...s }) => s) },
  };
  for (const [name, body] of Object.entries(cases)) {
    const r = droneReport(body, NOW);
    assert.deepEqual([r.ok, r.rows.length, r.log.outcome], [false, 0, 'nothing stored'], name);
    assert.doesNotMatch(r.log.reason, /<b>|drop table/, name);
  }
  assert.match(droneReport(ok(), END + 25 * 3600e3).log.reason, /older than 24 h/, 'a replayed old report');
  assert.match(droneReport(ok(), END - 3600e3).log.reason, /in the future/);
  assert.match(droneReport({ ...ok(), samples: Array(20001).fill(ok().samples[0]) }, NOW).log.reason, /needs 1 to 20000 samples/);
});

test('a report that is not simulated carries no SIMULATED tag', () => {
  const r = droneReport({ ...flight([THREE[2]]), source: 'unit-gcs' }, NOW);
  assert.equal(r.rows[0].evidence, 'drone BG-UAV-07 on T-101: 0/120 GNSS samples degraded, no jamming or spoofing flag');
});

test('simulator: labelled simulated, MAVLink field names, same seed gives the same flight, never says safe', () => {
  const report = flight(THREE);
  assert.equal(report.source, SOURCE);
  assert.equal(SOURCE, 'sim:border-patrol-mavlink');
  assert.deepEqual(Object.keys(report.samples[0]),
    ['t', 'fix_type', 'satellites_visible', 'h_acc', 'jamming_state', 'spoofing_state', 'lat', 'lon']);
  assert.deepEqual(flight(THREE), report);
  assert.throws(() => flight([{ cell_id: '89.5_178.5', scenario: 'fine' }]), /use normal, jammed, spoofed/);
  const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, '../../shared/contracts/fixtures/drone-report.sample.json'), 'utf8'));
  assert.equal(droneReport(fixture, Date.parse(fixture.samples.at(-1).t)).ok, true, 'the C12 fixture is accepted');
  for (const f of ['droneReport.js', 'sim-drone.js']) {
    assert.doesNotMatch(fs.readFileSync(path.join(__dirname, f), 'utf8'), /\b(safe|clear|cleared)\b/i, f);
  }
});
