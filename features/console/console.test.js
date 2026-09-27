// Owner: Krish (see CLAUDE.md)
// The ops console: sortie board, pipeline summaries, drone routes, simulated fleet, demo plan, WF8 helpers, server guards, page rules.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { boardRows, column, chatThread, logKind, localTimes } = require('./board.js');
const { n8nSummary, apifySummary, telegramSummary, aircraftView, nextCollect } = require('./status.js');
const GEO = require('./geo.js');
const { routeFor, positionAt, flownPath } = require('./route.js');
const { Fleet, gnss, airborne, keptDown, cellId, SOURCE, SPEEDS } = require('./fleet.js');
const { demoPlan } = require('./demoPlan.js');
const { consoleRequest, testRowNumbers, C5 } = require('./sheetOps.js');
const { allowedHost, sameOrigin } = require('./server.js');
const { droneReport } = require('../collect/droneReport.js');

const text = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');
const row = (id, o = {}) => ({ sortie_id: id, unit: 'U (DEMO)', priority: 'routine', launch_at: '2026-09-27T10:00:00Z',
  window_end: '2026-09-27T16:00:00Z', cells: '54.0_23.0;54.0_23.5', status: 'PLANNED', decided_by: '', note: '', ...o });
const SYNC = '2026-09-27T09:00:00Z';

test('board: decisions made after the mirror synced show at once, as act.js and respond.js write them', () => {
  const sorties = [row('T-1'), row('T-2'), row('T-3', { priority: 'priority' }), row('T-4'), row('T-5', { status: 'HOLD' }), row('T-6')];
  const dec = [
    { id: 1, ts: '2026-09-27T09:05:00Z', sortie_id: 'T-1', level: 'L1_RESCHEDULE', new_launch_at: '2026-09-27T12:00:00+00:00', reason: 'moved' },
    { id: 2, ts: '2026-09-27T09:05:00Z', sortie_id: 'T-2', level: 'L2_CANCEL', reason: 'low' },
    { id: 3, ts: '2026-09-27T09:05:00Z', sortie_id: 'T-3', level: 'L3_HOLD', reason: 'priority' },
    { id: 4, ts: '2026-09-27T08:00:00Z', sortie_id: 'T-4', level: 'L3_HOLD', reason: 'old, already in the sheet' },
    { id: 5, ts: '2026-09-27T08:00:00Z', sortie_id: 'T-5', level: 'L4_SPOOF_HOLD', human_answer: 'launch', decided_by: 'human:Krish', reason: 'spoof' },
    { id: 6, ts: '2026-09-27T09:05:00Z', sortie_id: 'T-6', level: 'WATCH', reason: 'later' },
  ];
  const b = Object.fromEntries(boardRows(sorties, dec, SYNC).map((r) => [r.sortie_id, r]));
  assert.deepEqual([b['T-1'].status, b['T-1'].launch_at, b['T-1'].decided_by], ['RESCHEDULED', '2026-09-27T12:00:00Z', 'agent']);
  assert.equal(b['T-2'].status, 'CANCELLED');
  assert.deepEqual([b['T-3'].status, b['T-3'].pending], ['HOLD', true], 'a fresh HOLD waits for the officer');
  assert.equal(b['T-4'].status, 'PLANNED', 'a decision older than the sync is already in the mirror row');
  assert.deepEqual([b['T-5'].status, b['T-5'].decided_by, b['T-5'].pending], ['LAUNCH_APPROVED', 'human:Krish', false], 'an answer on Telegram');
  assert.deepEqual([b['T-6'].status, b['T-6'].level], ['PLANNED', 'WATCH'], 'WATCH changes nothing');
  assert.deepEqual(b['T-1'].cellList, ['54.0_23.0', '54.0_23.5']);
  const later = boardRows([row('T-3', { status: 'HOLD' })], [{ ...dec[2], id: 9, human_answer: 'false_alarm', decided_by: 'human:K' }], '2026-09-27T09:10:00Z');
  assert.deepEqual([later[0].status, later[0].pending], ['PLANNED', false], 'false alarm puts it back to PLANNED');
});

test('board: a reroute shows the kept cells at once; a HOLD by the agent waits for nobody; Cancel on a card cancels', () => {
  const [r, h, c] = boardRows([row('T-1'), row('T-2', { cells: '54.0_23.5' }), row('T-3', { status: 'HOLD' })], [
    { id: 1, ts: '2026-09-27T09:05:00Z', sortie_id: 'T-1', level: 'L1_REROUTE', new_cells: '54.0_23.0', reason: 'jammed 54.0_23.5' },
    { id: 2, ts: '2026-09-27T09:05:00Z', sortie_id: 'T-2', level: 'L3_AUTO_HOLD', reason: 'no slot' },
    { id: 3, ts: '2026-09-27T08:00:00Z', sortie_id: 'T-3', level: 'L3_HOLD', human_answer: 'cancel', decided_by: 'human:K', reason: 'priority' },
  ], SYNC);
  assert.deepEqual([r.status, r.cells, r.cellList, r.pending], ['REROUTED', '54.0_23.0', ['54.0_23.0'], false]);
  assert.deepEqual([h.status, h.pending, h.decided_by], ['HOLD', false, 'agent'], 'the agent held it on its own: no card, nobody asked');
  assert.deepEqual([c.status, c.decided_by], ['CANCELLED', 'human:K']);
  assert.deepEqual([r, h, c].map((x) => column(x, Date.parse('2026-09-27T09:30:00Z'), new Set())), ['changed', 'hold', 'changed']);
});

