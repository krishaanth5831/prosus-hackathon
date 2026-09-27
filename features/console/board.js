// Owner: Krish (see CLAUDE.md)
// Pure functions for the ops console, loaded by the browser (script tag) and by node --test.
// boardRows: the sortie mirror (a copy of the Google Sheet, synced every WF3 cycle) plus what the gate and the
// duty officer decided since that sync, so the board changes the moment a decision lands, not 5 minutes later.
// The mapping is the one act.js (agent) and respond.js (officer) apply to the sheet.

const HOLD_LEVELS = ['L3_HOLD', 'L4_SPOOF_HOLD', 'BRAKE_HOLD'];
const ANSWER_STATUS = { keep: 'HOLD', launch: 'LAUNCH_APPROVED', false_alarm: 'PLANNED' };
const isoZ = (t) => (t ? new Date(t).toISOString().replace('.000Z', 'Z') : null);

// boardRows(sorties: mirror rows, decisions: decisions rows, syncedAt: sheet_sync.synced_at) -> board rows
function boardRows(sorties, decisions, syncedAt) {
  const latest = new Map();
  for (const d of decisions) {
    const p = latest.get(d.sortie_id);
    if (!p || Number(d.id) > Number(p.id)) latest.set(d.sortie_id, d);
  }
  const sync = Date.parse(syncedAt) || 0;
  return sorties.map((s) => {
    const d = latest.get(s.sortie_id) || null;
    let { status, launch_at: launchAt, decided_by: decidedBy } = s;
    if (d && Date.parse(d.ts) > sync) {                       // the gate acted after the mirror read the sheet
      if (d.level === 'L1_RESCHEDULE') { status = 'RESCHEDULED'; launchAt = isoZ(d.new_launch_at) || launchAt; decidedBy = 'agent'; }
      if (d.level === 'L2_CANCEL') { status = 'CANCELLED'; decidedBy = 'agent'; }
      if (HOLD_LEVELS.includes(d.level)) { status = 'HOLD'; decidedBy = 'agent'; }
    }
    if (d && d.human_answer && status === 'HOLD' && ANSWER_STATUS[d.human_answer]) {   // answered on Telegram
      status = ANSWER_STATUS[d.human_answer]; decidedBy = d.decided_by;
    }
    return {
      ...s, status, launch_at: launchAt, decided_by: decidedBy,
      cellList: String(s.cells || '').split(';').map((c) => c.trim()).filter(Boolean),
      level: d ? d.level : null, reason: d ? d.reason : (s.note || ''), decision: d,
      pending: !!d && HOLD_LEVELS.includes(d.level) && !d.human_answer && status === 'HOLD',
    };
  });
}

// column(row, now, flying: Set of sortie ids in the air) -> where the board shows it
function column(r, now, flying) {
  if (r.pending) return 'officer';
  if (flying.has(r.sortie_id)) return 'flight';
  if (r.status === 'HOLD') return 'hold';
  if (r.status === 'RESCHEDULED' || r.status === 'CANCELLED') return 'changed';
  const t = Date.parse(r.launch_at);
  return Number.isFinite(t) && t < now ? 'past' : 'upcoming';
}

// who wrote an agent_log line, for the log filters and colours
function logKind(workflow) {
  return { WF2: 'agent', WF3: 'agent', WF6: 'officer', WF7: 'drone', WF8: 'console' }[workflow] || 'pipeline';
}

if (typeof module !== 'undefined') module.exports = { boardRows, column, logKind, HOLD_LEVELS };
