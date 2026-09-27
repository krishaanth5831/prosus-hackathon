// Owner: Person B (see CLAUDE.md)
// respond.js on the C7 fixture callbacks: parse, what each answer does to the sheet/log/card, stale, invalid, refused.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseTap, outcome, refusedLine } = require('./respond');

const updates = JSON.parse(fs.readFileSync(path.join(__dirname, '../../shared/contracts/fixtures/telegram-callback.sample.json'), 'utf8'));
const [KEEP, LAUNCH, FALSE_ALARM, BATCH_KEEP, BATCH_FALSE, CANCEL, BATCH_LAUNCH, BATCH_CANCEL] = updates;
const NOW = new Date('2026-09-26T21:41:00Z'); // 23:41 in Amsterdam
const JAM = 'JAMMED cell 54.5_20.5 (high): 5/8 aircraft degraded, 2 checks in a row';
const CARD = KEEP.callback_query.message.text;
// A claim.sql row as the Postgres node returns it
const claimed = (o) => ({ id: '42', sortie_id: 'T-001', level: 'L3_HOLD', incident_id: '41', batch: null, reason: JAM,
  human_answer: 'keep', cell_id: '54.5_20.5', new_threshold: null, closed_now: false, ...o });

test('parseTap: the eight C7 kinds (f and bf only on older cards), claim parameters never empty', () => {
  assert.deepEqual(updates.map((u) => { const t = parseTap(u); return [t.kind, t.answer, t.batch, t.sortie_id, t.decision_id, t.incident_id, t.label]; }), [
    ['k', 'keep', false, 'T-001', '42', null, 'Hold'],
    ['l', 'launch', false, 'T-001', '42', null, 'Launch anyway'],
    ['f', 'false_alarm', false, 'T-001', '42', null, 'False alarm'],
    ['bk', 'keep', true, null, null, '41', 'Hold (all)'],
    ['bf', 'false_alarm', true, null, null, '41', 'False alarm (all)'],
    ['c', 'cancel', false, 'T-001', '42', null, 'Cancel'],
    ['bl', 'launch', true, null, null, '41', 'Launch anyway (all)'],
    ['bc', 'cancel', true, null, null, '41', 'Cancel (all)'],
  ]);
  const t = parseTap(KEEP);
  assert.deepEqual([t.valid, t.name, t.who, t.callback_id, t.chat_id, t.message_id, t.message_text],
    [true, 'Duty', 'human:Duty', '4410921783002811001', 111111111, 201, CARD]);
  assert.deepEqual(t.params, ['keep', 'single', '42', 'T-001', '0', 'Duty']);
  assert.deepEqual(parseTap(BATCH_FALSE).params, ['false_alarm', 'batch', '0', '-', '41', 'Duty']);
  for (const u of updates) for (const p of parseTap(u).params) assert.ok(typeof p === 'string' && p.length > 0);
});

test('parseTap: anything that is not C7 is invalid and claims nothing; names are cleaned', () => {
  for (const data of ['x|T-001|42', 'k|T-001', 'k|T 001|42', 'bk|abc', "k|T-001|42'; drop table decisions; --", '', undefined]) {
    const t = parseTap({ callback_query: { ...KEEP.callback_query, data } });
    assert.equal(t.valid, false, String(data));
    assert.deepEqual(t.params.slice(0, 2), ['none', 'none']);
  }
  const named = (from) => parseTap({ callback_query: { ...KEEP.callback_query, from } });
  assert.equal(named({ id: 1, first_name: 'Ana-María, 🛩️ <b>' }).name, 'Ana-María b');
  assert.equal(named({ id: 1, username: 'duty_officer' }).name, 'duty_officer');
  assert.equal(named({ id: 1 }).who, 'human:officer');
});

test('Hold: sheet stays HOLD, decided_by the human, card keeps its text and loses its buttons', () => {
  const o = outcome(parseTap(KEEP), [claimed()], NOW);
  assert.deepEqual(o.sheet, [{ sortie_id: 'T-001', status: 'HOLD', decided_by: 'human:Duty', note: `HOLD kept by Duty at 21:41 UTC: ${JAM}` }]);
  assert.deepEqual(o.log, [{ workflow: 'WF6', action: 'KEEP HOLD T-001', reason: `human:Duty tapped Hold: ${JAM}`,
    outcome: 'sheet stays HOLD, decision #42 answered' }]);
  assert.equal(o.answer, 'Kept on HOLD: T-001');
  assert.equal(o.edit, `${CARD}\n\n✋ Kept on HOLD by Duty at 23:41.`);
});

