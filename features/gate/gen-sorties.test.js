// Owner: Person B (see CLAUDE.md)
// gen-sorties: the coverage pick, the 48-sortie plan (plan §6 "Demo sorties") and the committed sorties.demo.csv obey C5.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { genSorties, coveredCells, toCsv } = require('./gen-sorties');

const HOUR = 3600e3;
const NOW = new Date('2026-09-26T21:05:03.412Z');
const C5 = ['sortie_id', 'unit', 'priority', 'launch_at', 'window_end', 'cells', 'status', 'decided_by', 'note'];
const CELL_RE = /^-?\d+\.\d_-?\d+\.\d$/;
const cellId = (lat, lon) => `${(Math.floor(lat / 0.5) * 0.5).toFixed(1)}_${(Math.floor(lon / 0.5) * 0.5).toFixed(1)}`;

// Minimal RFC 4180 parser: quoted fields may contain commas (the unit name does).
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += ch;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}
const readRows = (text) => {
  const [header, ...lines] = parseCsv(text);
  assert.deepEqual(header, C5);
  return lines.map((cols) => Object.fromEntries(header.map((h, i) => [h, cols[i]])));
};

// Every plan §6 rule that holds for any input: 48 PLANNED demo sorties, 12/24/12, a launch every 30 min,
// window_end by priority, routes of 1–3 adjacent C1 cells (from `covered` when given).
function assertPlan(rows, covered) {
  assert.deepEqual(rows.map((r) => r.sortie_id), Array.from({ length: 48 }, (_, i) => `S-${String(i + 1).padStart(3, '0')}`));
  const count = (p) => rows.filter((r) => r.priority === p).length;
  assert.deepEqual([count('priority'), count('routine'), count('low')], [12, 24, 12]);
  rows.forEach((r, i) => {
    assert.equal(r.unit, '3rd Border Drone Sqn (DEMO, fictional)');
    assert.match(r.launch_at, /^\d{4}-\d\d-\d\dT\d\d:[03]0:00Z$/);
    assert.match(r.window_end, /^\d{4}-\d\d-\d\dT\d\d:[03]0:00Z$/);
    if (i) assert.equal(Date.parse(r.launch_at) - Date.parse(rows[i - 1].launch_at), HOUR / 2, `${r.sortie_id} 30 min later`);
    assert.equal(Date.parse(r.window_end) - Date.parse(r.launch_at), { priority: 1, routine: 6, low: 3 }[r.priority] * HOUR);
    const route = r.cells.split(';');
    assert.ok(route.length >= 1 && route.length <= 3, `${r.sortie_id} route of 1–3 cells`);
    assert.equal(new Set(route).size, route.length, `${r.sortie_id} no cell twice`);
    route.forEach((c, k) => {
      assert.match(c, CELL_RE);
      const [lat, lon] = c.split('_').map(Number);
      assert.equal(cellId(lat, lon), c, 'matches cellId()');
      if (covered) assert.ok(covered.includes(c), `${c} has coverage`);
      if (k) {
        const [plat, plon] = route[k - 1].split('_').map(Number);
        assert.ok(Math.abs(lat - plat) <= 0.5 && Math.abs(lon - plon) <= 0.5, `${r.sortie_id} ${route[k - 1]} → ${c} adjacent`);
      }
    });
    assert.deepEqual([r.status, r.decided_by, r.note], ['PLANNED', '', '']);
  });
  assert.ok(Date.parse(rows[47].launch_at) - Date.parse(rows[0].launch_at) < 24 * HOUR, 'within the next 24 h');
}

test('coveredCells: >= 3 aircraft in >= 60% of the cycles; test cells and non-sensors never count', () => {
  const cycles = ['2026-09-26T20:40:00Z', '2026-09-26T20:45:00Z', '2026-09-26T20:50:00Z', '2026-09-26T20:55:00Z', '2026-09-26T21:00:00Z'];
  const obs = [
    ...cycles.map((ts, i) => ({ ts, cell_id: '54.5_20.5', n_total: i < 3 ? 4 : 1 })), // 3 of 5 = 60%: in
    ...cycles.map((ts, i) => ({ ts, cell_id: '59.5_25.0', n_total: i < 2 ? 9 : 2 })), // 2 of 5 = 40%: out
    ...cycles.map((ts) => ({ ts, cell_id: '56.5_21.0', n_total: 2 })), //                never 3: out
    ...cycles.map((ts) => ({ ts, cell_id: '89.5_179.0', n_total: 5 })), //               C11 test cell: out
    { ts: cycles[4], cell_id: '55.0_21.0', n_total: null }, //                           stale/no sensors: out
  ];
  assert.deepEqual(coveredCells(obs), [{ cell_id: '54.5_20.5', coverage: 0.6 }]);
  assert.deepEqual(coveredCells(obs, 0.4).map((c) => c.cell_id), ['54.5_20.5', '59.5_25.0'], 'a lower bar (--min-share)');
});

