// Owner: Krish (see CLAUDE.md)
// Pure function, pasted into the WF7 Code node "droneReport". Contract C12.
// Turns one drone's GNSS health report into one drone_reports row per leg of its planned route.
// A sample is placed on the leg whose time window holds it, NEVER on the drone's own GPS position:
// a spoofed drone reports the wrong place, which is exactly the case AirGuard has to catch.

const MIN_SAMPLES = 10;            // fewer on a leg: no verdict, the cell stays UNKNOWN
const JAM_RATIO = 0.3;             // same threshold as the aircraft sensor (baselines default)
const SPOOF_RATIO = 0.2;
const MAX_H_ACC_MM = 10000;        // MAVLink GPS_RAW_INT h_acc is in mm: worse than 10 m counts as degraded
const MAX_SAMPLES = 20000, MAX_LEGS = 20;
const MAX_AGE_MS = 24 * 3600e3, MAX_AHEAD_MS = 5 * 60e3;
const ID_RE = /^[A-Za-z0-9-]{1,32}$/;
const CELL_RE = /^-?\d+\.\d_-?\d+\.\d$/;
const SOURCE_RE = /^[a-z0-9:-]{1,40}$/;

// fix_type (GPS_FIX_TYPE): < 3 = no 3D fix. jamming_state / spoofing_state as in PX4 SensorGps:
// jamming 0 unknown, 1 ok, 2 warning, 3 critical · spoofing 0 unknown, 1 none, 2 indicated, 3 multiple.
const degraded = (s) => s.fix_type < 3 || (s.h_acc ?? 0) > MAX_H_ACC_MM || s.jamming_state >= 2;
const spoofed = (s) => s.spoofing_state >= 2;
const utc = (ms) => new Date(ms).toISOString();

// droneReport(body = C12 report, now ms) -> { ok, rows: [drone_reports row], log: agent_log row }
function droneReport(body, now = Date.now()) {
  const refuse = (why) => ({ ok: false, rows: [],
    log: { workflow: 'WF7', action: 'REJECT DRONE REPORT', reason: `drone report refused: ${why}`, outcome: 'nothing stored' } });
  const b = body && typeof body === 'object' ? body : {};
  if (!SOURCE_RE.test(b.source ?? '')) return refuse('source missing or not a short lowercase label');
  if (!ID_RE.test(b.drone_id ?? '')) return refuse('drone_id missing or not letters, digits and "-"');
  if (!ID_RE.test(b.sortie_id ?? '')) return refuse('sortie_id missing or not letters, digits and "-"');
  const legs = Array.isArray(b.legs) ? b.legs : [];
  const samples = Array.isArray(b.samples) ? b.samples : [];
  if (legs.length < 1 || legs.length > MAX_LEGS) return refuse(`needs 1 to ${MAX_LEGS} legs`);
  if (samples.length < 1 || samples.length > MAX_SAMPLES) return refuse(`needs 1 to ${MAX_SAMPLES} samples`);
  const spans = [];
  for (const l of legs) {
    const from = Date.parse(l?.from), to = Date.parse(l?.to);
    if (!CELL_RE.test(l?.cell_id ?? '')) return refuse('a leg has no valid cell_id (C1)');
    if (!(from < to)) return refuse(`leg ${l.cell_id} needs from < to (UTC ISO 8601)`);
    spans.push({ cell_id: l.cell_id, from, to, list: [] });
  }
  for (const s of samples) {
    const t = Date.parse(s?.t);
    if (!(now - t <= MAX_AGE_MS && t - now <= MAX_AHEAD_MS)) return refuse('a sample time is missing, older than 24 h or in the future');
    if (!Number.isInteger(s.fix_type)) return refuse('a sample has no fix_type');
    const leg = spans.find((l) => l.from <= t && t <= l.to);
    if (leg) leg.list.push({ ...s, t });
  }

  const tag = b.source.startsWith('sim:') ? 'SIMULATED ' : '';
  const rows = [], thin = [];
  for (const l of spans) {
    const n = l.list.length;
    if (n < MIN_SAMPLES) { thin.push(l.cell_id); continue; }
    const nd = l.list.filter(degraded).length, ns = l.list.filter(spoofed).length;
    const noFix = l.list.filter((s) => s.fix_type < 3).length;
    const jam = Math.max(...l.list.map((s) => s.jamming_state ?? 0));
    const verdict = ns / n >= SPOOF_RATIO ? 'SPOOF' : nd / n >= JAM_RATIO ? 'JAMMED' : 'NORMAL';
    const flags = [
      noFix ? `no 3D fix on ${noFix}` : '',
      jam >= 2 ? `receiver jamming flag ${jam === 3 ? 'CRITICAL' : 'WARNING'}` : '',
      ns ? `receiver spoofing flag on ${ns}/${n}` : '',
    ].filter(Boolean);
    rows.push({
      ts: utc(Math.max(...l.list.map((s) => s.t))), cell_id: l.cell_id, sortie_id: b.sortie_id, drone_id: b.drone_id,
      n_samples: n, n_degraded: nd, n_spoof: ns, verdict, source: b.source,
      evidence: `${tag}drone ${b.drone_id} on ${b.sortie_id}: ${nd}/${n} GNSS samples degraded`
        + (flags.length ? `, ${flags.join(', ')}` : ', no jamming or spoofing flag'),
    });
  }
  if (!rows.length) return refuse(`no leg has ${MIN_SAMPLES}+ samples inside its time window`);
  return { ok: true, rows, log: {
    workflow: 'WF7', action: `INGEST DRONE REPORT ${b.sortie_id}`,
    reason: `${tag}${b.source} from ${b.drone_id}: `
      + rows.map((r) => `${r.cell_id} ${r.verdict} ${r.n_degraded}/${r.n_samples} degraded`).join('; ')
      + (thin.length ? `; under ${MIN_SAMPLES} samples, no verdict: ${thin.join(', ')}` : ''),
    outcome: `${rows.length} cell report(s) stored; WF2 weighs them at the next 5-min cycle`,
  } };
}

if (typeof module !== 'undefined') module.exports = { droneReport };
// n8n glue (Code node, "Run once for all items"):
// return [{ json: droneReport($('Drone report').first().json.body) }];
