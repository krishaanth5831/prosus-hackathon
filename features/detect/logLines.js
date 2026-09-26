// Owner: Person C (see CLAUDE.md)
// Pure function, pasted into the WF2 Code node "agent_log lines". Spec: docs/plan.md §6 WF2, contract C8.
// Input: the rows returned by detect.sql (opened), lift.sql (may-lift) and close.sql (closed).
// n8n's "always output data" turns an empty result into one {} item, so rows without an id are dropped.

function logLines(opened, mayLift, closed) {
  const rows = (list) => (list || []).filter((r) => r && r.id != null);
  return [
    ...rows(opened).map((i) => ({
      workflow: 'WF2',
      action: `OPEN ${i.type} ${i.cell_id}`,
      reason: `${i.type} ${i.cell_id} ${i.severity}: ${i.evidence}`,
      outcome: `incident #${i.id} open, sorties through ${i.cell_id} go to the gate`,
    })),
    ...rows(mayLift).map((i) => ({
      workflow: 'WF2',
      action: `MAY-LIFT ${i.type} ${i.cell_id}`,
      reason: `${i.type} ${i.cell_id} quiet 30 min with coverage (5+ checks with 3+ aircraft, none over threshold)`,
      outcome: `incident #${i.id} may_lift, officer notified; every HOLD stays until a human lifts it`,
    })),
    ...rows(closed).map((i) => ({
      workflow: 'WF2',
      action: `CLOSE ${i.type} ${i.cell_id}`,
      reason: `no new ${i.type} in ${i.cell_id} for 2 h after MAY-LIFT`,
      outcome: `incident #${i.id} closed; sorties untouched`,
    })),
  ];
}

if (typeof module !== 'undefined') module.exports = { logLines };
// n8n glue (Code node, "Run once for all items"):
// const all = (n) => $(n).all().map((i) => i.json);
// return logLines(all('detect.sql'), all('lift.sql'), all('close.sql')).map((json) => ({ json }));
