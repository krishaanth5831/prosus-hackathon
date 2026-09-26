// Owner: Person A (see CLAUDE.md)
// Pure function, pasted into the WF1 Code node. Spec: docs/plan.md §5.2, contracts C1 + C2.

// cellId(lat, lon, size = 0.5) -> "56.5_21.0" (lower-left corner, 1 decimal; C1)
function cellId(lat, lon, size = 0.5) {
  throw new Error('TODO: Person A (cellId)');
}

// binCells(rows: C2 actor rows) -> [{ts, source, cell_id, n_total, n_degraded, n_spoof, ratio}]
// one row per cell, ready to insert into observations
function binCells(rows) {
  throw new Error('TODO: Person A (binCells)');
}

if (typeof module !== 'undefined') module.exports = { binCells, cellId };
