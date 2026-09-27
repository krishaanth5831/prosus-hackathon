// Owner: Person B (see CLAUDE.md)
// WF3 after decide(): the decisions row, then for each decision that row made new: the sheet change, the Telegram
// text and the agent_log line. Pure functions, pasted into the WF3 Code nodes.
// What the agent does on its own (reroute, reschedule, cancel, HOLD) is a plain FYI text in the ops group. Only a high
// risk HOLD (possible spoofing, a priority sortie, the brake) is a card that asks the duty officer: Hold, Launch anyway
// or Cancel. Every message has the same shape: what happened, the evidence, "Why:" the agent decided that on its own
// (or "Why you:" it needs a human), and what the agent did.
// Spec: docs/plan.md §6 WF3 + "Card text", contracts C5–C8.
// Telegram text is HTML (parse_mode HTML, because every cell id has a "_") in local time; sheet and log stay UTC.

const TZ = 'Europe/Amsterdam';
const HOLD_FOOTER = 'Agent: held it. Your call: Hold, Launch anyway or Cancel. It never says safe.';
const ALONE = 'That lowers the risk, so the agent acted alone.';
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const local = (t) => new Date(t).toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
const utc = (t) => new Date(t).toISOString().slice(11, 16);
const isoZ = (t) => new Date(t).toISOString().replace('.000Z', 'Z');
const until = (t, now) => {
  const min = Math.round((Date.parse(t) - now.getTime()) / 60e3);
  return min < 120 ? `${min} min` : `${Math.round(min / 6) / 10} h`;
};
const cellsOf = (s) => String((s && s.cells) || '').split(';').map((c) => c.trim()).filter(Boolean);
const cellIn = (reason) => (String(reason).match(/-?\d+\.\d_-?\d+\.\d/) || ['a cell on its route'])[0];   // the cell the decision is about
const noReroute = (s) => `${cellsOf(s).length > 1 ? 'every cell on its route is' : 'its only cell is'} at risk, so there is no reroute`;
// why a card needs a human (the "Why you:" line)
const WHY_YOU = {
  L3_HOLD: () => 'it is a priority sortie. Whether a priority mission waits, flies anyway or is cancelled is an operational call, so the agent holds it and asks instead of acting alone.',
  L4_SPOOF_HOLD: (a) => `positions in ${cellIn(a.reason)} may be spoofed. A spoofed drone trusts a confident but wrong fix and can drift or cross the border without noticing, so spoofing always goes to a human, whatever the priority.`,
  BRAKE_HOLD: () => 'one incident touches more than a quarter of the sorties in the next 12 h. Rerouting, moving or cancelling that many at once is too big a call for the agent, so it held them all.',
};

// decisionRow(C6 decision) -> decisions row. WF3 inserts it before acting; the unique key makes each action happen once.
const decisionRow = (d) => ({
  key: d.key, sortie_id: d.sortie_id, incident_id: d.incident_id ?? null, level: d.level, batch: d.batch ?? null,
  old_launch_at: d.launch_at, new_launch_at: d.new_launch_at ?? null, new_cells: d.new_cells ?? null, decided_by: 'agent', reason: d.reason,
});

// The briefing request: the LLM may rephrase the evidence line of a HOLD card, nothing else.
const BRIEFING_PROMPT = 'You write the evidence line on a drone duty officer\'s HOLD card, read on a phone, often at night. '
  + 'Rewrite the evidence as one plain sentence of at most 30 words. Keep every number and every cell id exactly as '
  + 'written and add no other numbers. Add no advice, no reassurance and nothing that is not in the evidence. '
  + 'Never use the words safe, clear or green. Reply with the sentence only.';
const briefingRequest = (reason) => ({
  model: 'claude-opus-5', max_tokens: 1024, output_config: { effort: 'low' }, fallbacks: 'default',
  system: BRIEFING_PROMPT, messages: [{ role: 'user', content: `Evidence: ${reason}` }],
});

// briefing(Messages API response, template line) -> the LLM line if it is usable, else the template line.
// Usable: a finished answer, one sentence-sized line, the same numbers and cell ids as the evidence, never safe/clear/green.
const FORBIDDEN = /\b(safe|safely|clear|cleared|green)\b/i;
const numbers = (s) => (s.match(/\d+(?:\.\d+)?/g) || []).sort().join(' ');
function briefing(res, template) {
  const text = res && res.stop_reason === 'end_turn' && Array.isArray(res.content)
    ? res.content.filter((b) => b.type === 'text').map((b) => b.text).join(' ').replace(/\s+/g, ' ').trim() : '';
  const cells = template.match(/-?\d+\.\d_-?\d+\.\d/g) || [];
  return text.length >= 10 && text.length <= 280 && !FORBIDDEN.test(text)
    && cells.every((c) => text.includes(c)) && numbers(text) === numbers(template) ? text : template;
}

