// Owner: Person B (see CLAUDE.md)
// WF3 and WF6 exports follow C9 and stay in sync with the .js/.sql files they embed.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const text = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');
const load = (f) => JSON.parse(text(f));
const CREDENTIALS = ['AirGuard Postgres', 'AirGuard Telegram', 'AirGuard Sheets', 'AirGuard Apify', 'AirGuard LLM'];
const TRIGGERS = ['n8n-nodes-base.executeWorkflowTrigger', 'n8n-nodes-base.telegramTrigger'];
const node = (wf, name) => wf.nodes.find((n) => n.name === name);
const next = (wf, name, output) => (output === undefined ? (wf.connections[name]?.main ?? []).flat()
  : wf.connections[name]?.main?.[output] ?? []).map((c) => c.node);
const below = (wf, name) => { // every node reachable from `name`
  const seen = new Set(), todo = [name];
  while (todo.length) for (const n of next(wf, todo.pop())) if (!seen.has(n)) { seen.add(n); todo.push(n); }
  return [...seen];
};
const of = (wf, type) => wf.nodes.filter((n) => n.type === `n8n-nodes-base.${type}`);

function followsC9(wf) {
  for (const n of wf.nodes) {
    for (const ref of Object.values(n.credentials ?? {})) {
      assert.ok(CREDENTIALS.includes(ref.name), `${n.name}: credential "${ref.name}"`);
      assert.equal(ref.id, undefined, `${n.name}: credential id removed`);
    }
  }
  for (const t of wf.nodes.filter((n) => TRIGGERS.includes(n.type))) assert.deepEqual(next(wf, t.name), ['Config'], `${t.name} → Config`);
  const config = node(wf, 'Config');
  assert.equal(config.type, 'n8n-nodes-base.set');
  assert.deepEqual(config.parameters.assignments.assignments.map((a) => [a.name, a.value]),
    [['telegram_chat_id', '123456789'], ['allowed_user_ids', '111111111,222222222'], ['sheet_id', 'your_google_sheet_id']],
    'the export keeps the .env.example dummies; real values are set at import');
  for (const [from, { main }] of Object.entries(wf.connections)) {
    assert.ok(node(wf, from), `connection from ${from}`);
    for (const c of main.flat()) assert.ok(node(wf, c.node), `connection to ${c.node}`);
  }
  assert.equal(new Set(wf.nodes.map((n) => n.name)).size, wf.nodes.length, 'unique node names');
  assert.equal(wf.settings.executionOrder, 'v1', 'branch order below relies on v1');
  for (const n of of(wf, 'telegram').filter((x) => x.parameters.resource !== 'callback')) {
    assert.equal(n.parameters.additionalFields.parse_mode, 'HTML', `${n.name}: Markdown breaks on the "_" in cell ids`);
    if ((n.parameters.operation ?? 'sendMessage') === 'sendMessage') assert.equal(n.parameters.additionalFields.appendAttribution, false);
  }
  for (const n of of(wf, 'googleSheets').filter((x) => x.parameters.operation === 'update')) {
    assert.deepEqual(n.parameters.columns.matchingColumns, ['sortie_id'], n.name);
    assert.equal(n.parameters.options.cellFormat, 'RAW', `${n.name}: ISO timestamps stay text`);
    assert.deepEqual([n.parameters.sheetName.value, n.parameters.documentId.value], ['sorties', "={{ $('Config').first().json.sheet_id }}"]);
  }
  // Code nodes = a tested file + glue; the glue lines are the ones documented at the bottom of that file
  for (const n of of(wf, 'code')) {
    const file = ['decide.js', 'act.js', 'respond.js'].find((f) => n.parameters.jsCode.startsWith(text(f)));
    if (!file) { assert.ok(n.parameters.jsCode.split('\n').length <= 2, `${n.name}: glue-only nodes stay one line`); continue; }
    for (const line of n.parameters.jsCode.slice(text(file).length).split('\n').filter(Boolean))
      assert.ok(text(file).includes(line.trim()), `${n.name}: glue "${line.trim()}" is documented in ${file}`);
  }
  const said = JSON.stringify(wf.nodes.map(({ parameters: { jsCode, ...p } }) => p)); // code is checked by its own tests
  assert.doesNotMatch(said, /\b(safe|clear|cleared|green)\b/i, 'never says safe or clear');
  assert.doesNotMatch(JSON.stringify(wf), /\d{8,10}:[A-Za-z0-9_-]{35}|sk-ant-|eyJhbGciOi/, 'no secrets');
}

