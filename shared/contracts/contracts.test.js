// Owner: Krish. Checks that every fixture in shared/contracts/fixtures/ obeys CONTRACTS.md (C1 C2 C4 C5 C7 C10 C12).
// Deliberately imports no feature code: the contract is checked on its own.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const fx = (f) => fs.readFileSync(path.join(__dirname, 'fixtures', f), 'utf8');
const json = (f) => JSON.parse(fx(f));

const CELL_RE = /^-?\d+\.\d_-?\d+\.\d$/;
const cellId = (lat, lon) =>
  `${(Math.floor(lat / 0.5) * 0.5).toFixed(1)}_${(Math.floor(lon / 0.5) * 0.5).toFixed(1)}`;
const isUtc = (s) => typeof s === 'string' && s.endsWith('Z') && !Number.isNaN(Date.parse(s));

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
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += ch;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

test('C1 cell_id formula and regex', () => {
  assert.equal(cellId(56.71, 21.33), '56.5_21.0');
  assert.equal(cellId(56.5, 21.0), '56.5_21.0'); // exactly on the edge belongs to the cell above/right
  assert.equal(cellId(56.49, 20.99), '56.0_20.5');
  assert.equal(cellId(-0.3, -0.3), '-0.5_-0.5');
  assert.equal(cellId(53.93, -0.31), '53.5_-0.5');
  for (const id of ['56.5_21.0', '-0.5_-0.5', '89.5_179.5']) assert.match(id, CELL_RE);
  for (const id of ['56.5_21', '113_42', '56.50_21.0']) assert.doesNotMatch(id, CELL_RE);
});

test('C11 test cells are valid cell_ids', () => {
  for (const id of ['89.5_178.5', '89.5_179.0', '89.5_179.5']) assert.match(id, CELL_RE);
});

test('C2 actor dataset rows', () => {
  const rows = json('actor-output.sample.json');
  const KEYS = ['ts', 'source', 'hex', 'flight', 'lat', 'lon', 'nic', 'nac_p', 'alt_geom', 'alt_baro'].sort();
  assert.ok(rows.length >= 20, 'about 25 aircraft');
  for (const r of rows) {
    assert.deepEqual(Object.keys(r).sort(), KEYS, `row ${r.hex} has exactly the C2 keys`);
    assert.ok(isUtc(r.ts));
    assert.ok(['adsb.lol', 'adsb.fi'].includes(r.source));
    assert.equal(typeof r.lat, 'number');
    assert.equal(typeof r.lon, 'number');
    for (const k of ['nic', 'nac_p', 'alt_geom', 'alt_baro']) assert.ok(r[k] === null || typeof r[k] === 'number');
    assert.match(cellId(r.lat, r.lon), CELL_RE);
  }
  assert.equal(new Set(rows.map((r) => r.hex)).size, rows.length, 'deduped by hex');
  assert.equal(new Set(rows.map((r) => r.ts)).size, 1, 'one cycle, one ts');

  // the edge cases the fixture promises
  assert.ok(rows.filter((r) => r.nic === null && r.nac_p === null).length >= 2, 'aircraft without nic/nac_p');
  assert.ok(rows.filter((r) => r.alt_geom !== null && r.alt_baro !== null &&
    Math.abs(r.alt_geom - r.alt_baro) > 1500).length >= 2, 'aircraft with a GPS/baro gap');
  assert.ok(rows.some((r) => r.lat < 0 || r.lon < 0), 'negative coordinate');
  assert.ok(rows.some((r) => (r.nic ?? 99) < 7 || (r.nac_p ?? 99) < 8), 'degraded aircraft');
  const cells = new Set(rows.map((r) => cellId(r.lat, r.lon)));
  assert.ok(cells.size >= 3, 'spread over several cells');
});

test('C2 empty-run row shape', () => {
  const empty = { ts: '2026-09-26T21:10:02.000Z', empty: true, errors: ['adsb.lol @56.5,21: HTTP 503'] };
  assert.deepEqual(Object.keys(empty).sort(), ['empty', 'errors', 'ts']);
  assert.ok(isUtc(empty.ts));
});

