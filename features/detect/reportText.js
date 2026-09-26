// Owner: Person C (see CLAUDE.md)
// Pure function, pasted into the WF5 Code node "Report text". Spec: docs/plan.md §6 WF5, PRD F9.
// Input: the one row from report.sql. Output: the Telegram message. Local time only in this human text.

function reportText(r, now = new Date()) {
  const n = (v) => Number(v || 0);
  const day = now.toLocaleString('en-GB', { timeZone: 'Europe/Amsterdam', weekday: 'short', day: 'numeric',
    month: 'short', hour: '2-digit', minute: '2-digit' });
  const levels = Object.entries(r.per_level || {}).sort(([a], [b]) => a.localeCompare(b))
    .map(([level, count]) => `${level} ${count}`).join(' · ');
  const acted = n(r.acted_on);
  return [
    `📋 AirGuard morning report · ${day} (Amsterdam)`,
    'Last 24 h:',
    `• Incidents opened: ${n(r.incidents_opened)}${r.incidents_list ? ` (${r.incidents_list})` : ''}. Live now: ${n(r.incidents_live)}`,
    acted
      ? `• Sorties acted on: ${acted}. Agent resolved ${n(r.resolved_by_agent)} (${n(r.resolution_rate_pct)}%) by reschedule/cancel; ${acted - n(r.resolved_by_agent)} went to a human.`
      : '• Sorties acted on: 0. No incident touched a sortie inside the 2 h window.',
    `• Per level: ${levels || 'none'}`,
    `• Source failovers handled: ${n(r.failovers)}`,
    n(r.pending_holds)
      ? `• HOLDs waiting for an officer: ${n(r.pending_holds)} (${r.pending_hold_sorties})`
      : '• HOLDs waiting for an officer: 0',
    'AirGuard never says safe: sorties with no known issue stay PLANNED.',
  ].join('\n');
}

if (typeof module !== 'undefined') module.exports = { reportText };
// n8n glue (Code node, "Run once for all items"):
// return [{ json: { text: reportText($input.first().json) } }];