test('WF3 Gate export: C9, reads → decide → insert decisions first → act only on returned rows', () => {
  const wf = load('wf3-gate.json');
  assert.equal(wf.name, 'AirGuard WF3 Gate');
  followsC9(wf);
  assert.equal(node(wf, 'Start').type, 'n8n-nodes-base.executeWorkflowTrigger');
  const chain = ['Start', 'Config', 'Read sorties', 'Cell status', 'Done keys', 'Recent incidents', 'decide', 'Decision rows',
    'Insert decisions', 'Acted'];
  chain.slice(0, -1).forEach((n, k) => assert.deepEqual(next(wf, n), [chain[k + 1]], `${n} → ${chain[k + 1]}`));
  for (const n of ['Cell status', 'Done keys', 'Recent incidents']) {
    assert.deepEqual([node(wf, n).executeOnce, node(wf, n).alwaysOutputData], [true, true], `${n}: once per cycle, continues on 0 rows`);
  }
  assert.equal(node(wf, 'Done keys').parameters.query, "select key from decisions where ts > now() - interval '2 days';");
  assert.equal(node(wf, 'Recent incidents').parameters.query,
    "select distinct cell_id from incidents where opened_at > now() - interval '6 hours' or status <> 'closed';");
  const ins = node(wf, 'Insert decisions');
  assert.deepEqual([ins.parameters.table.value, ins.parameters.columns.mappingMode, ins.parameters.options.skipOnConflict],
    ['decisions', 'autoMapInputData', true], 'insert ... on conflict (key) do nothing returning *');
  assert.ok(node(wf, 'Acted').parameters.jsCode.includes('filter((i) => i.json.id != null)'), 'only rows the insert returned');
  assert.deepEqual(next(wf, 'Acted'), ['Switch level', 'agent_log lines']);
});

test('WF3 Gate export: one Switch branch per level group, WATCH log only, agent_log written last', () => {
  const wf = load('wf3-gate.json');
  const rules = node(wf, 'Switch level').parameters.rules.values;
  assert.deepEqual(rules.map((r) => r.conditions.conditions.map((c) => c.rightValue)),
    [['L1_RESCHEDULE', 'L2_CANCEL'], ['L3_HOLD', 'L4_SPOOF_HOLD'], ['BRAKE_HOLD'], ['UNVERIFIED']]);
  assert.deepEqual([0, 1, 2, 3].map((o) => next(wf, 'Switch level', o)),
    [['Update sheet', 'Telegram FYI'], ['HOLD in sheet', 'LLM briefing'], ['HOLD all in sheet', 'Batch cards'], ['Telegram UNVERIFIED']]);
  assert.deepEqual([next(wf, 'LLM briefing'), next(wf, 'Card'), next(wf, 'Batch cards')], [['Card'], ['Telegram card'], ['Telegram batch card']]);
  const buttons = (n) => node(wf, n).parameters.inlineKeyboard.rows[0].row.buttons.map((b) => [b.text, b.additionalFields.callback_data]);
  assert.deepEqual(buttons('Telegram card'), [['Keep HOLD', '={{ $json.cb.keep }}'], ['Launch anyway', '={{ $json.cb.launch }}'],
    ['False alarm', '={{ $json.cb.false_alarm }}']]);
  assert.deepEqual(buttons('Telegram batch card'), [['Keep HOLD (all)', '={{ $json.cb.keep }}'], ['False alarm (all)', '={{ $json.cb.false_alarm }}']]);
  assert.deepEqual(Object.keys(node(wf, 'Update sheet').parameters.columns.value), ['sortie_id', 'status', 'launch_at', 'decided_by', 'note']);
  for (const n of ['HOLD in sheet', 'HOLD all in sheet'])
    assert.deepEqual(Object.keys(node(wf, n).parameters.columns.value), ['sortie_id', 'status', 'decided_by', 'note'], `${n}: launch untouched`);
  const llm = node(wf, 'LLM briefing');
  assert.equal(llm.onError, 'continueRegularOutput', 'an LLM failure never stops a card: the template line is used');
  assert.deepEqual([llm.parameters.url, llm.parameters.nodeCredentialType, llm.parameters.jsonBody, llm.credentials.anthropicApi.name],
    ['https://api.anthropic.com/v1/messages', 'anthropicApi', '={{ JSON.stringify($json.llm) }}', 'AirGuard LLM']);
  // n8n v1 runs sibling branches top to bottom, each to completion: the log goes below every Switch branch
  const lowest = Math.max(...below(wf, 'Switch level').map((n) => node(wf, n).position[1]));
  assert.ok(node(wf, 'agent_log lines').position[1] > lowest, 'agent_log lines runs after sheet and Telegram');
  assert.deepEqual(next(wf, 'agent_log lines'), ['Insert agent_log']);
});