test('Telegram view: the group in order, a card answered by an edit loses its buttons, a tap quotes its card', () => {
  const card = '⛔ HOLD · T-306 · LT Border Guard · Lazdijai (DEMO) · launch 12:51\nJAMMED cell 54.0_23.5\nAgent: held. Needs your call. It never says safe.';
  const t = chatThread([
    { id: 3, ts: '2026-09-27T10:02:00Z', workflow: 'WF6', kind: 'tap', message_id: 51, text: 'Cancel', who: 'human:Krish' },
    { id: 1, ts: '2026-09-27T10:00:00Z', workflow: 'WF3', kind: 'message', message_id: 50, text: '🧭 REROUTED · T-305', buttons: null },
    { id: 2, ts: '2026-09-27T10:00:01Z', workflow: 'WF3', kind: 'message', message_id: 51, text: card, buttons: [['Hold', 'Launch anyway', 'Cancel']] },
    { id: 4, ts: '2026-09-27T10:02:01Z', workflow: 'WF6', kind: 'edit', message_id: 51, text: `${card}\n\n✖️ Cancelled by Krish at 12:02.` },
    { id: 5, ts: '2026-09-27T10:03:00Z', workflow: 'WF6', kind: 'edit', message_id: 7, text: 'a card sent before the log began' },
  ]);
  assert.deepEqual(t.map((m) => [m.type, m.id]), [['bot', 1], ['bot', 2], ['tap', 3], ['bot', 5]]);
  assert.deepEqual([t[1].buttons, t[1].edited, t[1].text.endsWith('✖️ Cancelled by Krish at 12:02.')], [null, '2026-09-27T10:02:01Z', true]);
  assert.deepEqual([t[2].who, t[2].label, t[2].quote], ['Krish', 'Cancel', '⛔ HOLD · T-306 · LT Border Guard · Lazdijai (DEMO) · launch 12:51']);
  const open = chatThread([{ id: 9, ts: 't', workflow: 'WF3', kind: 'message', message_id: 60, text: card, buttons: [['Hold', 'Launch anyway', 'Cancel']] }]);
  assert.deepEqual(open[0].buttons, [['Hold', 'Launch anyway', 'Cancel']], 'unanswered: the buttons are still there');
});

test('board: columns and log kinds', () => {
  const now = Date.parse('2026-09-27T09:30:00Z');
  const [held, flying, moved, upcoming, past] = boardRows([row('T-1'), row('T-2', { launch_at: '2026-09-27T09:10:00Z' }), row('T-3'), row('T-4'),
    row('T-5', { launch_at: '2026-09-27T07:00:00Z' })], [{ id: 1, ts: '2026-09-27T09:20:00Z', sortie_id: 'T-1', level: 'L3_HOLD' },
    { id: 2, ts: '2026-09-27T09:20:00Z', sortie_id: 'T-3', level: 'L2_CANCEL' }], SYNC);
  const fly = new Set(['T-2']);
  assert.deepEqual([held, flying, moved, upcoming, past].map((r) => column(r, now, fly)), ['officer', 'flight', 'changed', 'upcoming', 'past']);
  assert.deepEqual(['WF2', 'WF3', 'WF6', 'WF7', 'WF8', 'WF1', 'WF4'].map(logKind), ['agent', 'agent', 'officer', 'drone', 'console', 'pipeline', 'pipeline']);
});

test('CEST on screen: "HH:MM UTC" inside stored text is shown in CEST, on the right day', () => {
  const tz = 'Europe/Amsterdam';
  assert.equal(localTimes('launch 01:00→03:00 UTC, sheet RESCHEDULED', '2026-09-27T00:01:01Z', tz), 'launch 03:00→05:00 CEST, sheet RESCHEDULED');
  assert.equal(localTimes('approved by K at 22:55 UTC despite: x', '2026-09-26T22:55:46Z', tz), 'approved by K at 00:55 CEST despite: x');
  assert.equal(localTimes('moved +2 h 23:30→01:30 UTC', '2026-09-26T23:31:00Z', tz), 'moved +2 h 01:30→03:30 CEST');
  assert.equal(localTimes('held at 12:00 UTC', '2026-12-01T12:00:00Z', tz), 'held at 13:00 CET', 'winter time says CET');
  assert.equal(localTimes('2026-09-27T01:00:00Z and 10:00 local stay', '2026-09-27T00:00:00Z', tz), '2026-09-27T01:00:00Z and 10:00 local stay');
});