// cardText(held sortie, evidence line) -> the HOLD card (plan "Card text"): what, the evidence (the LLM may rephrase that
// line), why it needs a human, the three answers. The buttons are C7 callback data in `cb`.
function cardText(a, line) {
  const spoof = a.level === 'L4_SPOOF_HOLD';
  return [esc(`⛔ HOLD${spoof ? ' · SPOOFING' : ''} · ${a.sortie_id} · ${a.unit} · launch ${local(a.launch_at)}`), esc(line),
    esc(`Why you: ${(WHY_YOU[a.level] || WHY_YOU.L3_HOLD)(a)}`), HOLD_FOOTER].join('\n');
}

// act(inserted decisions row, its C5 sheet row, now) -> what WF3 does for it:
// sheet (C5 update or null), text (Telegram, or null), cb (C7 buttons, HOLD only), llm (briefing request, HOLD only), log (C8)
function act(d, s, now = new Date()) {
  const sid = d.sortie_id, launch = (s && s.launch_at) || isoZ(d.old_launch_at), unit = (s && s.unit) || '';
  const a = { id: String(d.id), key: d.key, sortie_id: sid, level: d.level, reason: d.reason,
    incident_id: d.incident_id == null ? null : String(d.incident_id), batch: d.batch == null ? null : String(d.batch),
    launch_at: launch, new_launch_at: d.new_launch_at == null ? null : isoZ(d.new_launch_at), new_cells: d.new_cells ?? null, unit,
    sheet: null, text: null, cb: null, llm: null };
  const head = (tag, when = local(launch)) => esc(`${tag} · ${sid} · ${unit} · launch ${when}`);
  const log = (verb, reason, outcome) => ({ workflow: 'WF3', action: `${verb} ${sid}`, reason, outcome });
  const hold = (note) => ({ status: 'HOLD', launch_at: launch, decided_by: 'agent', note });

  if (d.level === 'L1_RESCHEDULE') {
    const moved = `${utc(launch)}→${utc(a.new_launch_at)} UTC`;
    return { ...a,
      sheet: { status: 'RESCHEDULED', launch_at: a.new_launch_at, decided_by: 'agent', note: `moved +2 h ${moved}: ${d.reason}` },
      text: [head('🔁 RESCHEDULED', `${local(launch)} → ${local(a.new_launch_at)}`), esc(d.reason),
        esc(`Why: ${noReroute(s)}. It is routine and +2 h still ends inside its window${s && s.window_end ? ` (until ${local(s.window_end)})` : ''}, `
          + `so a later launch is the smallest change; the gate checks it again before then. ${ALONE}`),
        'Agent: moved it +2 h. FYI, no answer needed.'].join('\n'),
      log: log('RESCHEDULE', `${d.reason}; routine, +2 h still inside its window`, `launch ${moved}, sheet RESCHEDULED, FYI sent`) };
  }
  if (d.level === 'L1_REROUTE') {
    const kept = String(a.new_cells || '').split(';').filter(Boolean);
    const dropped = String((s && s.cells) || '').split(';').map((c) => c.trim()).filter((c) => c && !kept.includes(c));
    const gone = dropped.join(', ') || 'the risky cells', to = kept.join(', ');
    const why = `${gone} ${dropped.length > 1 ? 'are' : 'is'} at risk, but ${to} ${kept.length > 1 ? 'have' : 'has'} no known jamming. `
      + `Flying only ${kept.length > 1 ? 'those cells' : 'that cell'} keeps the sortie on time and out of the risky ${dropped.length > 1 ? 'cells' : 'cell'}. ${ALONE}`;
    return { ...a,
      sheet: { status: 'REROUTED', cells: kept.join(';'), decided_by: 'agent', note: `rerouted, dropped ${gone}: ${d.reason}` },
      text: [head('🧭 REROUTED'), esc(d.reason), esc(`Why: ${why}`),
        esc(`Agent: dropped ${gone}; it flies ${to} at the planned time. FYI, no answer needed.`)].join('\n'),
      log: log('REROUTE', `${d.reason}; ${(s && s.priority) || 'routine'} sortie, the rest of its route has no known jamming`,
        `route now ${to} (dropped ${gone}), sheet REROUTED, FYI sent`) };
  }
  if (d.level === 'L3_AUTO_HOLD') {
    return { ...a,
      sheet: hold(`HOLD by the agent, routine, no slot left in its window: ${d.reason}`),
      text: [head('✋ HOLD'), esc(d.reason),
        esc(`Why: ${noReroute(s)}, and +2 h would end after its window${s && s.window_end ? ` closes at ${local(s.window_end)}` : ''}, so it cannot be moved. `
          + `A routine sortie is held rather than cancelled. ${ALONE}`),
        'Agent: held it. FYI, no answer needed. It never says safe.'].join('\n'),
      log: log('HOLD', `${d.reason}; routine, no slot left in its window, so the agent holds it`, 'sheet HOLD by the agent, FYI sent') };
  }
  if (d.level === 'L2_CANCEL') {
    return { ...a,
      sheet: { status: 'CANCELLED', launch_at: launch, decided_by: 'agent', note: `cancelled: ${d.reason}` },
      text: [head('✖️ CANCELLED'), esc(d.reason),
        esc(`Why: ${noReroute(s)}, and it is low priority: a low-priority sortie is cancelled rather than moved or held. ${ALONE}`),
        'Agent: cancelled it. FYI, no answer needed.'].join('\n'),
      log: log('CANCEL', `${d.reason}; low priority`, 'sheet CANCELLED, FYI sent') };
  }
  if (d.level === 'L3_HOLD' || d.level === 'L4_SPOOF_HOLD') {
    const why = d.level === 'L4_SPOOF_HOLD' ? 'possible spoofing, always a human call'
      : `priority sortie, a human decides${a.incident_id === null ? `; launch in ${until(launch, now)}` : ''}`;
    return { ...a,
      sheet: hold(`HOLD, awaiting duty officer: ${d.reason}`),
      text: cardText(a, d.reason),
      cb: { keep: `k|${sid}|${a.id}`, launch: `l|${sid}|${a.id}`, cancel: `c|${sid}|${a.id}` },
      llm: briefingRequest(d.reason),
      log: log('HOLD', `${d.reason}; ${why}`, 'sheet HOLD, card sent, awaiting duty officer') };
  }
  if (d.level === 'BRAKE_HOLD') {
    return { ...a,
      sheet: hold(`HOLD (brake on incident ${a.batch}), awaiting duty officer: ${d.reason}`),
      log: log('HOLD', `brake: incident ${a.batch} touches more than 25% of the sorties in the next 12 h, `
        + `so no reroutes, cancels or reschedules; ${d.reason}`, `sheet HOLD, batch card for incident ${a.batch} sent, awaiting duty officer`) };
  }
  if (d.level === 'UNVERIFIED') {
    return { ...a,
      text: [head('❔ UNVERIFIED'), esc(d.reason),
        'Why: too few aircraft and no recent drone report there to check GPS, so AirGuard cannot see jamming there, and it cannot say there is none.',
        'Agent: nothing changed; the launch is your call.'].join('\n'),
      log: log('FLAG UNVERIFIED', `${d.reason}; launch in ${until(launch, now)}`, 'nothing changed, officer notified') };
  }
  return { ...a, // WATCH: at risk, logged once, nothing changes
    log: log('WATCH', `${d.reason}; launch in ${until(launch, now)}`, 'at risk, logged once; nothing changed (jamming often goes away before launch)') };
}