test('WF6 Respond export: the only Telegram Trigger, allowlist first, claim → sheet → log → answer → edit', () => {
  const wf = load('wf6-respond.json');
  assert.equal(wf.name, 'AirGuard WF6 Respond');
  followsC9(wf);
  const [trigger, ...more] = of(wf, 'telegramTrigger');
  assert.equal(more.length, 0);
  assert.deepEqual(trigger.parameters.updates, ['callback_query']);
  assert.ok(trigger.webhookId);
  assert.deepEqual([next(wf, 'Config'), next(wf, 'Allowlisted?', 0), next(wf, 'Allowlisted?', 1)],
    [['Allowlisted?'], ['Parse tap'], ['Refused line']]);
  assert.deepEqual([next(wf, 'Parse tap'), next(wf, 'Claim'), next(wf, 'Outcome')], [['Claim'], ['Outcome'], ['Sheet rows', 'Log rows', 'Answer']]);
  const ys = ['Sheet rows', 'Log rows', 'Answer'].map((n) => node(wf, n).position[1]);
  assert.deepEqual([...ys].sort((a, b) => a - b), ys, 'v1 order: sheet, then log, then answer');
  assert.deepEqual([next(wf, 'Sheet rows'), next(wf, 'Log rows'), next(wf, 'Answer'), next(wf, 'Card edit')],
    [['Update sheet'], ['Insert agent_log'], ['Card edit'], ['Edit card']]);
  assert.match(node(wf, 'Card edit').parameters.jsCode, /return edit \? \[\{ json: \{ edit \} \}\] : \[\];/,
    'a tap that claimed nothing leaves the card to the tap that won');
  assert.equal(node(wf, 'Edit card').parameters.text, '={{ $json.edit }}');
  const claim = node(wf, 'Claim');
  assert.equal(claim.parameters.query, text('claim.sql'));
  assert.equal(claim.parameters.options.queryReplacement, '={{ $json.params }}', 'one array: values with commas stay whole');
  assert.equal(claim.alwaysOutputData, true);
  const edit = node(wf, 'Edit card').parameters;
  assert.deepEqual([edit.operation, edit.replyMarkup], ['editMessageText', 'none'], 'the edit drops the buttons');
  const refused = node(wf, 'Answer refused').parameters;
  assert.deepEqual([refused.operation, refused.additionalFields.show_alert], ['answerQuery', true]);
  assert.match(refused.additionalFields.text, /^Not authorised/);
  assert.deepEqual(next(wf, 'Refused line'), ['Answer refused', 'Log refused']);
  assert.ok(node(wf, 'Answer refused').position[1] < node(wf, 'Log refused').position[1], 'answer, then log');
});

test('WF6 Respond: the Allowlisted? expression lets only listed Telegram user ids through', () => {
  const wf = load('wf6-respond.json');
  const expr = node(wf, 'Allowlisted?').parameters.conditions.conditions[0].leftValue.match(/^=\{\{([\s\S]*)\}\}$/)[1];
  const update = JSON.parse(fs.readFileSync(path.join(__dirname, '../../shared/contracts/fixtures/telegram-callback.sample.json'), 'utf8'))[0];
  const allowed = (list, fromId) => new Function('$', `return (${expr});`)((name) => ({ first: () => ({ json: name === 'Config'
    ? { allowed_user_ids: list } : { ...update, callback_query: { ...update.callback_query, from: { id: fromId } } } }) }));
  assert.equal(allowed('111111111,222222222', 111111111), true);
  assert.equal(allowed('222222222, 111111111', 111111111), true, 'spaces in the list are fine');
  assert.equal(allowed('111111111,222222222', 999999999), false);
  assert.equal(allowed('1111111110', 111111111), false, 'no prefix match');
  assert.equal(allowed('', 111111111), false);
});