test('Launch anyway: LAUNCH_APPROVED by a human, never by the agent', () => {
  const o = outcome(parseTap(LAUNCH), [claimed({ human_answer: 'launch' })], NOW);
  assert.deepEqual(o.sheet.map((s) => [s.status, s.decided_by]), [['LAUNCH_APPROVED', 'human:Duty']]);
  assert.equal(o.sheet[0].note, `launch approved by Duty at 21:41 UTC despite: ${JAM}`);
  assert.deepEqual([o.log[0].action, o.log[0].outcome], ['APPROVE LAUNCH T-001', 'sheet LAUNCH_APPROVED by a human; the agent never approves a launch']);
  assert.equal(o.edit, `${CARD}\n\n🚀 Launch approved by Duty at 23:41. The agent did not approve it.`);
});

test('Cancel: CANCELLED by a human, the incident and its threshold stay as they are', () => {
  const o = outcome(parseTap(CANCEL), [claimed({ human_answer: 'cancel', new_threshold: null, closed_now: false })], NOW);
  assert.deepEqual(o.sheet, [{ sortie_id: 'T-001', status: 'CANCELLED', decided_by: 'human:Duty', note: `cancelled by Duty at 21:41 UTC: ${JAM}` }]);
  assert.deepEqual(o.log, [{ workflow: 'WF6', action: 'CANCEL T-001', reason: `human:Duty tapped Cancel: ${JAM}`, outcome: 'sheet CANCELLED by a human' }]);
  assert.equal(o.answer, 'Cancelled: T-001');
  assert.equal(o.edit, `${CARD}\n\n✖️ Cancelled by Duty at 23:41.`);
});

test('False alarm (older cards only): back to PLANNED, one extra line for the raised threshold and the closed incident', () => {
  const o = outcome(parseTap(FALSE_ALARM), [claimed({ human_answer: 'false_alarm', new_threshold: 0.35, closed_now: true })], NOW);
  assert.deepEqual(o.sheet, [{ sortie_id: 'T-001', status: 'PLANNED', decided_by: 'human:Duty', note: `false alarm (Duty, 21:41 UTC): ${JAM}` }]);
  assert.deepEqual(o.log.map((l) => l.action), ['MARK FALSE ALARM T-001', 'RAISE THRESHOLD 54.5_20.5']);
  assert.deepEqual(o.log[1], { workflow: 'WF6', action: 'RAISE THRESHOLD 54.5_20.5', reason: 'false alarm on incident #41, marked by human:Duty',
    outcome: 'threshold now 0.35 (+0.05, max 0.6), incident #41 closed' });
  assert.equal(o.answer, 'False alarm: T-001 back to PLANNED');
  assert.equal(o.edit, `${CARD}\n\n↩️ False alarm by Duty at 23:41: T-001 back to PLANNED. Cell 54.5_20.5 threshold now 0.35, incident 41 closed.`);
  const again = outcome(parseTap(FALSE_ALARM), [claimed({ human_answer: 'false_alarm' })], NOW); // incident already closed
  assert.deepEqual(again.log.map((l) => l.action), ['MARK FALSE ALARM T-001']);
  assert.equal(again.edit, `${CARD}\n\n↩️ False alarm by Duty at 23:41: T-001 back to PLANNED.`);
});