test('status: n8n, Apify and Telegram summaries carry names, states and times only', () => {
  const now = Date.parse('2026-09-27T10:00:00Z');
  const n = n8nSummary([{ id: 'a', name: 'AirGuard WF1 Collect', active: true }, { id: 'b', name: 'AirGuard TEMP x', active: true }, { id: 'c', name: 'Other' }],
    [{ workflowId: 'a', status: 'success', startedAt: '2026-09-27T09:55:00Z', stoppedAt: '2026-09-27T09:55:03Z' },
      { workflowId: 'a', status: 'error', startedAt: '2026-09-27T09:50:00Z' }, { workflowId: 'a', status: 'success', startedAt: '2026-09-27T07:00:00Z' }], now);
  assert.deepEqual(Object.keys(n), ['WF1'], 'only the AirGuard WFn workflows');
  assert.deepEqual([n.WF1.last.status, n.WF1.hour], ['success', { runs: 2, errors: 1 }]);
  const a = apifySummary([{ id: 'r2', status: 'FAILED', startedAt: '2026-09-27T09:55:00Z', finishedAt: '2026-09-27T09:55:30Z' },
    { id: 'r1', status: 'SUCCEEDED', startedAt: '2026-09-27T09:50:00Z', finishedAt: '2026-09-27T09:50:08Z' }],
  { source: 'adsb.fi', aircraft: 31, failover: true, errors: ['adsb.lol: HTTP 503'] }, { cronExpression: '*/5 * * * *', isEnabled: true, nextRunAt: '2026-09-27T10:00:00Z' }, now);
  assert.deepEqual([a.last.status, a.lastOk.secs, a.source, a.failover, a.hour], ['FAILED', 8, 'adsb.fi', true, { runs: 2, failed: 1 }]);
  assert.deepEqual(a.schedule, { cron: '*/5 * * * *', enabled: true, nextRunAt: '2026-09-27T10:00:00Z' });
  const t = telegramSummary({ username: 'airguard_ops_demo_bot' }, { url: 'https://x/webhook/y', pending_update_count: 0, last_error_date: now / 1000 - 60, last_error_message: 'Bad Gateway' }, now,
    { id: -1234567890, title: 'AirGuard Ops', type: 'group' }, 3);
  assert.deepEqual(t, { bot: 'airguard_ops_demo_bot', webhook: true, pending: 0, lastError: { at: '2026-09-27T09:59:00.000Z', message: 'Bad Gateway' },
    group: { title: 'AirGuard Ops', members: 3 } });
  assert.equal(JSON.stringify(t).includes('https://x'), false, 'the webhook URL never reaches the browser');
  assert.equal(JSON.stringify(t).includes('1234567890'), false, 'nor the group id');
  assert.equal(nextCollect(Date.parse('2026-09-27T10:02:10Z')), '2026-09-27T10:05:00.000Z');
});

test('aircraft: the real sensor network at the last collect, with the binCells rules', () => {
  const v = aircraftView([{ ts: '2026-09-27T10:00:01Z', source: 'adsb.lol', hex: 'abc', flight: 'LOT3KM  ', lat: 54.123456, lon: 23.5, nic: 8, nac_p: 9, alt_geom: 36000, alt_baro: 35900 },
    { ts: 't', hex: 'def', lat: 55, lon: 24, nic: 5, nac_p: 9, alt_geom: 30000, alt_baro: 28000 }, { hex: 'no-sensor', lat: 56, lon: 25, alt_baro: 'ground' },
    { empty: true, errors: ['x'] }, { hex: 'no position' }]);
  assert.deepEqual([v.ts, v.source, v.aircraft.length], ['2026-09-27T10:00:01Z', 'adsb.lol', 3]);
  assert.deepEqual(v.aircraft[0], { lat: 54.1235, lon: 23.5, flight: 'LOT3KM', alt: 35900, sensor: true, degraded: false, spoof: false });
  assert.deepEqual([v.aircraft[1].degraded, v.aircraft[1].spoof], [true, true]);
  assert.deepEqual([v.aircraft[2].sensor, v.aircraft[2].degraded, v.aircraft[2].spoof], [false, false, false]);
});

test('map region: the eastern flank from the design; every demo sortie and every outline fits inside it', () => {
  const R = GEO.REGION, inside = (lat, lon) => lat >= R.lat0 && lat <= R.lat1 && lon >= R.lon0 && lon <= R.lon1;
  assert.deepEqual(R, { lat0: 53.5, lat1: 60.9, lon0: 17.6, lon1: 30.6 });
  for (const r of demoPlan(new Date('2026-09-27T10:00:00Z'))) for (const c of r.cells.split(';')) {
    const [la, lo] = c.split('_').map(Number);
    assert.ok(inside(la, lo) && inside(la + 0.5, lo + 0.5), `${r.sortie_id} cell ${c} is on the map`);
  }
  for (const [lon, lat] of [...GEO.COAST.flat(), ...GEO.BORDERS.flatMap(([line]) => line)]) assert.ok(inside(lat, lon), `${lat},${lon}`);
});

