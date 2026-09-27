// Owner: Krish (see CLAUDE.md)
// C14 telegram_log: what n8n records right after each Telegram call, so the ops console shows the group live.
// Each workflow that talks to the group has one Postgres node for it ("Telegram log"; WF6: "Log tap", "Log edit",
// "Log refused tap") that runs TG_SQL with one of the parameter lists below. They are n8n expressions that give 7
// strings; an empty string stores null. No chat id and no user id ever reach the table.
const TG_SQL = "insert into telegram_log (workflow, kind, message_id, text, buttons, who, ts)\n"
  + "values ($1, $2, nullif($3, '')::bigint, $4, nullif($5, '')::jsonb, nullif($6, ''), "
  + "coalesce(to_timestamp(nullif($7, '')::double precision), now()));";

// after a Telegram node that sent a message: its output is Telegram's answer {ok, result: Message}
const sentParams = (wf) => `={{ (r => ['${wf}', 'message', String(r.message_id || ''), String(r.text || ''), `
  + 'r.reply_markup && r.reply_markup.inline_keyboard ? JSON.stringify(r.reply_markup.inline_keyboard.map((row) => row.map((b) => b.text))) : \'\', '
  + "'', String(r.date || '')])($json.result || {}) }}";
// WF6 after "Edit card": the card as the group now shows it (the answer added, the buttons gone)
const editParams = "={{ (r => ['WF6', 'edit', String(r.message_id || ''), String(r.text || ''), '', '', String(r.edit_date || r.date || '')])($json.result || {}) }}";
// WF6 after "Parse tap" (allowlisted): who tapped which button on which card
const tapParams = "={{ ['WF6', 'tap', String($json.message_id || ''), String($json.label || ''), '', String($json.who || ''), ''] }}";
// WF6 on the refused branch: someone outside the allowlist tapped; no name
const refusedParams = "={{ (q => ['WF6', 'tap', String(q.message ? q.message.message_id : ''), 'a button', '', 'not on the allowlist', ''])($('Telegram Trigger').first().json.callback_query || {}) }}";

if (typeof module !== 'undefined') module.exports = { TG_SQL, sentParams, editParams, tapParams, refusedParams };