test('batch buttons: every held sortie of the incident at once, one threshold line', () => {
  const rows = (answer, o = {}) => ['T-001', 'T-002', 'T-004', 'T-007'].map((sortie_id, k) =>
    claimed({ id: String(50 + k), sortie_id, level: 'BRAKE_HOLD', batch: '41', human_answer: answer, ...o }));
  const keep = outcome(parseTap(BATCH_KEEP), rows('keep'), NOW);
  assert.deepEqual(keep.sheet.map((s) => [s.sortie_id, s.status]), [['T-001', 'HOLD'], ['T-002', 'HOLD'], ['T-004', 'HOLD'], ['T-007', 'HOLD']]);
  assert.equal(keep.answer, 'Kept on HOLD: 4 sorties');
  assert.match(keep.edit, /\n\n✋ All 4 kept on HOLD by Duty at 23:41\.$/);
  const fa = outcome(parseTap(BATCH_FALSE), rows('false_alarm', { new_threshold: 0.4, closed_now: true }), NOW);
  assert.deepEqual(fa.sheet.map((s) => s.status), ['PLANNED', 'PLANNED', 'PLANNED', 'PLANNED']);
  assert.deepEqual(fa.log.filter((l) => l.action.startsWith('RAISE')).length, 1);
  assert.match(fa.edit, /↩️ False alarm by Duty at 23:41: 4 sorties back to PLANNED\. Cell 54\.5_20\.5 threshold now 0\.40, incident 41 closed\.$/);
  const go = outcome(parseTap(BATCH_LAUNCH), rows('launch'), NOW);
  assert.deepEqual([go.sheet.map((s) => s.status), go.answer], [['LAUNCH_APPROVED', 'LAUNCH_APPROVED', 'LAUNCH_APPROVED', 'LAUNCH_APPROVED'], 'Launch approved: 4 sorties']);
  assert.equal(go.log[0].reason, `human:Duty tapped Launch anyway (all): ${JAM}`);
  const stop = outcome(parseTap(BATCH_CANCEL), rows('cancel'), NOW);
  assert.deepEqual([stop.sheet.map((s) => s.status), stop.answer], [['CANCELLED', 'CANCELLED', 'CANCELLED', 'CANCELLED'], 'Cancelled: 4 sorties']);
  assert.match(stop.edit, /\n\n✖️ All 4 cancelled by Duty at 23:41\.$/);
});

test('already answered or unknown button: nothing changes, a toast only, the card is left to the tap that won', () => {
  for (const empty of [[], [{ success: true }], [{}]]) { // what the Postgres node gives when nothing was claimed
    const o = outcome(parseTap(KEEP), empty, NOW);
    assert.deepEqual([o.sheet, o.answer, o.edit], [[], 'Already answered. Nothing changed.', null]);
    assert.deepEqual(o.log, [{ workflow: 'WF6', action: 'IGNORE TAP T-001', reason: 'human:Duty tapped a card that was already answered', outcome: 'nothing changed' }]);
  }
  assert.equal(outcome(parseTap(BATCH_KEEP), [], NOW).log[0].action, 'IGNORE TAP INCIDENT 41');
  const bad = outcome(parseTap({ callback_query: { ...KEEP.callback_query, data: 'zz' } }), [], NOW);
  assert.deepEqual([bad.answer, bad.edit, bad.log[0].action], ['Unknown button. Nothing changed.', null, 'IGNORE TAP BUTTON']);
});

test('refusedLine: C8 line without the stranger\'s name or id (agent_log is public)', () => {
  const stranger = { callback_query: { ...KEEP.callback_query, from: { id: 999999999, first_name: 'Mallory', username: 'mallory' } } };
  const line = refusedLine(stranger);
  assert.deepEqual(line, { workflow: 'WF6', action: 'REFUSE TAP T-001', reason: 'a Telegram account that is not on the allowlist tapped a card button',
    outcome: 'answered "not authorised", nothing changed' });
  assert.doesNotMatch(JSON.stringify(line), /Mallory|mallory|999999999/);
  assert.equal(refusedLine(BATCH_FALSE).action, 'REFUSE TAP INCIDENT 41');
  assert.equal(refusedLine({}).action, 'REFUSE TAP BUTTON');
});

test('card edits are HTML-escaped; toasts fit Telegram (200 chars); nothing says safe or clear', () => {
  const t = { ...parseTap(KEEP), message_text: 'a < b & c' };
  assert.equal(outcome(t, [claimed()], NOW).edit.split('\n')[0], 'a &lt; b &amp; c');
  const all = updates.map((u) => outcome(parseTap(u), [claimed({ new_threshold: 0.35, closed_now: true })], NOW));
  for (const o of all) {
    assert.ok(o.answer.length <= 200);
    for (const l of o.log) assert.match(l.action, /^[A-Z]+( [A-Z]+)* \S+$/);
  }
  assert.doesNotMatch(JSON.stringify(all).replace(/It never says safe\./g, ''), /\b(safe|clear|cleared|green)\b/i);
});
