// Owner: Person B (see CLAUDE.md)
// The sortie gate. Pure function, pasted into the WF3 Code node. Spec: docs/plan.md §5.3, contracts C5 + C6.
// Rules only; no LLM in the decision path.

// levelFor(sortie: C5 row, bad: cell_status row) -> {level, human, new_launch_at?}
function levelFor(s, bad) {
  throw new Error('TODO: Person B (levelFor)');
}

// decide({sorties, cells, now, done, recentlyJammed})
//   sorties: C5 rows · cells: {cell_id: C4 row} · done: decision keys already taken
//   recentlyJammed: cell_ids with an incident in the last 6 h
// -> [{sortie_id, launch_at, key, incident_id, level, human, reason, new_launch_at?, batch?}] (C6)
function decide({ sorties, cells, now = new Date(), done = [], recentlyJammed = [] }) {
  throw new Error('TODO: Person B (decide)');
}

if (typeof module !== 'undefined') module.exports = { decide, levelFor };
