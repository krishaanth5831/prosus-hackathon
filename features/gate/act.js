// Owner: Person B (see CLAUDE.md)
// WF3 after decide(): the decisions row, then for each decision that row made new: the sheet change, the Telegram
// text and the agent_log line. Pure functions, pasted into the WF3 Code nodes.
// Spec: docs/plan.md §6 WF3 + "Card text", contracts C5–C8.
// Telegram text is HTML (parse_mode HTML, because every cell id has a "_") in local time; sheet and log stay UTC.

const TZ = 'Europe/Amsterdam';
const HOLD_FOOTER = 'Agent: held. Needs your call. It never says safe.';
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const local = (t) => new Date(t).toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
const utc = (t) => new Date(t).toISOString().slice(11, 16);
const isoZ = (t) => new Date(t).toISOString().replace('.000Z', 'Z');
const until = (t, now) => {
  const min = Math.round((Date.parse(t) - now.getTime()) / 60e3);
  return min < 120 ? `${min} min` : `${Math.round(min / 6) / 10} h`;
};

// decisionRow(C6 decision) -> decisions row. WF3 inserts it before acting; the unique key makes each action happen once.
const decisionRow = (d) => ({
  key: d.key, sortie_id: d.sortie_id, incident_id: d.incident_id ?? null, level: d.level, batch: d.batch ?? null,
  old_launch_at: d.launch_at, new_launch_at: d.new_launch_at ?? null, decided_by: 'agent', reason: d.reason,
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

// cardText(held sortie, evidence line) -> the HOLD card (plan "Card text"). The buttons are C7 callback data in `cb`.
function cardText(a, line) {
  const spoof = a.level === 'L4_SPOOF_HOLD';
  return [esc(`⛔ HOLD${spoof ? ' · SPOOFING' : ''} · ${a.sortie_id} · ${a.unit} · launch ${local(a.launch_at)}`), esc(line),
    spoof ? 'Agent: held, positions there may be spoofed. Needs your call. It never says safe.' : HOLD_FOOTER].join('\n');
}

// act(inserted decisions row, its C5 sheet row, now) -> what WF3 does for it:
// sheet (C5 update or null), text (Telegram, or null), cb (C7 buttons, HOLD only), llm (briefing request, HOLD only), log (C8)
function act(d, s, now = new Date()) {
  const sid = d.sortie_id, launch = (s && s.launch_at) || isoZ(d.old_launch_at), unit = (s && s.unit) || '';
  const a = { id: String(d.id), key: d.key, sortie_id: sid, level: d.level, reason: d.reason,
    incident_id: d.incident_id == null ? null : String(d.incident_id), batch: d.batch == null ? null : String(d.batch),
    launch_at: launch, new_launch_at: d.new_launch_at == null ? null : isoZ(d.new_launch_at), unit,
    sheet: null, text: null, cb: null, llm: null };
  const head = (tag, when = local(launch)) => esc(`${tag} · ${sid} · ${unit} · launch ${when}`);
  const log = (verb, reason, outcome) => ({ workflow: 'WF3', action: `${verb} ${sid}`, reason, outcome });
  const hold = (note) => ({ status: 'HOLD', launch_at: launch, decided_by: 'agent', note });

  if (d.level === 'L1_RESCHEDULE') {
    const moved = `${utc(launch)}→${utc(a.new_launch_at)} UTC`;
    return { ...a,
      sheet: { status: 'RESCHEDULED', launch_at: a.new_launch_at, decided_by: 'agent', note: `moved +2 h ${moved}: ${d.reason}` },
      text: [head('🔁 RESCHEDULED', `${local(launch)} → ${local(a.new_launch_at)}`), esc(d.reason),
        'Agent: moved +2 h, still inside its window. FYI, no answer needed.'].join('\n'),
      log: log('RESCHEDULE', `${d.reason}; routine, +2 h still inside its window`, `launch ${moved}, sheet RESCHEDULED, FYI sent`) };
  }
  if (d.level === 'L2_CANCEL') {
    return { ...a,
      sheet: { status: 'CANCELLED', launch_at: launch, decided_by: 'agent', note: `cancelled: ${d.reason}` },
      text: [head('✖️ CANCELLED'), esc(d.reason), 'Agent: cancelled this low-priority sortie. FYI, no answer needed.'].join('\n'),
      log: log('CANCEL', `${d.reason}; low priority`, 'sheet CANCELLED, FYI sent') };
  }
  if (d.level === 'L3_HOLD' || d.level === 'L4_SPOOF_HOLD') {
    const why = d.level === 'L4_SPOOF_HOLD' ? 'possible spoofing, always a human call'
      : a.incident_id === null ? `launch in ${until(launch, now)}`
        : s && s.priority === 'priority' ? 'priority sortie, a human decides' : 'routine, no slot left in its window';
    return { ...a,
      sheet: hold(`HOLD, awaiting duty officer: ${d.reason}`),
      text: cardText(a, d.reason),
      cb: { keep: `k|${sid}|${a.id}`, launch: `l|${sid}|${a.id}`, false_alarm: `f|${sid}|${a.id}` },
      llm: briefingRequest(d.reason),
      log: log('HOLD', `${d.reason}; ${why}`, 'sheet HOLD, card sent, awaiting duty officer') };
  }
  if (d.level === 'BRAKE_HOLD') {
    return { ...a,
      sheet: hold(`HOLD (brake on incident ${a.batch}), awaiting duty officer: ${d.reason}`),
      log: log('HOLD', `brake: incident ${a.batch} touches more than 25% of the sorties in the next 12 h, `
        + `so no cancels or reschedules; ${d.reason}`, `sheet HOLD, batch card for incident ${a.batch} sent, awaiting duty officer`) };
  }
  if (d.level === 'UNVERIFIED') {
    return { ...a,
      text: [head('❔ UNVERIFIED'), esc(d.reason),
        'Agent: no aircraft there to check GPS, so nothing is verified. Nothing changed; the launch is your call.'].join('\n'),
      log: log('FLAG UNVERIFIED', `${d.reason}; launch in ${until(launch, now)}`, 'nothing changed, officer notified') };
  }
  return { ...a, // WATCH: at risk, logged once, nothing changes
    log: log('WATCH', `${d.reason}; launch in ${until(launch, now)}`, 'at risk, logged once; nothing changed (jamming often goes away before launch)') };
}

// batchCards(BRAKE items) -> one card per incident, with the two batch buttons (C7 bk/bf)
function batchCards(items) {
  const groups = new Map();
  for (const a of items) {
    if (!groups.has(a.batch)) groups.set(a.batch, []);
    groups.get(a.batch).push(a);
  }
  return [...groups].map(([batch, list]) => ({
    batch,
    text: [`⛔ BRAKE · incident ${batch} · ${list.length} ${list.length === 1 ? 'sortie' : 'sorties'} held`, esc(list[0].reason),
      esc(list.map((a) => `${a.sortie_id} ${local(a.launch_at)}`).join(' · ')),
      'Agent: held all of them. Needs your call. It never says safe.'].join('\n'),
    cb: { keep: `bk|${batch}`, false_alarm: `bf|${batch}` },
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