test('fleet: routes stay inside their planned cells, both ways along a line and round a box', () => {
  const line = routeFor(['54.0_23.0', '54.0_23.5']), box = routeFor(['59.0_27.5']);
  assert.deepEqual([line.loop, box.loop, routeFor(['nonsense']).points.length], [false, true, 0]);
  for (let d = 0; d < 200e3; d += 1500) {
    const p = positionAt(line, d);
    assert.ok(['54.0_23.0', '54.0_23.5'].includes(cellId(p.lat, p.lon)), `line at ${d} m`);
    assert.equal(cellId(positionAt(box, d).lat, positionAt(box, d).lon), '59.0_27.5', `box at ${d} m`);
  }
  const L = 0.5 * 111320 * Math.cos(54.25 * Math.PI / 180);     // the line from 54.25,23.25 to 54.25,23.75
  const out = positionAt(line, 10e3), back = positionAt(line, 2 * L - 10e3);
  assert.ok(Math.abs(out.lat - back.lat) < 1e-6 && Math.abs(out.lon - back.lon) < 1e-6, 'the way back passes the same points');
  assert.equal((out.hdg + 180) % 360, back.hdg);
  assert.deepEqual([out.pass, out.back, back.pass, back.back], [1, false, 2, true]);
  const lap2 = positionAt(box, positionAt(box, 0).len + 5e3);
  assert.deepEqual([lap2.pass, lap2.back, Math.round(lap2.along)], [2, false, 5000], 'the box: lap after lap, never back');
});

test('route: the flown part is this pass so far, from where it began to the drone', () => {
  const line = routeFor(['54.0_23.0', '54.0_23.5']), box = routeFor(['59.0_27.5']);
  const L = positionAt(line, 0).len, [a, b] = line.points;
  assert.deepEqual(flownPath(line, 0), [a, a]);
  const out = flownPath(line, 10e3);
  assert.deepEqual([out.length, out[0]], [2, a], 'out: from the first cell centre');
  assert.ok(Math.abs(out[1][1] - (a[1] + (b[1] - a[1]) * 10e3 / L)) < 1e-9);
  const back = flownPath(line, L + 4e3);
  assert.deepEqual([back.length, back[0]], [2, b], 'back: from the far end, the old pass is not drawn');
  const edge = positionAt(box, 0).len / 4;                    // the box's first side, its long east-west one, is not a quarter
  const lap = flownPath(box, 1.5 * edge), [p0, p1] = box.points;
  assert.deepEqual(lap.slice(0, 2), [p0, p1], 'a lap: the corners passed so far, then the drone');
  assert.deepEqual(lap.at(-1), (({ lat, lon }) => [lat, lon])(positionAt(box, 1.5 * edge)));
  assert.equal(flownPath(box, positionAt(box, 0).len + 1).length, 2, 'a new lap starts from the first corner again');
  assert.deepEqual(routeFor(['54.0_23.0', '54.0_23.0', 'x']), routeFor(['54.0_23.0']), 'a cell named twice is one cell');
});

test('fleet: only sorties the sheet and the gate let fly take off; HOLD and CANCELLED stay down', () => {
  const now = Date.parse('2026-09-27T10:30:00Z'), rows = (s) => boardRows(s, [], SYNC);
  const R = rows([row('T-1', { launch_at: '2026-09-27T10:00:00Z' }), row('T-2', { launch_at: '2026-09-27T10:00:00Z', status: 'HOLD' }),
    row('T-3', { launch_at: '2026-09-27T10:00:00Z', status: 'CANCELLED' }), row('T-4', { launch_at: '2026-09-27T09:00:00Z' }),
    row('T-5', { launch_at: '2026-09-27T11:00:00Z' }), row('T-6', { launch_at: '2026-09-27T10:10:00Z', status: 'LAUNCH_APPROVED' })]);
  assert.deepEqual(airborne(R, now).map((s) => s.sortie_id), ['T-1', 'T-6'], 'launch passed less than 60 min ago');
  assert.deepEqual(keptDown(R, now).map((s) => s.sortie_id), ['T-2', 'T-3']);
});

