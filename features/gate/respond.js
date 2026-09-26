// Owner: Person B (see CLAUDE.md)
// WF6: one tap on a card. Pure functions, pasted into the WF6 Code nodes. Spec: docs/plan.md §6 WF6, contracts C5, C7, C8.
// parseTap and outcome run only after the IF "Allowlisted?" let the tap through; refusedLine runs on the refused branch.
// Telegram text is HTML (parse_mode HTML) in local time; the sheet and the log stay in UTC.

const TZ = 'Europe/Amsterdam';
const C7 = /^(?:([klf])\|([A-Za-z0-9-]+)\|(\d+)|(b[kf])\|(\d+))$/;
const ANSWER = { k: 'keep', l: 'launch', f: 'false_alarm', bk: 'keep', bf: 'false_alarm' };
const STATUS = { keep: 'HOLD', launch: 'LAUNCH_APPROVED', false_alarm: 'PLANNED' };
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const local = (t) => new Date(t).toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
const utc = (t) => new Date(t).toISOString().slice(11, 16);

// parseTap(Telegram update) -> who tapped which button (C7) on which card, plus the claim.sql parameters $1..$6
function parseTap(update) {
  const q = (update && update.callback_query) || {};
  const m = C7.exec(String(q.data ?? ''));
  const kind = m ? m[1] || m[4] : null;
  const name = String((q.from && (q.from.first_name || q.from.username)) || '')
    .replace(/[^\p{L}\p{N} ._-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 40) || 'officer';
  const t = { valid: !!m, kind, answer: kind ? ANSWER[kind] : null, batch: !!kind && kind[0] === 'b',
    sortie_id: (m && m[2]) || null, decision_id: (m && m[3]) || null, incident_id: (m && m[5]) || null,
    name, who: `human:${name}`, callback_id: q.id ?? null, chat_id: q.message?.chat?.id ?? null,
    message_id: q.message?.message_id ?? null, message_text: q.message?.text ?? '' };
  t.params = [t.answer || 'none', !m ? 'none' : t.batch ? 'batch' : 'single', t.decision_id || '0', t.sortie_id || '-',
    t.incident_id || '0', name];
  return t;
}

// outcome(tap, rows claim.sql returned, now) -> {sheet: C5 updates, log: C8 lines, answer: the toast, edit: the card's new text}
// The edit keeps the card's text, adds what happened and drops the buttons. A tap that claimed nothing gets the toast
// only (edit null): on a double tap the winning tap edits the card, and a second edit could overwrite its outcome.
function outcome(t, rows, now = new Date()) {
  const got = (rows || []).filter((r) => r && r.sortie_id);
  const at = `${utc(now)} UTC`, here = local(now);
  const card = (line) => `${esc(t.message_text)}\n\n${esc(line)}`;
  if (!t.valid || !got.length) {
    const line = t.valid ? 'Already answered. Nothing changed.' : 'Unknown button. Nothing changed.';
    const target = !t.valid ? 'BUTTON' : t.batch ? `INCIDENT ${t.incident_id}` : t.sortie_id;
    return { sheet: [], answer: line, edit: null, log: [{ workflow: 'WF6', action: `IGNORE TAP ${target}`,
      reason: `${t.who} tapped ${t.valid ? 'a card that was already answered' : 'a button AirGuard does not know'}`,
      outcome: 'nothing changed' }] };
  }
  const sheet = got.map((r) => ({ sortie_id: r.sortie_id, status: STATUS[t.answer], decided_by: t.who, note: {
    keep: `HOLD kept by ${t.name} at ${at}: ${r.reason}`,
    launch: `launch approved by ${t.name} at ${at} despite: ${r.reason}`,
    false_alarm: `false alarm (${t.name}, ${at}): ${r.reason}`,
  }[t.answer] }));
  const log = got.map((r) => ({ workflow: 'WF6', ...{
    keep: { action: `KEEP HOLD ${r.sortie_id}`, reason: `${t.who} tapped Keep HOLD: ${r.reason}`,
      outcome: `sheet stays HOLD, decision #${r.id} answered` },
    launch: { action: `APPROVE LAUNCH ${r.sortie_id}`, reason: `${t.who} tapped Launch anyway: ${r.reason}`,
      outcome: 'sheet LAUNCH_APPROVED by a human; the agent never approves a launch' },
    false_alarm: { action: `MARK FALSE ALARM ${r.sortie_id}`, reason: `${t.who} marked it a false alarm: ${r.reason}`,
      outcome: 'sheet PLANNED, the gate checks it again every cycle' },
  }[t.answer] }));
  const raised = got.find((r) => r.closed_now && r.new_threshold != null); // once per incident: a card has one incident
  if (raised) log.push({ workflow: 'WF6', action: `RAISE THRESHOLD ${raised.cell_id}`,
    reason: `false alarm on incident #${raised.incident_id}, marked by ${t.who}`,
    outcome: `threshold now ${Number(raised.new_threshold).toFixed(2)} (+0.05, max 0.6), incident #${raised.incident_id} closed` });
  const n = got.length, what = t.batch ? `${n} ${n === 1 ? 'sortie' : 'sorties'}` : got[0].sortie_id;
  const more = raised ? ` Cell ${raised.cell_id} threshold now ${Number(raised.new_threshold).toFixed(2)}, `
    + `incident ${raised.incident_id} closed.` : '';
  return { sheet, log,
    answer: { keep: `Kept on HOLD: ${what}`, launch: `Launch approved: ${what}`, false_alarm: `False alarm: ${what} back to PLANNED` }[t.answer],
    edit: card({ keep: `✋ ${t.batch ? `All ${n} kept` : 'Kept'} on HOLD by ${t.name} at ${here}.`,
      launch: `🚀 Launch approved by ${t.name} at ${here}. The agent did not approve it.`,
      false_alarm: `↩️ False alarm by ${t.name} at ${here}: ${what} back to PLANNED.${more}` }[t.answer]) };
}

// refusedLine(Telegram update) -> the C8 line for a tap from outside the allowlist. No name or id: agent_log is public.
function refusedLine(update) {
  const m = C7.exec(String(update?.callback_query?.data ?? ''));
  return { workflow: 'WF6', action: `REFUSE TAP ${!m ? 'BUTTON' : m[2] || `INCIDENT ${m[5]}`}`,
    reason: 'a Telegram account that is not on the allowlist tapped a card button', outcome: 'answered "not authorised", nothing changed' };
}

if (typeof module !== 'undefined') module.exports = { parseTap, outcome, refusedLine };
// n8n glue, one per Code node ("Run once for all items"):
// Parse tap:    return [{ json: parseTap($('Telegram Trigger').first().json) }];
// Outcome:      return [{ json: outcome($('Parse tap').first().json, $input.all().map((i) => i.json)) }];
// Refused line: return [{ json: refusedLine($('Telegram Trigger').first().json) }];