// batchCards(BRAKE items) -> one card per incident, with the three batch buttons (C7 bk/bl/bc)
function batchCards(items) {
  const groups = new Map();
  for (const a of items) {
    if (!groups.has(a.batch)) groups.set(a.batch, []);
    groups.get(a.batch).push(a);
  }
  return [...groups].map(([batch, list]) => ({
    batch,
    text: [`⛔ BRAKE · incident ${batch} · ${list.length} ${list.length === 1 ? 'sortie' : 'sorties'} held`, esc(list[0].reason),
      esc(list.map((a) => `${a.sortie_id} ${local(a.launch_at)}`).join(' · ')), esc(`Why you: ${WHY_YOU.BRAKE_HOLD()}`),
      'Agent: held all of them. Your call for all of them: Hold, Launch anyway or Cancel. It never says safe.'].join('\n'),
    cb: { keep: `bk|${batch}`, launch: `bl|${batch}`, cancel: `bc|${batch}` },
  }));
}

if (typeof module !== 'undefined') module.exports = { decisionRow, act, cardText, briefing, briefingRequest, batchCards };
// n8n glue, one per Code node ("Run once for all items"):
// Decision rows: return $input.all().map((i) => ({ json: decisionRow(i.json) }));
// Acted:         const sorties = Object.fromEntries($('Read sorties').all().map((i) => [i.json.sortie_id, i.json]));
//                return $input.all().filter((i) => i.json.id != null).map((i) => ({ json: act(i.json, sorties[i.json.sortie_id]) }));
// Card:          const held = $('Acted').all().map((i) => i.json).filter((a) => a.cb);
//                return $input.all().map((i, k) => ({ json: { ...held[k], text: cardText(held[k], briefing(i.json, held[k].reason)) } }));
// Batch cards:   return batchCards($input.all().map((i) => i.json)).map((json) => ({ json }));
