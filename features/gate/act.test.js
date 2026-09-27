// Owner: Person B (see CLAUDE.md)
// act.js: what WF3 does for each new decision (sheet, Telegram, agent_log), the briefing guard and the batch card.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { decisionRow, act, cardText, briefing, briefingRequest, batchCards } = require('./act');

const NOW = new Date('2026-09-26T21:05:00Z'); // 23:05 in Amsterdam (CEST)
const UNIT = '3rd Border Drone Sqn (DEMO, fictional)';
const JAM = 'JAMMED cell 54.5_20.5 (high): 5/8 aircraft degraded, 2 checks in a row';
const C7 = /^(?:[klcf]\|[A-Za-z0-9-]+\|\d+|b[klcf]\|\d+)$/;
const fixtureCards = JSON.parse(fs.readFileSync(path.join(__dirname, '../../shared/contracts/fixtures/telegram-callback.sample.json'), 'utf8'))
  .map((u) => u.callback_query.message.text);
const sortie = (o) => ({ sortie_id: 'T-001', unit: UNIT, priority: 'routine', launch_at: '2026-09-26T21:35:00Z',
  window_end: '2026-09-27T03:35:00Z', cells: '54.5_20.5', status: 'PLANNED', decided_by: '', note: '', row_number: 2, ...o });
// A decisions row as the Postgres node returns it: bigint as text, timestamptz as ISO with milliseconds
const row = (o) => ({ id: '42', ts: '2026-09-26T21:05:01.000Z', key: 'T-001|41|2026-09-26T21:35:00Z', sortie_id: 'T-001',
  incident_id: '41', level: 'L3_HOLD', batch: null, old_launch_at: '2026-09-26T21:35:00.000Z', new_launch_at: null,
  decided_by: 'agent', human_answer: null, reason: JAM, ...o });

test('decisionRow: a C6 decision becomes exactly the decisions columns, decided by the agent', () => {
  assert.deepEqual(decisionRow({ sortie_id: 'T-002', launch_at: '2026-09-26T22:05:00Z', key: 'T-002|41|2026-09-26T22:05:00Z',
    incident_id: '41', level: 'L1_RESCHEDULE', human: false, new_launch_at: '2026-09-27T00:05:00.000Z', reason: JAM }), {
    key: 'T-002|41|2026-09-26T22:05:00Z', sortie_id: 'T-002', incident_id: '41', level: 'L1_RESCHEDULE', batch: null,
    old_launch_at: '2026-09-26T22:05:00Z', new_launch_at: '2026-09-27T00:05:00.000Z', new_cells: null, decided_by: 'agent', reason: JAM,
  });
  assert.equal(decisionRow({ key: 'k', level: 'L1_REROUTE', new_cells: '56.5_21.0' }).new_cells, '56.5_21.0');
  const unverified = decisionRow({ sortie_id: 'T-006', launch_at: '2026-09-26T21:45:00Z', key: 'T-006|unknown|2026-09-26T21:45:00Z',
    incident_id: null, level: 'UNVERIFIED', human: false, reason: 'no sensor coverage in 55.0_21.0' });
  assert.deepEqual([unverified.incident_id, unverified.batch, unverified.new_launch_at], [null, null, null]);
  assert.equal(decisionRow({ key: 'k', level: 'BRAKE_HOLD', batch: '41', new_launch_at: undefined }).batch, '41');
});