test('fleet: a simulated jammer degrades the drone, the leg report is C12 and names the planned cell', () => {
  let seed = 7;
  const rng = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const sent = [];
  const f = new Fleet({ post: (r) => { sent.push(r); return Promise.resolve(); }, rng });
  const t0 = Date.parse('2026-09-27T10:00:00Z');
  f.setSorties(boardRows([row('T-9', { launch_at: '2026-09-27T09:59:00Z', cells: '59.0_27.5' })], [], SYNC));
  f.setEffect('59.0_27.5', 'jam');
  assert.throws(() => f.setEffect('59.0_27.5;drop', 'jam'), /cell_id/);
  let snap;
  for (let i = 0; i < 20; i++) snap = f.tick(t0 + i * 2000);
  const d = snap.drones[0];
  assert.deepEqual([snap.drones.length, d.sortie_id, d.env, d.cell], [1, 'T-9', 'JAMMED', '59.0_27.5']);
  assert.match(d.drone_id, /^BG-UAV-\d\d$/);
  assert.equal(sent.length, 1, 'one early report after 15 bad samples');
  const r = droneReport(sent[0], t0 + 40e3);
  assert.deepEqual([r.ok, r.rows[0].cell_id, r.rows[0].verdict, sent[0].source], [true, '59.0_27.5', 'JAMMED', SOURCE]);
  assert.match(r.rows[0].evidence, /^SIMULATED drone BG-UAV-\d\d on T-9: /);
  assert.ok(snap.events.some((e) => e.action.startsWith('GNSS DEGRADED')) && snap.events.some((e) => e.action.startsWith('TAKEOFF')));
  f.setEffect('59.0_27.5', 'none');
  assert.deepEqual(f.tick(t0 + 42e3).effects, []);
  f.setSorties([]);
  const landed = f.tick(t0 + 44e3);
  assert.deepEqual([landed.drones.length, landed.events[0].action.startsWith('LANDED')], [0, true]);
  assert.equal(f.environment('54.0_23.0'), 'NORMAL', 'real data never degrades a simulated drone by default');
  f.setRealBad([{ cell_id: '54.0_23.0', state: 'JAMMED' }]);
  assert.equal(f.environment('54.0_23.0'), 'NORMAL');
  f.mirrorReal = true;
  assert.equal(f.environment('54.0_23.0'), 'JAMMED', 'only with --mirror-real');
  const g = gnss('SPOOF', () => 0.1);
  assert.deepEqual([g.fix_type, g.spoofing_state >= 2, g.gap > 100], [3, true, true], 'a spoofer hands out a confident fix');
});

for (const speed of [10, 20]) {
  test(`fleet: a fast demo fleet (${speed}x) still sends few reports (each is an n8n execution); ground speed stays the cruise speed`, () => {
    const sent = [];
    const f = new Fleet({ post: (r) => { sent.push(r); return Promise.resolve(); }, speed, rng: () => 0.3 });
    const t0 = Date.parse('2026-09-27T10:00:00Z');
    f.setSorties(boardRows([row('T-8', { launch_at: '2026-09-27T09:59:00Z' })], [], SYNC));   // a line across 54.0_23.0 and 54.0_23.5
    f.setEffect('54.0_23.5', 'jam');
    let snap;
    for (let t = t0; t < t0 + 30 * 60e3; t += 2000) snap = f.tick(t);
    const early = sent.filter((r) => r.legs[0].cell_id === '54.0_23.5');
    assert.ok(sent.length >= 3 && sent.length <= 9, `${sent.length} reports in 30 min at ${speed}x`);
    assert.ok(early.length >= 1, 'the jammed cell is reported');
    assert.ok(snap.drones[0].spd > 20 && snap.drones[0].spd < 30, 'cruise speed, not cruise x the demo factor');
  });
}

test('fleet: the speed switch (real time, 10x, 20x) keeps every drone where it is and only changes how fast it moves on', () => {
  const f = new Fleet({ post: () => Promise.resolve(), speed: 10, rng: () => 0.3 });
  const t0 = Date.parse('2026-09-27T10:00:00Z');
  f.setSorties(boardRows([row('T-8', { launch_at: '2026-09-27T09:59:00Z' })], [], SYNC));
  const a = f.tick(t0).drones[0];
  assert.equal(a.dist, 25 * 10 * 60, 'takeoff a minute ago at 10x: 15 km along');
  f.setSpeed(20, t0 + 1000);
  const b = f.tick(t0 + 1000).drones[0];
  assert.equal(b.dist, a.dist + 250, 'the second before the switch still flew at 10x');
  assert.deepEqual(f.tick(t0 + 3000).drones[0].dist, b.dist + 1000, 'then 20x');
  f.setSpeed(1, t0 + 3000);
  assert.equal(f.tick(t0 + 5000).drones[0].dist, b.dist + 1000 + 50, 'real time: 25 m/s');
  assert.deepEqual(SPEEDS, [1, 10, 20]);
  for (const bad of [5, '10', 0, null]) assert.throws(() => f.setSpeed(bad), /speed must be 1, 10, 20/);
  assert.equal(f.speed, 1);
  assert.match(f.tick(t0 + 7000).events.find((e) => e.action.startsWith('SIMULATION SPEED')).action, /^SIMULATION SPEED REAL TIME$/);
  const where = positionAt(routeFor(['54.0_23.0', '54.0_23.5']), b.dist);
  assert.ok(Math.abs(where.lat - b.lat) < 1e-5 && Math.abs(where.lon - b.lon) < 1e-5, 'the map computes the same position from dist');
});

test('demo plan: 16 fictional C5 test sorties on the eastern-flank borders, 4 already launched', () => {
  const now = new Date('2026-09-27T10:00:30Z'), rows = demoPlan(now);
  assert.equal(rows.length, 16);
  assert.deepEqual(rows.map((r) => r.sortie_id), Array.from({ length: 16 }, (_, i) => `T-${301 + i}`));
  for (const r of rows) {
    assert.deepEqual(Object.keys(r), C5);
    assert.match(r.launch_at, /^\d{4}-\d\d-\d\dT\d\d:\d\d:00Z$/);
    assert.ok(Date.parse(r.window_end) > Date.parse(r.launch_at));
    assert.match(r.unit, /\(DEMO\)$/);
    assert.equal(consoleRequest({ op: 'load', rows: [r] }).ok, true, `${r.sortie_id} passes WF8`);
  }
  assert.equal(rows.filter((r) => Date.parse(r.launch_at) <= now.getTime()).length, 4);
  assert.deepEqual([...new Set(rows.map((r) => r.priority))].sort(), ['low', 'priority', 'routine']);
});