test('C2 RUN_META matches the dataset', () => {
  const meta = json('run-meta.sample.json');
  const rows = json('actor-output.sample.json');
  assert.deepEqual(Object.keys(meta).sort(), ['aircraft', 'errors', 'failover', 'source', 'ts']);
  assert.equal(meta.aircraft, rows.length);
  assert.equal(meta.ts, rows[0].ts);
  assert.equal(meta.source, rows[0].source);
  assert.equal(typeof meta.failover, 'boolean');
  assert.equal(meta.failover, meta.source !== 'adsb.lol');
  assert.ok(Array.isArray(meta.errors));
});

test('Apify webhook payload carries what WF1 needs', () => {
  const w = json('apify-webhook.sample.json');
  assert.equal(w.eventType, 'ACTOR.RUN.SUCCEEDED');
  assert.equal(w.eventData.actorRunId, w.resource.id);
  assert.equal(w.resource.status, 'SUCCEEDED');
  assert.equal(typeof w.resource.defaultDatasetId, 'string');
  assert.equal(typeof w.resource.defaultKeyValueStoreId, 'string');
});

test('C4 cell_status rows', () => {
  const rows = json('cell_status.sample.json');
  const STATES = ['JAMMED', 'SPOOF', 'UNKNOWN', 'NO_KNOWN_ISSUE'];
  const KEYS = ['cell_id', 'ts', 'n_total', 'n_degraded', 'ratio', 'incident_id', 'severity', 'evidence', 'state',
    'drone_ts', 'drone_evidence'].sort();
  for (const s of STATES) assert.ok(rows.some((r) => r.state === s), `state ${s} present`);
  assert.equal(new Set(rows.map((r) => r.cell_id)).size, rows.length, 'one row per cell');
  for (const r of rows) {
    assert.deepEqual(Object.keys(r).sort(), KEYS);
    assert.match(r.cell_id, CELL_RE);
    assert.ok(STATES.includes(r.state));
    if (r.ts !== null) {
      assert.ok(isUtc(r.ts));
      assert.ok(Math.abs(r.ratio - r.n_degraded / r.n_total) < 1e-9, `${r.cell_id} ratio`);
    }
    if (r.state === 'JAMMED' || r.state === 'SPOOF') {
      assert.equal(typeof r.incident_id, 'number');
      assert.ok(['medium', 'high'].includes(r.severity));
      assert.equal(typeof r.evidence, 'string');
    } else {
      assert.equal(r.incident_id, null);
      assert.equal(r.severity, null);
    }
    if (r.state === 'UNKNOWN') assert.ok(r.n_total === null || r.n_total < 3);
    assert.equal(r.drone_ts === null, r.drone_evidence === null, `${r.cell_id}: drone_ts and drone_evidence go together`);
    if (r.drone_ts !== null) assert.ok(isUtc(r.drone_ts));
    if (r.state === 'NO_KNOWN_ISSUE') {
      assert.ok((r.n_total >= 3 && r.ratio < 0.3) || r.drone_evidence !== null, `${r.cell_id}: aircraft coverage or a drone report`);
    }
    if (r.state === 'JAMMED' && r.ts !== null) assert.ok(r.n_total >= 3 && r.ratio >= 0.3);
  }
});

test('cell_status rows from the same cycle match the actor fixture', () => {
  const rows = json('actor-output.sample.json');
  const counts = {};
  for (const r of rows) {
    if (r.nic === null && r.nac_p === null) continue; // not a sensor
    const c = (counts[cellId(r.lat, r.lon)] ??= { n_total: 0, n_degraded: 0 });
    c.n_total++;
    if ((r.nic ?? 99) < 7 || (r.nac_p ?? 99) < 8) c.n_degraded++;
  }
  const status = json('cell_status.sample.json').filter((s) => s.ts === rows[0].ts);
  assert.deepEqual(Object.keys(counts).sort(), status.map((s) => s.cell_id).sort());
  for (const s of status) assert.deepEqual(counts[s.cell_id], { n_total: s.n_total, n_degraded: s.n_degraded }, s.cell_id);
});

