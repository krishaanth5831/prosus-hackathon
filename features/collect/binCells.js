// Owner: Person A (see CLAUDE.md)
// Pure function, pasted into the WF1 Code node. Spec: docs/plan.md §5.2, contracts C1 + C2.

function cellId(lat, lon, size = 0.5) {
  return `${(Math.floor(lat / size) * size).toFixed(1)}_${(Math.floor(lon / size) * size).toFixed(1)}`;
}

function binCells(rows) {
  const cells = new Map();
  for (const a of rows) {
    if (a.empty || a.lat == null || a.lon == null) continue;
    if (a.nic == null && a.nac_p == null) continue;            // no integrity data → not a sensor
    const id = cellId(a.lat, a.lon);
    const c = cells.get(id) ?? { ts: a.ts, source: a.source, cell_id: id, n_total: 0, n_degraded: 0, n_spoof: 0 };
    c.n_total++;
    if ((a.nic ?? 99) < 7 || (a.nac_p ?? 99) < 8) c.n_degraded++;
    if (a.alt_geom != null && a.alt_baro != null && Math.abs(a.alt_geom - a.alt_baro) > 1500) c.n_spoof++;
    cells.set(id, c);
  }
  return [...cells.values()].map((c) => ({ ...c, ratio: c.n_degraded / c.n_total }));
}

if (typeof module !== 'undefined') module.exports = { binCells, cellId };
// n8n glue (Code node, "Run once for all items"):
// return binCells($input.all().map(i => i.json)).map(json => ({ json }));
