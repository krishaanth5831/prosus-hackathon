// Owner: Person A (see CLAUDE.md)
// binCells + cellId: the docs/plan.md §8 cases, plus the shared C2 fixture.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { binCells, cellId } = require('./binCells.js');

const fixtures = path.join(__dirname, '../../shared/contracts/fixtures');
const actorRows = require(path.join(fixtures, 'actor-output.sample.json'));
const cellStatus = require(path.join(fixtures, 'cell_status.sample.json'));
const TS = actorRows[0].ts;

// one aircraft in Person A's test cell 89.5_178.5 (C11); override fields per case
const ac = (o) => ({ ts: TS, source: 'adsb.lol', hex: 'test', flight: null, lat: 89.7, lon: 178.7,
  nic: 8, nac_p: 10, alt_geom: 30000, alt_baro: 30000, ...o });
const byId = (cells) => Object.fromEntries(cells.map((c) => [c.cell_id, c]));
const counts = ({ cell_id, n_total, n_degraded, n_spoof }) => ({ cell_id, n_total, n_degraded, n_spoof });

test('fixture: one row per cell, shaped like an observations row', () => {
  const cells = binCells(actorRows);
  assert.deepEqual(cells.map(counts).sort((a, b) => a.cell_id.localeCompare(b.cell_id)), [
    { cell_id: '53.5_-0.5', n_total: 1, n_degraded: 0, n_spoof: 0 },
    { cell_id: '54.5_20.5', n_total: 8, n_degraded: 5, n_spoof: 0 },   // 9 aircraft, 1 without nic/nac_p
    { cell_id: '55.0_21.0', n_total: 2, n_degraded: 0, n_spoof: 0 },
    { cell_id: '56.5_21.0', n_total: 7, n_degraded: 1, n_spoof: 0 },   // 8 aircraft, 1 without nic/nac_p
    { cell_id: '59.5_25.0', n_total: 5, n_degraded: 1, n_spoof: 2 },
  ]);
  for (const c of cells) {
    assert.deepEqual(Object.keys(c).sort(), ['cell_id', 'n_degraded', 'n_spoof', 'n_total', 'ratio', 'source', 'ts']);
    assert.equal(c.ts, TS);
    assert.equal(c.source, 'adsb.lol');
    assert.equal(c.ratio, c.n_degraded / c.n_total);
  }
});

test('fixture agrees with cell_status.sample.json for the same cycle', () => {
  const cells = byId(binCells(actorRows));
  const sameCycle = cellStatus.filter((s) => s.ts === TS);
  assert.equal(sameCycle.length, Object.keys(cells).length);
  for (const s of sameCycle) {
    const c = cells[s.cell_id];
    assert.deepEqual([c.n_total, c.n_degraded, c.ratio], [s.n_total, s.n_degraded, s.ratio], s.cell_id);
  }
});

test('negative coordinates floor downwards (C1)', () => {
  assert.equal(cellId(-0.3, -0.3), '-0.5_-0.5');
  assert.equal(cellId(53.93, -0.31), '53.5_-0.5');
  assert.equal(cellId(-33.87, 151.21), '-34.0_151.0');
  assert.equal(cellId(-0.0001, 0.0001), '-0.5_0.0');
  assert.equal(cellId(0, -180), '0.0_-180.0');
  assert.deepEqual(binCells([ac({ lat: -12.2, lon: -77.1 })]).map((c) => c.cell_id), ['-12.5_-77.5']);
});

test('cell edge: 56.5 exactly belongs to the cell above', () => {
  assert.equal(cellId(56.5, 21.0), '56.5_21.0');
  assert.equal(cellId(56.4999, 20.9999), '56.0_20.5');
  const cells = binCells([ac({ hex: 'a', lat: 56.5, lon: 21.0 }), ac({ hex: 'b', lat: 56.4999, lon: 21.0 })]);
  assert.deepEqual(cells.map((c) => c.cell_id), ['56.5_21.0', '56.0_21.0']);
});

test('missing nic and nac_p: not a sensor; one of them missing: judged on the other', () => {
  const noIntegrity = { ts: TS, source: 'adsb.lol', hex: 'x', lat: 89.7, lon: 178.7 };   // keys absent
  assert.deepEqual(binCells([noIntegrity, ac({ nic: null, nac_p: null })]), []);
  const [c] = binCells([
    noIntegrity,
    ac({ hex: 'a', nic: null, nac_p: 9 }),   // sensor, fine
    ac({ hex: 'b', nic: null, nac_p: 5 }),   // sensor, degraded by nac_p
    ac({ hex: 'c', nic: 3, nac_p: null }),   // sensor, degraded by nic
  ]);
  assert.deepEqual(counts(c), { cell_id: '89.5_178.5', n_total: 3, n_degraded: 2, n_spoof: 0 });
});

test('empty run row, empty input and n8n empty items give no cells', () => {
  assert.deepEqual(binCells([{ ts: TS, empty: true, errors: ['adsb.lol @56.5,21: HTTP 503'] }]), []);
  assert.deepEqual(binCells([]), []);
  assert.deepEqual(binCells([{}]), []);   // n8n "Always Output Data" item
  assert.deepEqual(binCells([ac({ lat: null }), ac({ lon: null })]), []);
});

test('degraded = nic < 7 or nac_p < 8', () => {
  const [c] = binCells([
    ac({ hex: 'a', nic: 7, nac_p: 8 }),   // on the line: not degraded
    ac({ hex: 'b', nic: 6, nac_p: 8 }),
    ac({ hex: 'c', nic: 7, nac_p: 7 }),
    ac({ hex: 'd', nic: 0, nac_p: 0 }),
  ]);
  assert.deepEqual([c.n_total, c.n_degraded, c.ratio], [4, 3, 0.75]);
});

test('spoof count: |alt_geom - alt_baro| > 1500 ft, counted apart from degraded', () => {
  const [c] = binCells([
    ac({ hex: 'a', alt_geom: 38200, alt_baro: 36300 }),   // +1900: spoof
    ac({ hex: 'b', alt_geom: 30000, alt_baro: 31600 }),   // -1600: spoof
    ac({ hex: 'c', alt_geom: 31500, alt_baro: 30000 }),   // exactly 1500: not
    ac({ hex: 'd', alt_geom: null, alt_baro: 30000 }),    // no GPS altitude: not
    ac({ hex: 'e', alt_geom: 30000, alt_baro: null }),    // alt_baro "ground" arrives as null: not
  ]);
  assert.deepEqual(counts(c), { cell_id: '89.5_178.5', n_total: 5, n_degraded: 0, n_spoof: 2 });
});