test('demo plan: one simulated jammer on Lazdijai 54.0_23.5 gives a reroute and a reschedule (texts) and a card, no brake', () => {
  const { decide } = require('../gate/decide.js');
  const now = new Date('2026-09-27T10:00:00Z'), rows = demoPlan(new Date(now.getTime() - 10 * 60e3));   // the jammer 10 min after loading
  const cells = { '54.0_23.5': { cell_id: '54.0_23.5', state: 'JAMMED', incident_id: 90, severity: 'medium', evidence: 'SIMULATED drone BG-UAV-05: 20/40 degraded' } };
  const out = decide({ sorties: rows, cells, now }).filter((a) => a.incident_id === 90);
  assert.deepEqual(out.map((a) => [a.sortie_id, a.level, a.human, a.new_cells]), [
    ['T-305', 'L1_REROUTE', false, '54.0_23.0'], ['T-306', 'L3_HOLD', true, undefined], ['T-307', 'L1_RESCHEDULE', false, undefined]]);
  const fly = airborne(boardRows(rows.map((r) => ({ ...r })), [], SYNC), now.getTime()).map((s) => [s.sortie_id, s.cells]);
  assert.ok(fly.some(([id, c]) => id === 'T-301' && c.includes('54.0_23.5')), 'a drone is up over the jammed cell to feel it');
});

test('C14 telegram_log: the n8n parameters for a card, a text, an edit, a tap and a refused tap, never an id or a stranger', () => {
  const { TG_SQL, sentParams, editParams, tapParams, refusedParams } = require('./telegramLog.js');
  const run = (expr, $json, trigger) => {
    assert.match(expr, /^=\{\{ .* \}\}$/s);
    return new Function('$json', '$', `return (${expr.slice(4, -3)});`)($json, () => ({ first: () => ({ json: trigger }) }));
  };
  const card = { ok: true, result: { message_id: 51, from: { id: 1, is_bot: true }, chat: { id: -100123, type: 'group' }, date: 1790500000,
    text: '⛔ HOLD · T-306', reply_markup: { inline_keyboard: [[{ text: 'Hold', callback_data: 'k|T-306|9' },
      { text: 'Launch anyway', callback_data: 'l|T-306|9' }, { text: 'Cancel', callback_data: 'c|T-306|9' }]] } } };
  assert.deepEqual(run(sentParams('WF3'), card), ['WF3', 'message', '51', '⛔ HOLD · T-306', '[["Hold","Launch anyway","Cancel"]]', '', '1790500000']);
  assert.deepEqual(run(sentParams('WF4'), { ok: true, result: { message_id: 7, date: 1, text: '⚠️ AirGuard: x' } }), ['WF4', 'message', '7', '⚠️ AirGuard: x', '', '', '1']);
  assert.deepEqual(run(editParams, { ok: true, result: { message_id: 51, date: 1790500000, edit_date: 1790500100, text: 'card\n\n✖️ Cancelled' } }),
    ['WF6', 'edit', '51', 'card\n\n✖️ Cancelled', '', '', '1790500100']);
  assert.deepEqual(run(tapParams, { message_id: 51, label: 'Cancel', who: 'human:Krish', chat_id: -100123 }), ['WF6', 'tap', '51', 'Cancel', '', 'human:Krish', '']);
  const refused = run(refusedParams, {}, { callback_query: { from: { id: 999, first_name: 'Mallory' }, message: { message_id: 51, chat: { id: -100123 } }, data: 'l|T-306|9' } });
  assert.deepEqual(refused, ['WF6', 'tap', '51', 'a button', '', 'not on the allowlist', '']);
  for (const p of [run(sentParams('WF3'), card), refused]) assert.doesNotMatch(JSON.stringify(p), /100123|Mallory|999|\|T-306/, 'no chat id, user id, name or callback data');
  assert.deepEqual([...TG_SQL.matchAll(/\$(\d)/g)].map((m) => m[1]), ['1', '2', '3', '4', '5', '6', '7']);
  const alert = run(sentParams('WF4'), { ok: true, result: { message_id: 8, date: 2, text: '⚠️ AirGuard: WF1 failed\nhttps://example.app.n8n.cloud/workflow/x/executions/9' } });
  assert.equal(alert[3], '⚠️ AirGuard: WF1 failed\n[link]', 'no link reaches the anon-readable log');
});

