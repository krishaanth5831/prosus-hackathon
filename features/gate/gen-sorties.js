// Owner: Person B (see CLAUDE.md)
// Generates 48 demo sorties into features/gate/sorties.demo.csv (C5). Spec: docs/plan.md §6 "Demo sorties".
// Usage (when built): node features/gate/gen-sorties.js [--fixture]

// genSorties(cells: C4 rows with coverage, now: Date) -> C5 rows
function genSorties(cells, now = new Date()) {
  throw new Error('TODO: Person B (genSorties)');
}

if (typeof module !== 'undefined') module.exports = { genSorties };

if (typeof require !== 'undefined' && require.main === module) {
  // TODO Person B: read cells (Supabase REST, or shared/contracts/fixtures/cell_status.sample.json with --fixture), write the CSV
  throw new Error('TODO: Person B (gen-sorties CLI)');
}