test('L1: sheet RESCHEDULED at +2 h (UTC, no milliseconds), FYI in local time, one C8 line', () => {
  const a = act(row({ level: 'L1_RESCHEDULE', key: 'T-002|41|2026-09-26T22:05:00Z', sortie_id: 'T-002',
    old_launch_at: '2026-09-26T22:05:00.000Z', new_launch_at: '2026-09-27T00:05:00.000Z' }),
  sortie({ sortie_id: 'T-002', launch_at: '2026-09-26T22:05:00Z' }), NOW);
  assert.deepEqual(a.sheet, { status: 'RESCHEDULED', launch_at: '2026-09-27T00:05:00Z', decided_by: 'agent',
    note: `moved +2 h 22:05→00:05 UTC: ${JAM}` });
  assert.equal(a.text, `🔁 RESCHEDULED · T-002 · ${UNIT} · launch 00:05 → 02:05\n${JAM}\n`
    + 'Why: its only cell is at risk, so there is no reroute. It is routine and +2 h still ends inside its window (until 05:35), '
    + 'so a later launch is the smallest change; the gate checks it again before then. That lowers the risk, so the agent acted alone.\n'
    + 'Agent: moved it +2 h. FYI, no answer needed.');
  assert.deepEqual(a.log, { workflow: 'WF3', action: 'RESCHEDULE T-002', reason: `${JAM}; routine, +2 h still inside its window`,
    outcome: 'launch 22:05→00:05 UTC, sheet RESCHEDULED, FYI sent' });
  assert.deepEqual([a.cb, a.llm], [null, null]);
});

test('L1 reroute: sheet REROUTED with the kept cells, FYI names what was dropped, no card', () => {
  const a = act(row({ level: 'L1_REROUTE', new_cells: '56.5_21.0;55.0_21.0' }), sortie({ cells: '54.5_20.5;56.5_21.0;55.0_21.0' }), NOW);
  assert.deepEqual(a.sheet, { status: 'REROUTED', cells: '56.5_21.0;55.0_21.0', decided_by: 'agent', note: `rerouted, dropped 54.5_20.5: ${JAM}` });
  assert.equal(a.text, `🧭 REROUTED · T-001 · ${UNIT} · launch 23:35\n${JAM}\n`
    + 'Why: 54.5_20.5 is at risk, but 56.5_21.0, 55.0_21.0 have no known jamming. Flying only those cells keeps the sortie on time '
    + 'and out of the risky cell. That lowers the risk, so the agent acted alone.\n'
    + 'Agent: dropped 54.5_20.5; it flies 56.5_21.0, 55.0_21.0 at the planned time. FYI, no answer needed.');
  assert.deepEqual(a.log, { workflow: 'WF3', action: 'REROUTE T-001', reason: `${JAM}; routine sortie, the rest of its route has no known jamming`,
    outcome: 'route now 56.5_21.0, 55.0_21.0 (dropped 54.5_20.5), sheet REROUTED, FYI sent' });
  assert.deepEqual([a.cb, a.llm], [null, null]);
});

test('L3 auto: the agent holds a routine sortie with no slot left on its own: sheet HOLD, FYI, no card', () => {
  const a = act(row({ level: 'L3_AUTO_HOLD' }), sortie({ window_end: '2026-09-26T22:35:00Z' }), NOW);
  assert.deepEqual(a.sheet, { status: 'HOLD', launch_at: '2026-09-26T21:35:00Z', decided_by: 'agent',
    note: `HOLD by the agent, routine, no slot left in its window: ${JAM}` });
  assert.equal(a.text, `✋ HOLD · T-001 · ${UNIT} · launch 23:35\n${JAM}\n`
    + 'Why: its only cell is at risk, so there is no reroute, and +2 h would end after its window closes at 00:35, so it cannot be moved. '
    + 'A routine sortie is held rather than cancelled. That lowers the risk, so the agent acted alone.\n'
    + 'Agent: held it. FYI, no answer needed. It never says safe.');
  assert.deepEqual([a.log.action, a.log.outcome], ['HOLD T-001', 'sheet HOLD by the agent, FYI sent']);
  assert.deepEqual([a.cb, a.llm], [null, null], 'no buttons and no briefing: nobody is asked');
});