test('C14: every Telegram message any workflow sends goes to its "Telegram log" node right away', () => {
  const { TG_SQL, sentParams } = require('./telegramLog.js');
  const exports = { WF2: '../detect/wf2-detect.json', WF3: '../gate/wf3-gate.json', WF4: '../collect/wf4-heal.json', WF5: '../detect/wf5-report.json' };
  for (const [wfn, f] of Object.entries(exports)) {
    const wf = JSON.parse(text(f)), log = wf.nodes.find((n) => n.name === 'Telegram log');
    assert.deepEqual([log.parameters.query, log.parameters.options.queryReplacement, log.onError], [TG_SQL, sentParams(wfn), 'continueRegularOutput'], wfn);
    const senders = wf.nodes.filter((n) => n.type === 'n8n-nodes-base.telegram' && (n.parameters.operation ?? 'sendMessage') === 'sendMessage');
    assert.ok(senders.length > 0, wfn);
    for (const n of senders) assert.ok((wf.connections[n.name]?.main?.[0] ?? []).some((x) => x.node === 'Telegram log'), `${wfn}: ${n.name} → Telegram log`);
  }
});

test('WF8 helpers: only valid test rows are written, only test rows are deleted, bottom up', () => {
  assert.equal(consoleRequest({ op: 'drop' }).ok, false);
  assert.deepEqual(consoleRequest({ op: 'remove', rows: [row('S-1')] }), { ok: true, op: 'remove', rows: [], reason: '' });
  assert.match(consoleRequest({ op: 'load', rows: [row('S-001')] }).reason, /test id/);
  assert.match(consoleRequest({ op: 'load', rows: [row('T-1', { cells: "x'; drop table" })] }).reason, /cells/);
  assert.match(consoleRequest({ op: 'load', rows: [row('T-1', { launch_at: 'tomorrow' })] }).reason, /UTC ISO/);
  assert.equal(consoleRequest({ op: 'load', rows: [] }).ok, false);
  const ok = consoleRequest({ op: 'load', rows: [row('T-1', { extra: 'x', note: 7 })] });
  assert.deepEqual(Object.keys(ok.rows[0]), C5, 'only C5 columns reach the sheet');
  assert.equal(ok.rows[0].note, '7');
  assert.deepEqual(testRowNumbers([{ sortie_id: 'T-1', row_number: 2 }, { sortie_id: 'S-1', row_number: 3 }, { sortie_id: ' T-20 ', row_number: 7 },
    { sortie_id: 'T-3', row_number: 1 }, {}, { sortie_id: 'T-x', row_number: 9 }]), [7, 2]);
});

test('WF8 Console export: C9, secret header, tested code + documented glue, only test rows, mirror synced, one log line', () => {
  const wf = JSON.parse(text('wf8-console.json')), node = (n) => wf.nodes.find((x) => x.name === n);
  const next = (n, o) => (o === undefined ? (wf.connections[n]?.main ?? []).flat() : wf.connections[n]?.main?.[o] ?? []).map((c) => c.node);
  assert.equal(wf.name, 'AirGuard WF8 Console');
  const hook = node('Console request');
  assert.deepEqual([hook.parameters.path, hook.parameters.authentication, hook.credentials], ['airguard-console', 'headerAuth', { httpHeaderAuth: { name: 'AirGuard Console' } }]);
  assert.deepEqual(next('Console request'), ['Config'], 'Config follows the trigger (C9)');
  assert.equal(node('Config').parameters.assignments.assignments[0].value, 'your_google_sheet_id', 'the real sheet id is set at import');
  for (const n of wf.nodes) for (const ref of Object.values(n.credentials ?? {})) {
    assert.ok(['AirGuard Postgres', 'AirGuard Sheets', 'AirGuard Console'].includes(ref.name), n.name);
    assert.equal(ref.id, undefined, `${n.name}: credential id removed`);
  }
  const src = text('sheetOps.js');
  for (const n of ['Request', 'Test rows', 'Log line']) {
    const code = node(n).parameters.jsCode;
    assert.ok(code.startsWith(src), `${n} = sheetOps.js + glue`);
    for (const line of code.slice(src.length).split('\n').filter(Boolean)) assert.ok(src.includes(`// ${line}`), `${n}: glue "${line}" documented`);
  }
  assert.deepEqual([next('Valid?', 0), next('Valid?', 1), next('Sync only?', 0), next('Sync only?', 1)], [['Sync only?'], ['Refused'], ['Read after'], ['Read before']]);
  assert.deepEqual([next('Any test rows?', 0), next('Any test rows?', 1), next('Delete row'), next('New rows?', 0), next('New rows?', 1)],
    [['Each test row'], ['New rows?'], ['New rows?'], ['Each new row'], ['Read after']]);
  assert.deepEqual(['Append rows', 'Read after', 'Sync mirror', 'Log line', 'Insert agent_log'].map((n) => next(n)),
    [['Read after'], ['Sync mirror'], ['Log line'], ['Insert agent_log'], ['Result']]);
  assert.equal(node('Delete row').parameters.startIndex, '={{ $json.row }}');
  assert.deepEqual([node('New rows?').executeOnce, node('Read after').executeOnce, node('Sync mirror').executeOnce], [true, true, true], 'once, however many rows came before');
  assert.equal(node('Append rows').parameters.options.cellFormat, 'RAW', 'ISO timestamps stay text');
  assert.equal(node('Sync mirror').parameters.query, require('./sheetOps.js').mirrorQuery('Read after', 'WF8'));
  assert.doesNotMatch(JSON.stringify(wf.nodes.map(({ parameters: { jsCode, ...p } }) => p)), /\b(safe|clear|cleared|green)\b/i);
});