test('genSorties: border cells start routes first, at most 16 start cells, routes follow covered neighbours', () => {
  const border = ['54.5_20.5', '54.5_21.0', '55.0_21.0', '59.5_25.0']; // Kaliningrad cluster + Gulf of Finland
  const inland = [...['56.5_21.0', '56.5_21.5', '57.0_21.0'].map((cell_id) => ({ cell_id, coverage: 1 })),
    ...Array.from({ length: 14 }, (_, k) => ({ cell_id: `50.0_${(10 + k / 2).toFixed(1)}`, coverage: 0.9 }))];
  const cells = [...inland, ...border.map((cell_id, k) => ({ cell_id, coverage: k < 3 ? 0.7 : 0.6 }))];
  const plan = genSorties(cells, NOW);
  assertPlan(plan, cells.map((c) => c.cell_id));
  const starts = plan.map((s) => s.cells.split(';')[0]);
  assert.deepEqual(starts.slice(0, 4), border, 'border cells first, better covered first');
  assert.equal(new Set(starts).size, 16, 'spread over 16 start cells, 3 sorties each');
  assert.ok(!starts.includes('50.0_16.5'), 'the least preferred cell never starts a route');
  const lengths = new Set(plan.map((s) => s.cells.split(';').length));
  assert.deepEqual([...lengths].sort(), [1, 2, 3], 'routes of 1, 2 and 3 cells where neighbours exist');
});

test('genSorties: first launch is the next half hour strictly after now; the last is 23.5 h later', () => {
  const one = [{ cell_id: '54.5_20.5', coverage: 1 }];
  assert.equal(genSorties(one, new Date('2026-09-26T21:29:59Z'))[0].launch_at, '2026-09-26T21:30:00Z');
  const plan = genSorties(one, new Date('2026-09-26T21:30:00Z'));
  assert.equal(plan[0].launch_at, '2026-09-26T22:00:00Z');
  assert.equal(plan[47].launch_at, '2026-09-27T21:30:00Z');
  assert.throws(() => genSorties([], NOW), /no cell has sensor coverage/);
});

test('fixture mode: the 3 fixture cells with >= 3 aircraft, border cells first, launches from 21:30Z', () => {
  const rows = JSON.parse(fs.readFileSync(path.join(__dirname, '../../shared/contracts/fixtures/cell_status.sample.json'), 'utf8'))
    .filter((r) => r.ts);
  const cells = coveredCells(rows);
  assert.deepEqual(cells.map((c) => c.cell_id).sort(), ['54.5_20.5', '56.5_21.0', '59.5_25.0']);
  const plan = genSorties(cells, new Date(rows[0].ts));
  assertPlan(plan, cells.map((c) => c.cell_id));
  assert.equal(plan[0].launch_at, '2026-09-26T21:30:00Z');
  assert.deepEqual(plan.slice(0, 3).map((s) => s.cells), ['54.5_20.5', '59.5_25.0', '56.5_21.0']);
});

test('toCsv quotes the unit (it has a comma) and parses back to the same rows', () => {
  const plan = genSorties([{ cell_id: '54.5_20.5', coverage: 1 }, { cell_id: '55.0_21.0', coverage: 1 }], NOW);
  const csv = toCsv(plan);
  assert.deepEqual(readRows(csv), plan);
  assert.match(csv.split('\n')[1], /^S-001,"3rd Border Drone Sqn \(DEMO, fictional\)",priority,2026-09-26T21:30:00Z,/);
});

test('committed sorties.demo.csv is C5: 48 PLANNED demo sorties, 12/24/12, never "safe" or "clear"', () => {
  const text = fs.readFileSync(path.join(__dirname, 'sorties.demo.csv'), 'utf8');
  assertPlan(readRows(text));
  assert.doesNotMatch(text.toLowerCase(), /\b(safe|clear)\b/);
});
