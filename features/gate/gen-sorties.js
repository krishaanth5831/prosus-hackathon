// Owner: Person B (see CLAUDE.md)
// Generates 48 demo sorties into features/gate/sorties.demo.csv (C5). Spec: docs/plan.md §6 "Demo sorties".
// Usage: node features/gate/gen-sorties.js            cells from Supabase observations of the last 6 h (anon key, .env)
//        node features/gate/gen-sorties.js --fixture  cells from shared/contracts/fixtures/cell_status.sample.json
// The sorties are demo data. The cells they fly through are the ones with real sensor coverage.

const fs = require('node:fs');
const path = require('node:path');

const HOUR = 3600e3, HALF_HOUR = HOUR / 2;
const OUT = path.join(__dirname, 'sorties.demo.csv');
const FIXTURE = path.join(__dirname, '../../shared/contracts/fixtures/cell_status.sample.json');
const UNIT = '3rd Border Drone Sqn (DEMO, fictional)';
const HEADER = ['sortie_id', 'unit', 'priority', 'launch_at', 'window_end', 'cells', 'status', 'decided_by', 'note'];
const MIX = ['priority', 'routine', 'low', 'routine'];          // 48 sorties → 12 priority / 24 routine / 12 low
const WINDOW_H = { priority: 1, routine: 6, low: 3 };           // window_end = launch + this
const MAX_START_CELLS = 16;                                     // 48 sorties start from at most 16 cells
const TEST_CELLS = ['89.5_178.5', '89.5_179.0', '89.5_179.5'];  // C11
// Where a border unit would patrol, as boxes around the cell centre
const BORDERS = [
  { lat: [54.0, 55.5], lon: [19.5, 23.0] }, // Kaliningrad / Lithuania / Poland
  { lat: [59.0, 60.8], lon: [22.5, 30.5] }, // Gulf of Finland / Estonia / Russia
];

const corner = (id) => id.split('_').map(Number);
const onBorder = (id) => {
  const [lat, lon] = corner(id).map((v) => v + 0.25);
  return BORDERS.some((b) => lat >= b.lat[0] && lat <= b.lat[1] && lon >= b.lon[0] && lon <= b.lon[1]);
};
const adjacent = (a, b) => {
  const [la, loa] = corner(a), [lb, lob] = corner(b);
  return a !== b && Math.abs(la - lb) <= 0.5 && Math.abs(loa - lob) <= 0.5;
};
const iso = (t) => new Date(t).toISOString().replace('.000Z', 'Z');

// coveredCells(observations: [{ts, cell_id, n_total}]) -> [{cell_id, coverage}]
// Cells with >= 3 sensor aircraft in >= 60% of the cycles (distinct ts), i.e. the ones with sensor coverage.
function coveredCells(observations, minShare = 0.6) {
  const cycles = new Set(observations.map((o) => o.ts)).size;
  const hits = new Map();
  for (const o of observations) {
    if (!(o.n_total >= 3) || TEST_CELLS.includes(o.cell_id)) continue;
    if (!hits.has(o.cell_id)) hits.set(o.cell_id, new Set());
    hits.get(o.cell_id).add(o.ts);
  }
  return [...hits].map(([cell_id, ts]) => ({ cell_id, coverage: ts.size / cycles }))
    .filter((c) => c.coverage >= minShare);
}

// genSorties(cells: [{cell_id, coverage}], now) -> 48 C5 rows
// Border cells first, then the best covered. A launch every 30 min from the next half hour.
// Routes are 1–3 adjacent covered cells, as far as the covered neighbourhood allows.
function genSorties(cells, now = new Date()) {
  if (!cells.length) throw new Error('no cell has sensor coverage yet: let WF1 collect for a few hours first');
  const ranked = [...cells].sort((a, b) => onBorder(b.cell_id) - onBorder(a.cell_id)
    || b.coverage - a.coverage || (a.cell_id < b.cell_id ? -1 : 1)).map((c) => c.cell_id);
  const starts = ranked.slice(0, MAX_START_CELLS);
  const t0 = Math.floor(now.getTime() / HALF_HOUR) * HALF_HOUR + HALF_HOUR;
  return Array.from({ length: 48 }, (_, i) => {
    const priority = MIX[i % MIX.length], launch = t0 + i * HALF_HOUR;
    const route = [starts[i % starts.length]];
    while (route.length < 1 + (i % 3)) {
      const next = ranked.filter((id) => !route.includes(id) && adjacent(id, route[route.length - 1]));
      if (!next.length) break;
      route.push(next[i % next.length]);
    }
    return { sortie_id: `S-${String(i + 1).padStart(3, '0')}`, unit: UNIT, priority, launch_at: iso(launch),
      window_end: iso(launch + WINDOW_H[priority] * HOUR), cells: route.join(';'), status: 'PLANNED', decided_by: '', note: '' };
  });
}

