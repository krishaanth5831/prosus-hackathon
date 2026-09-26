// Owner: Person B (see CLAUDE.md)
// The sortie gate. Pure function, pasted into the WF3 Code node. Spec: docs/plan.md §5.3, contracts C5 + C6.
// Rules only; no LLM in the decision path.

const HOUR = 3600e3;
const ACT_H = 2, WATCH_H = 12, UNVERIFIED_MIN = 60, BRAKE = 0.25, STEP_H = 2;

// levelFor(sortie: C5 row, bad: cell_status row) -> {level, human, new_launch_at?}
function levelFor(s, bad) {
  if (bad.state === 'SPOOF') return { level: 'L4_SPOOF_HOLD', human: true };
  if (s.priority === 'priority') return { level: 'L3_HOLD', human: true };
  if (s.priority === 'low') return { level: 'L2_CANCEL', human: false };
  const next = Date.parse(s.launch_at) + STEP_H * HOUR;
  if (next <= Date.parse(s.window_end))
    return { level: 'L1_RESCHEDULE', human: false, new_launch_at: new Date(next).toISOString() };
  return { level: 'L3_HOLD', human: true };                       // routine, no slot left
}

// sorties: C5 rows · cells: {cell_id: C4 row} from cell_status · done: decision keys already taken
// recentlyJammed: cell_ids with an incident in the last 6 h
// -> [{sortie_id, launch_at, key, incident_id, level, human, reason, new_launch_at?, batch?}] (C6)
function decide({ sorties, cells, now = new Date(), done = [], recentlyJammed = [] }) {
  const t = now.getTime(), seen = new Set(done), recent = new Set(recentlyJammed);
  const upcoming = sorties.filter((s) => {
    const dt = Date.parse(s.launch_at) - t;
    return ['PLANNED', 'RESCHEDULED'].includes(s.status) && dt > 0 && dt <= WATCH_H * HOUR;
  });

  const out = [];
  for (const s of upcoming) {
    const dt = Date.parse(s.launch_at) - t;
    const route = String(s.cells).split(';').map((id) => id.trim())
      .map((id) => ({ cell_id: id, ...(cells[id] ?? { state: 'UNKNOWN' }) }));
    const bad = route.find((c) => c.state === 'SPOOF') ?? route.find((c) => c.state === 'JAMMED');
    const base = { sortie_id: s.sortie_id, launch_at: s.launch_at };

    if (bad) {
      const reason = `${bad.state} cell ${bad.cell_id} (${bad.severity}): ${bad.evidence}`;
      out.push(dt > ACT_H * HOUR
        ? { ...base, key: `${s.sortie_id}|${bad.incident_id}|watch`, incident_id: bad.incident_id, level: 'WATCH', human: false, reason }
        : { ...base, key: `${s.sortie_id}|${bad.incident_id}|${s.launch_at}`, incident_id: bad.incident_id, ...levelFor(s, bad), reason });
      continue;
    }
    const unknown = route.filter((c) => c.state === 'UNKNOWN');
    if (unknown.length && dt <= UNVERIFIED_MIN * 60e3) {
      const hot = unknown.find((c) => recent.has(c.cell_id));
      out.push({ ...base, key: `${s.sortie_id}|unknown|${s.launch_at}`, incident_id: null,
        ...(hot
          ? { level: 'L3_HOLD', human: true, reason: `no sensor coverage in ${hot.cell_id}, which was jammed in the last 6 h` }
          : { level: 'UNVERIFIED', human: false, reason: `no sensor coverage in ${unknown.map((c) => c.cell_id).join(', ')}` }) });
    }
  }

  // Blast-radius brake: one incident touching > 25% of the next 12 h → no cancels/reschedules, HOLD + one batch card
  const byInc = {};
  for (const a of out) if (a.incident_id) (byInc[a.incident_id] ??= []).push(a);
  for (const [id, list] of Object.entries(byInc))
    if (list.length / upcoming.length > BRAKE)
      for (const a of list)
        if (!['WATCH', 'L4_SPOOF_HOLD'].includes(a.level))
          Object.assign(a, { level: 'BRAKE_HOLD', human: true, batch: id, new_launch_at: undefined });

  return out.filter((a) => !seen.has(a.key));
}

if (typeof module !== 'undefined') module.exports = { decide, levelFor };
// n8n glue (Code node "decide", "Run once for all items"):
// const cells = Object.fromEntries($('Cell status').all().map(i => [i.json.cell_id, i.json]));
// return decide({ sorties: $('Read sorties').all().map(i => i.json), cells,
//   done: $('Done keys').all().map(i => i.json.key),
//   recentlyJammed: $('Recent incidents').all().map(i => i.json.cell_id) }).map(json => ({ json }));