test('L2: sheet CANCELLED, launch_at untouched, FYI', () => {
  const a = act(row({ level: 'L2_CANCEL' }), sortie({ priority: 'low' }), NOW);
  assert.deepEqual(a.sheet, { status: 'CANCELLED', launch_at: '2026-09-26T21:35:00Z', decided_by: 'agent', note: `cancelled: ${JAM}` });
  assert.match(a.text, /^✖️ CANCELLED · T-001 · .* · launch 23:35\n/);
  assert.equal(a.text.split('\n')[2], 'Why: its only cell is at risk, so there is no reroute, and it is low priority: '
    + 'a low-priority sortie is cancelled rather than moved or held. That lowers the risk, so the agent acted alone.');
  assert.match(act(row({ level: 'L2_CANCEL' }), sortie({ priority: 'low', cells: '54.5_20.5;55.0_20.5' }), NOW).text,
    /\nWhy: every cell on its route is at risk, so there is no reroute,/);
  assert.deepEqual([a.log.action, a.log.outcome], ['CANCEL T-001', 'sheet CANCELLED, FYI sent']);
});

test('L3: HOLD card is the plan template (same text as the C7 fixture), Hold / Launch anyway / Cancel, briefing request', () => {
  const a = act(row(), sortie({ priority: 'priority' }), NOW);
  assert.equal(a.text, fixtureCards[0], 'the card we send is the card WF6 gets back');
  assert.deepEqual(a.sheet, { status: 'HOLD', launch_at: '2026-09-26T21:35:00Z', decided_by: 'agent',
    note: `HOLD, awaiting duty officer: ${JAM}` });
  assert.deepEqual(a.cb, { keep: 'k|T-001|42', launch: 'l|T-001|42', cancel: 'c|T-001|42' });
  for (const data of Object.values(a.cb)) assert.ok(C7.test(data) && Buffer.byteLength(data) <= 64, data);
  assert.deepEqual(a.log, { workflow: 'WF3', action: 'HOLD T-001', reason: `${JAM}; priority sortie, a human decides`,
    outcome: 'sheet HOLD, card sent, awaiting duty officer' });
  assert.deepEqual(a.llm, briefingRequest(JAM));
  const blind = act(row({ incident_id: null, key: 'T-001|unknown|2026-09-26T21:35:00Z',
    reason: 'no sensor coverage in 55.0_21.0, which was jammed in the last 6 h' }), sortie({ priority: 'priority' }), NOW);
  assert.equal(blind.log.reason, 'no sensor coverage in 55.0_21.0, which was jammed in the last 6 h; priority sortie, a human decides; launch in 30 min');
  assert.equal(blind.cb.cancel, 'c|T-001|42');
});

test('L4: flagged as spoofing on the card, always a human call', () => {
  const spoof = 'SPOOF cell 59.5_25.0 (high): 2 aircraft with GPS/baro altitude gap > 1500 ft, 2 checks in a row';
  const a = act(row({ level: 'L4_SPOOF_HOLD', incident_id: '42', reason: spoof }), sortie({ priority: 'low' }), NOW);
  assert.equal(a.text, `⛔ HOLD · SPOOFING · T-001 · ${UNIT} · launch 23:35\n`
    + 'SPOOF cell 59.5_25.0 (high): 2 aircraft with GPS/baro altitude gap &gt; 1500 ft, 2 checks in a row\n'
    + 'Why you: positions in 59.5_25.0 may be spoofed. A spoofed drone trusts a confident but wrong fix and can drift or cross the border '
    + 'without noticing, so spoofing always goes to a human, whatever the priority.\n'
    + 'Agent: held it. Your call: Hold, Launch anyway or Cancel. It never says safe.');
  assert.equal(a.log.reason, `${spoof}; possible spoofing, always a human call`);
  assert.equal(a.sheet.status, 'HOLD');
});

