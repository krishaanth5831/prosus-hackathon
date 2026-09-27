// Owner: Krish (see CLAUDE.md)
// Pure functions pasted into WF8 Console (n8n). The ops console asks WF8 to load or remove the demo plan, or to
// sync the sheet mirror now. WF8 only ever writes or removes test rows (C11 sortie ids T-*); other rows stay.
const C5 = ['sortie_id', 'unit', 'priority', 'launch_at', 'window_end', 'cells', 'status', 'decided_by', 'note'];
const TEST_ID = /^T-\d{1,6}$/;
const CELLS = /^-?\d+\.\d_-?\d+\.\d(;-?\d+\.\d_-?\d+\.\d)*$/;
const UTC = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/;

// consoleRequest(webhook body) -> { ok, op, rows, reason }. rows only for "load": C5 rows, test ids, text values.
function consoleRequest(body) {
  const b = body && typeof body === 'object' ? body : {};
  const refuse = (reason) => ({ ok: false, op: String(b.op || '').slice(0, 10), rows: [], reason });
  if (!['load', 'remove', 'sync'].includes(b.op)) return refuse('op must be load, remove or sync');
  if (b.op !== 'load') return { ok: true, op: b.op, rows: [], reason: '' };
  const rows = Array.isArray(b.rows) ? b.rows : [];
  if (rows.length < 1 || rows.length > 60) return refuse('load needs 1 to 60 rows');
  const out = [];
  for (const r of rows) {
    if (!TEST_ID.test(r && r.sortie_id)) return refuse('every sortie_id must be a test id T-<number> (C11)');
    if (!UTC.test(r.launch_at) || !UTC.test(r.window_end)) return refuse(`${r.sortie_id}: launch_at and window_end must be UTC ISO 8601`);
    if (!CELLS.test(r.cells)) return refuse(`${r.sortie_id}: cells must be C1 cell ids joined by ";"`);
    if (!['priority', 'routine', 'low'].includes(r.priority) || r.status !== 'PLANNED') return refuse(`${r.sortie_id}: priority or status is not C5`);
    out.push(Object.fromEntries(C5.map((k) => [k, String(r[k] ?? '').slice(0, 200)])));
  }
  return { ok: true, op: 'load', rows: out, reason: '' };
}

// testRowNumbers(sheet rows as read by n8n, with row_number) -> row numbers of test rows, highest first
// (deleting from the bottom up keeps the other row numbers valid)
function testRowNumbers(rows) {
  return rows.filter((r) => r && TEST_ID.test(String(r.sortie_id || '').trim()) && Number.isInteger(r.row_number) && r.row_number >= 2)
    .map((r) => r.row_number).sort((a, b) => b - a);
}

// consoleLogLine(request, test rows removed, rows in the mirror now) -> the agent_log line (C8) for a console request
function consoleLogLine(req, removed, n) {
  const outcome = `sheet mirror synced: ${n} rows`;
  if (req.op === 'load') return { workflow: 'WF8', action: 'LOAD DEMO PLAN', outcome,
    reason: `${req.rows.length} fictional test sorties written to the Google Sheet from the ops console${removed ? `, ${removed} older test rows removed first` : ''}` };
  if (req.op === 'remove') return { workflow: 'WF8', action: 'REMOVE TEST SORTIES', outcome,
    reason: `${removed} test sorties (T-*) removed from the Google Sheet from the ops console` };
  return { workflow: 'WF8', action: 'SYNC SHEET MIRROR', reason: 'requested from the ops console', outcome };
}

// mirrorQuery(node, by) -> the n8n Postgres query (WF3, WF8) that makes the Supabase mirror equal to what `node`
// read from the sheet. The rows travel as JSON in a dollar-quoted literal; every "$" in them is sent as the JSON
// escape $, so nothing typed into a cell can end the literal.
const mirrorQuery = (node, by) => '=select sync_sorties($sheet${{ JSON.stringify($(\'' + node
  + '\').all().map((i) => i.json)).replace(/\\$/g, \'\\\\u0024\') }}$sheet$::jsonb, \'' + by + '\') as n;';

if (typeof module !== 'undefined') module.exports = { consoleRequest, testRowNumbers, consoleLogLine, mirrorQuery, C5 };
// n8n glue (Code nodes, "Run once for all items"):
// return [{ json: consoleRequest($('Console request').first().json.body) }];
// return [{ json: { rows: testRowNumbers($('Read before').all().map((i) => i.json)) } }];
// const ran = (n) => { try { return $(n).first().json; } catch (e) { return null; } };
// return [{ json: consoleLogLine($('Request').first().json, (ran('Test rows') || { rows: [] }).rows.length, $('Sync mirror').first().json.n) }];