test('C5 sorties sheet', () => {
  const [header, ...rows] = parseCsv(fx('sorties.sample.csv'));
  assert.deepEqual(header,
    ['sortie_id', 'unit', 'priority', 'launch_at', 'window_end', 'cells', 'status', 'decided_by', 'note']);
  assert.equal(rows.length, 10);
  const known = new Set(json('cell_status.sample.json').map((r) => r.cell_id));
  const STATUS = ['PLANNED', 'RESCHEDULED', 'REROUTED', 'CANCELLED', 'HOLD', 'LAUNCH_APPROVED'];
  const seenPriority = new Set();
  for (const cols of rows) {
    assert.equal(cols.length, header.length, `row ${cols[0]} column count`);
    const s = Object.fromEntries(header.map((h, i) => [h, cols[i]]));
    assert.match(s.sortie_id, /^T-\d+$/, 'C11 test sorties are T-*');
    assert.ok(['priority', 'routine', 'low'].includes(s.priority));
    seenPriority.add(s.priority);
    assert.ok(STATUS.includes(s.status), `status ${s.status}`);
    assert.ok(isUtc(s.launch_at) && isUtc(s.window_end));
    assert.ok(Date.parse(s.window_end) >= Date.parse(s.launch_at));
    for (const c of s.cells.split(';')) {
      assert.match(c, CELL_RE);
      assert.ok(known.has(c), `${s.sortie_id} cell ${c} is in cell_status.sample.json`);
    }
    assert.ok(s.decided_by === '' || s.decided_by === 'agent' || s.decided_by.startsWith('human:'));
  }
  assert.equal(seenPriority.size, 3, 'mixed priorities');
  assert.doesNotMatch(fx('sorties.sample.csv').toLowerCase(), /\b(safe|clear)\b/, 'never "safe"/"clear"');
});

test('C7 Telegram callback_data', () => {
  const updates = json('telegram-callback.sample.json');
  const RE = /^(?:[klcf]\|[A-Za-z0-9-]+\|\d+|b[klcf]\|\d+)$/;
  const kinds = new Set();
  for (const u of updates) {
    const q = u.callback_query;
    assert.equal(typeof q.id, 'string');
    assert.equal(typeof q.from.id, 'number', 'from.id is what the allowlist checks');
    assert.equal(typeof q.message.chat.id, 'number');
    assert.ok(Buffer.byteLength(q.data, 'utf8') <= 64, `${q.data} fits 64 bytes`);
    assert.match(q.data, RE);
    kinds.add(q.data.split('|')[0]);
  }
  assert.deepEqual([...kinds].sort(), ['bc', 'bf', 'bk', 'bl', 'c', 'f', 'k', 'l']);
  // worst case still fits: longest realistic sortie id + a large decision id
  assert.ok(Buffer.byteLength('f|S-2026-09-27-BORDER-SQN3-048|9007199254740991') <= 64);
});

test('C12 drone report', () => {
  const r = json('drone-report.sample.json');
  assert.deepEqual(Object.keys(r), ['source', 'drone_id', 'sortie_id', 'legs', 'samples']);
  assert.match(r.source, /^[a-z0-9:-]{1,40}$/);
  assert.ok(r.source.startsWith('sim:'), 'the fixture is simulated and says so');
  for (const id of [r.drone_id, r.sortie_id]) assert.match(id, /^[A-Za-z0-9-]{1,32}$/);
  for (const l of r.legs) {
    assert.deepEqual(Object.keys(l), ['cell_id', 'from', 'to']);
    assert.match(l.cell_id, CELL_RE);
    assert.ok(isUtc(l.from) && isUtc(l.to) && Date.parse(l.from) < Date.parse(l.to));
  }
  for (const s of r.samples) {
    assert.deepEqual(Object.keys(s), ['t', 'fix_type', 'satellites_visible', 'h_acc', 'jamming_state', 'spoofing_state', 'lat', 'lon']);
    assert.ok(isUtc(s.t));
    for (const k of ['fix_type', 'satellites_visible', 'h_acc', 'jamming_state', 'spoofing_state']) assert.ok(Number.isInteger(s[k]), k);
    assert.ok(s.fix_type >= 0 && s.fix_type <= 8 && s.jamming_state <= 3 && s.spoofing_state <= 3);
  }
});