test('BRAKE: each sortie HOLD in the sheet, one batch card per incident with the three batch buttons', () => {
  const braked = ['T-001', 'T-002', 'T-004', 'T-007'].map((sortie_id, k) => act(
    row({ id: String(50 + k), sortie_id, level: 'BRAKE_HOLD', batch: '41', key: `${sortie_id}|41|x` }),
    sortie({ sortie_id, launch_at: new Date(Date.parse('2026-09-26T21:30:00Z') + k * 30 * 60e3).toISOString() }), NOW));
  assert.deepEqual(braked[0].sheet, { status: 'HOLD', launch_at: '2026-09-26T21:30:00.000Z', decided_by: 'agent',
    note: `HOLD (brake on incident 41), awaiting duty officer: ${JAM}` });
  assert.equal(braked[0].text, null, 'no single card: the batch card covers it');
  assert.match(braked[0].log.reason, /^brake: incident 41 touches more than 25% of the sorties in the next 12 h, so no reroutes, cancels or reschedules; JAMMED/);
  const [card, ...more] = batchCards(braked);
  assert.equal(more.length, 0);
  const lines = card.text.split('\n'), fixture = fixtureCards[3].split('\n');
  assert.deepEqual([lines[0], lines[1], lines[3], lines[4]], fixture, 'header, evidence, why and footer are the C7 fixture batch card');
  assert.equal(lines[2], 'T-001 23:30 · T-002 00:00 · T-004 00:30 · T-007 01:00');
  assert.deepEqual(card.cb, { keep: 'bk|41', launch: 'bl|41', cancel: 'bc|41' });
  for (const data of Object.values(card.cb)) assert.ok(C7.test(data), data);
  assert.equal(batchCards([braked[0], { ...braked[1], batch: '38' }]).length, 2, 'one card per incident');
});

test('WATCH logs once and changes nothing; UNVERIFIED notifies and changes nothing', () => {
  const w = act(row({ level: 'WATCH', key: 'T-005|41|watch', sortie_id: 'T-005', old_launch_at: '2026-09-27T02:05:00.000Z' }),
    sortie({ sortie_id: 'T-005', launch_at: '2026-09-27T02:05:00Z' }), NOW);
  assert.deepEqual([w.sheet, w.text, w.cb], [null, null, null]);
  assert.deepEqual(w.log, { workflow: 'WF3', action: 'WATCH T-005', reason: `${JAM}; launch in 5 h`,
    outcome: 'at risk, logged once; nothing changed (jamming often goes away before launch)' });
  const u = act(row({ level: 'UNVERIFIED', incident_id: null, reason: 'no sensor coverage in 55.0_21.0' }), sortie(), NOW);
  assert.equal(u.sheet, null);
  assert.equal(u.text, `❔ UNVERIFIED · T-001 · ${UNIT} · launch 23:35\nno sensor coverage in 55.0_21.0\n`
    + 'Why: too few aircraft and no recent drone report there to check GPS, so AirGuard cannot see jamming there, and it cannot say there is none.\n'
    + 'Agent: nothing changed; the launch is your call.');
  assert.deepEqual([u.log.action, u.log.reason], ['FLAG UNVERIFIED T-001', 'no sensor coverage in 55.0_21.0; launch in 30 min']);
});

test('briefing: the LLM line only when finished, faithful to every number and cell id, and never safe/clear/green', () => {
  const ok = 'Cell 54.5_20.5: 5 of 8 aircraft lost GPS integrity on 2 checks in a row, high severity.';
  const res = (text, o = {}) => ({ type: 'message', stop_reason: 'end_turn', content: [{ type: 'text', text }], ...o });
  assert.equal(briefing(res(ok), JAM), ok);
  assert.equal(briefing(res(ok, { content: [{ type: 'fallback', from: {}, to: {} }, { type: 'text', text: ok }] }), JAM), ok,
    'a server-side fallback block before the text is fine');
  const rejected = {
    refusal: res(ok, { stop_reason: 'refusal' }),
    'cut off': res(ok, { stop_reason: 'max_tokens' }),
    'node error': { error: { message: 'timeout' } },
    'LLM node disabled': act(row(), sortie(), NOW),
    'says safe': res('Cell 54.5_20.5: 5 of 8 aircraft degraded on 2 checks, not safe to fly.'),
    'says clear': res('Cell 54.5_20.5: 5 of 8 aircraft degraded on 2 checks, it may clear soon.'),
    'changed a number': res('Cell 54.5_20.5: 6 of 8 aircraft degraded on 2 checks in a row.'),
    'invented a number': res('Cell 54.5_20.5: 5 of 8 aircraft (62%) degraded on 2 checks in a row.'),
    'lost the cell id': res('Cell 54.5/20.5: 5 of 8 aircraft degraded on 2 checks in a row.'),
    'wrote numbers as words': res('Cell 54.5_20.5: five of eight aircraft degraded on two checks.'),
    empty: res(''),
    'too long': res(`${ok} ${'Jamming is a known problem in the region. '.repeat(6)}`),
  };
  for (const [why, r] of Object.entries(rejected)) assert.equal(briefing(r, JAM), JAM, why);
});