test('server: only this host, and POSTs only from this page', () => {
  assert.deepEqual(['localhost:8787', '127.0.0.1:8787', 'LOCALHOST:8787', 'evil.example:8787', 'localhost:9999', undefined].map((h) => allowedHost(h, 8787)),
    [true, true, true, false, false, false]);
  assert.deepEqual(['http://localhost:8787', 'http://127.0.0.1:8787', 'https://localhost:8787', 'http://evil.example', undefined, 'null'].map((o) => sameOrigin(o, 8787)),
    [true, true, false, false, false, false]);
  const server = text('server.js');
  assert.match(server, /server\.listen\(PORT, HOST/);
  assert.match(server, /const HOST = '127\.0\.0\.1'/);
  assert.ok(server.indexOf("pathname === '/api/fleet/speed'") > server.indexOf('if (!sameOrigin('), 'the speed switch is a POST behind the origin check');
});

const PAGE_FILES = ['index.html', 'app.js', 'board.js', 'route.js', 'geo.js', 'fleet.js', 'demoPlan.js', 'sheetOps.js', 'status.js', 'server.js', 'telegramLog.js'];
test('page: never safe or clear, no green, no key in the repo, CEST, pinned and checked libraries', () => {
  for (const f of PAGE_FILES) {
    const src = text(f).replace(/never (shows|says) safe/g, '');
    assert.doesNotMatch(src, /\b(safe|clear|cleared)\b/i, `${f}: never safe or clear`);
    assert.doesNotMatch(src, /green|lime|#0f0\b|#00ff00|🟢|✅/i, `${f}: no green`);
    assert.doesNotMatch(src, /eyJ[A-Za-z0-9_-]{20,}|[a-z0-9]{20}\.supabase\.co|\d{8,10}:[A-Za-z0-9_-]{35}/, `${f}: no key, project URL or bot token`);
  }
  const html = text('index.html'), app = text('app.js');
  assert.ok(!fs.existsSync(path.join(__dirname, 'config.js')), 'config.js is served at runtime, never a file');
  for (const lib of html.match(/<script src="https[^"]+"[^>]*>/g)) assert.match(lib, /integrity="sha384-[^"]+" crossorigin="anonymous"/, lib);
  assert.match(html, /supabase-js@2\.\d+\.\d+\//, 'supabase-js pinned');
  assert.match(app, /const TZ = 'Europe\/Amsterdam'/, 'CEST on screen');
  assert.doesNotMatch(html + app, /tile\/|tileLayer|basemaps|arcgisonline/, 'no tile server: the map is drawn from geo.js');
  assert.match(app, /map\.setMinZoom\(z\)/, 'zoomed all the way out shows the region; no further out');
  assert.match(app, /maxBounds: REGION/, 'panning stays inside the region');
  assert.doesNotMatch(app, /toLocale\w*String\(\)|getHours\(\)/, 'no browser-local time');
});

test('page: the one green is the selected drone\'s planned path (asked for by Krish), a route and never a status', () => {
  const PLAN = '#39ff14';
  const rgb = (h) => (h.length === 4 ? [...h.slice(1)].map((c) => parseInt(c + c, 16)) : [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)));
  const green = (h) => { const [r, g, b] = rgb(h); return g > 1.3 * r && g > 1.3 * b; };
  assert.deepEqual(['#39ff14', '#0f0', '#62e3f1', '#ffc15a', '#b4c6d8', '#ff6b6b'].map(green), [true, true, false, false, false, false]);
  for (const f of PAGE_FILES) {
    for (const h of text(f).match(/#[0-9a-f]{6}\b|#[0-9a-f]{3}\b/gi) || []) if (green(h)) assert.equal(h.toLowerCase(), PLAN, `${f}: ${h} is green`);
    for (const m of text(f).matchAll(/rgba?\((\d+),\s*(\d+),\s*(\d+)/g)) assert.ok(!(m[2] > 1.3 * m[1] && m[2] > 1.3 * m[3]), `${f}: ${m[0]} is green`);
  }
  const html = text('index.html'), app = text('app.js');
  assert.deepEqual((html + app).match(/#39ff14/gi), [PLAN], 'defined once, as the --plan token');
  assert.match(html, /--plan:#39ff14;/);
  assert.deepEqual(html.match(/.*var\(--plan\).*/g).map((l) => /\.sw\.plan|planned path/.test(l)), [true, true], 'only the legend and drawer swatches of the planned path');
  assert.equal(app.match(/COL\.plan/g).length, 2, 'drawn twice, both in drawPath: the planned path and its glow');
  const draw = app.slice(app.indexOf('function drawPath'), app.indexOf('function routeProgress'));
  assert.equal(draw.match(/COL\.plan/g).length, 2);
  assert.match(html, /planned path \(a route, not a status\)/, 'the legend says what it is');
});
