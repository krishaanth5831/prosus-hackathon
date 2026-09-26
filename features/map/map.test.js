// Owner: Person C (see CLAUDE.md)
// Guards the map's hard rules: no green, never "safe" (except the legend line), no key in the repo, contract names.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

test('no green anywhere', () => {
  assert.doesNotMatch(html, /green|lime|#0f0\b|#00ff00|#2[a-f0-9]a[a-f0-9]4[a-f0-9]|🟢|✅/i);
});

test('never says safe or clear, except "never shows safe" in the legend', () => {
  assert.match(html, /never shows safe/);
  assert.doesNotMatch(html.replace(/never shows safe/g, ''), /\b(safe|clear|cleared)\b/i);
});

test('no Supabase key or project URL in the repo copy', () => {
  assert.doesNotMatch(html, /eyJ[A-Za-z0-9_-]{20,}/, 'no JWT');
  assert.doesNotMatch(html, /[a-z0-9]{20}\.supabase\.co/, 'no project URL');
  assert.ok(!fs.existsSync(path.join(__dirname, 'config.js')), 'config.js is written at deploy time and deleted after');
});

test('all four C4 states styled, reads cell_status + last 20 agent_log rows, 60 s refresh', () => {
  for (const s of ['JAMMED', 'SPOOF', 'UNKNOWN', 'NO_KNOWN_ISSUE']) assert.match(html, new RegExp(`${s}:\\s*{`));
  assert.match(html, /rest\('cell_status\?select=\*'\)/);
  assert.match(html, /agent_log\?select=[^']*order=ts\.desc&limit=20/);
  assert.match(html, /setInterval\(refresh, 60_000\)/);
});