test('briefingRequest: claude-opus-5, low effort, server-side fallbacks, no sampling parameters', () => {
  const body = briefingRequest(JAM);
  assert.deepEqual(Object.keys(body).sort(), ['fallbacks', 'max_tokens', 'messages', 'model', 'output_config', 'system']);
  assert.deepEqual([body.model, body.fallbacks, body.output_config], ['claude-opus-5', 'default', { effort: 'low' }]);
  assert.deepEqual(body.messages, [{ role: 'user', content: `Evidence: ${JAM}` }]);
});

test('every text says why: "Why:" for what the agent did alone, "Why you:" for what needs a human', () => {
  const texts = ['L1_REROUTE', 'L1_RESCHEDULE', 'L2_CANCEL', 'L3_AUTO_HOLD', 'L3_HOLD', 'L4_SPOOF_HOLD', 'UNVERIFIED'].map((level) =>
    [level, act(row({ level, new_launch_at: '2026-09-26T23:35:00.000Z', new_cells: '56.5_21.0' }), sortie({ cells: '54.5_20.5;56.5_21.0' }), NOW).text]);
  for (const [level, text] of texts) {
    const alone = ['L1_REROUTE', 'L1_RESCHEDULE', 'L2_CANCEL', 'L3_AUTO_HOLD'].includes(level);
    const why = alone ? /^Why: .*the agent acted alone\.$/ : level === 'UNVERIFIED' ? /^Why: / : /^Why you: /;   // a notice, not a request
    assert.match(text.split('\n')[2], why, level);
    assert.match(text, alone ? /FYI, no answer needed\./ : /your call/i, level);
  }
  const brake = batchCards([act(row({ level: 'BRAKE_HOLD', batch: '41' }), sortie(), NOW)])[0].text;
  assert.match(brake, /\nWhy you: one incident touches more than a quarter of the sorties in the next 12 h\./);
});

test('text is HTML-escaped for Telegram; log actions are C8 (UPPERCASE verb + object); nothing says safe or clear', () => {
  const a = act(row(), sortie({ unit: 'Sqn <A> & B' }), NOW);
  assert.match(a.text, /· Sqn &lt;A&gt; &amp; B ·/);
  assert.equal(cardText({ ...a, unit: 'x' }, 'a < b').split('\n')[1], 'a &lt; b');
  const all = ['L1_REROUTE', 'L1_RESCHEDULE', 'L2_CANCEL', 'L3_AUTO_HOLD', 'L3_HOLD', 'L4_SPOOF_HOLD', 'BRAKE_HOLD', 'WATCH', 'UNVERIFIED'].map((level) =>
    act(row({ level, batch: level === 'BRAKE_HOLD' ? '41' : null, new_launch_at: '2026-09-26T23:35:00.000Z', new_cells: '56.5_21.0' }),
      sortie({ cells: '54.5_20.5;56.5_21.0' }), NOW));
  for (const a2 of all) {
    assert.match(a2.log.action, /^[A-Z]+( [A-Z]+)* T-001$/, a2.level);
    assert.equal(a2.log.workflow, 'WF3');
  }
  // everything a human reads (sheet, Telegram, log); the LLM prompt names the banned words only to ban them
  const words = JSON.stringify([all.map(({ llm, ...said }) => said), batchCards(all.filter((x) => x.batch))])
    .replace(/It never says safe\./g, '');
  assert.doesNotMatch(words, /\b(safe|clear|cleared|green)\b/i);
  assert.doesNotMatch(words, /🟢|✅/);
});