const csvField = (v) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
const toCsv = (rows) => [HEADER, ...rows.map((r) => HEADER.map((h) => String(r[h] ?? '')))]
  .map((fields) => fields.map(csvField).join(',')).join('\n') + '\n';

// Supabase REST with the anon key (RLS: select only), paged because PostgREST caps rows per request
async function fetchObservations(url, key, since) {
  const rows = [];
  for (let offset = 0, total = 1; offset < total;) {
    const res = await fetch(`${url}/rest/v1/observations?select=ts,cell_id,n_total&ts=gte.${since.toISOString()}`
      + `&order=id&limit=1000&offset=${offset}`,
    { headers: { apikey: key, Authorization: `Bearer ${key}`, Prefer: 'count=exact' } });
    if (!res.ok) throw new Error(`Supabase observations: HTTP ${res.status} ${await res.text()}`);
    const page = await res.json();
    if (!page.length) break;
    rows.push(...page);
    offset += page.length;
    total = Number(res.headers.get('content-range')?.split('/')[1]);
  }
  return rows;
}

async function main(argv) {
  let observations, now;
  if (argv.includes('--fixture')) {
    observations = JSON.parse(fs.readFileSync(FIXTURE, 'utf8')).filter((r) => r.ts); // one cycle of cell_status
    now = new Date(observations[0].ts); // pinned to the fixture cycle, so the output is reproducible
  } else {
    try { process.loadEnvFile(path.join(__dirname, '../../.env')); } catch {}
    const { SUPABASE_URL: url, SUPABASE_ANON_KEY: key } = process.env;
    if (!url || !key) throw new Error('SUPABASE_URL or SUPABASE_ANON_KEY missing: copy .env.example to .env and fill them in');
    now = new Date();
    observations = await fetchObservations(url.replace(/\/$/, ''), key, new Date(now.getTime() - 6 * HOUR));
  }
  const cells = coveredCells(observations);
  const sorties = genSorties(cells, now);
  fs.writeFileSync(OUT, toCsv(sorties));

  const routes = (id) => sorties.filter((s) => s.cells.split(';').includes(id)).length;
  console.log(`${observations.length} observations in ${new Set(observations.map((o) => o.ts)).size} cycles → `
    + `${cells.length} cells with >= 3 aircraft in >= 60% of the cycles:`);
  for (const c of [...cells].sort((a, b) => routes(b.cell_id) - routes(a.cell_id)))
    console.log(`  ${c.cell_id.padEnd(11)} coverage ${String(Math.round(c.coverage * 100)).padStart(3)}%  `
      + `on ${String(routes(c.cell_id)).padStart(2)} routes${onBorder(c.cell_id) ? '  border' : ''}`);
  console.log(`wrote ${path.relative(process.cwd(), OUT)}: 48 sorties, 12 priority / 24 routine / 12 low, `
    + `launches ${sorties[0].launch_at} → ${sorties[47].launch_at}`);
  const worst = Math.max(...cells.map((c) => routes(c.cell_id))) / sorties.length;
  if (worst > 0.25) console.log(`note: one cell is on ${Math.round(worst * 100)}% of the routes, `
    + 'so a single incident there will trip the brake (> 25% of upcoming sorties)');
}

if (typeof require !== 'undefined' && require.main === module)
  main(process.argv.slice(2)).catch((e) => { console.error(`gen-sorties: ${e.message}`); process.exit(1); });

if (typeof module !== 'undefined') module.exports = { genSorties, coveredCells, toCsv };
