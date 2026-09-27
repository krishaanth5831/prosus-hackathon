#!/usr/bin/env node
// Owner: Krish (see CLAUDE.md)
// AirGuard ops console: a zero-dependency local server.   npm run console   (= node features/console/server.js)
//   --no-fleet          do not fly the simulated fleet
//   --fleet-speed=N     the simulated drones fly N times faster than real time (default 1)
//   --mirror-real       simulated drones also degrade in cells with a live (real) incident
// The browser gets only the public Supabase URL and anon key (select-only by RLS) and reads Supabase itself, live.
// Everything else that needs a secret (n8n, Apify, Telegram, the drone and console tokens) stays in this process.
// Listens on 127.0.0.1 only; every request must name this host (DNS rebinding) and every POST must come from this page.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { boardRows } = require('./board.js');
const { n8nSummary, apifySummary, telegramSummary, aircraftView, nextCollect } = require('./status.js');
const { Fleet } = require('./fleet.js');
const { demoPlan } = require('./demoPlan.js');

const HOST = '127.0.0.1';
const JS = 'text/javascript; charset=utf-8';
const FILES = { '/': ['index.html', 'text/html; charset=utf-8'], '/app.js': ['app.js', JS], '/board.js': ['board.js', JS], '/geo.js': ['geo.js', JS] };
const hosts = (port) => [`127.0.0.1:${port}`, `localhost:${port}`];
const allowedHost = (host, port) => hosts(port).includes(String(host || '').toLowerCase());
const sameOrigin = (origin, port) => hosts(port).some((h) => origin === `http://${h}`);
const isoZ = (t) => new Date(t).toISOString().replace('.000Z', 'Z');

async function getJson(url, headers = {}) {
  const r = await fetch(url, { headers, signal: AbortSignal.timeout(10e3) });
  if (!r.ok) throw new Error(`${new URL(url).host} answered HTTP ${r.status}`);   // never the URL: it can hold a token
  return r.json();
}
const cache = new Map();
async function cached(key, ttl, fn) {
  const c = cache.get(key);
  if (c && Date.now() - c.at < ttl) return c.value;
  const value = await fn();
  cache.set(key, { at: Date.now(), value });
  return value;
}
const settle = (fn) => fn().catch((e) => ({ error: e.message }));

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 20e3) { reject(new Error('body too large')); req.destroy(); } });
    req.on('end', () => { try { resolve(body ? JSON.parse(body) : {}); } catch { reject(new Error('body is not JSON')); } });
  });
}

function main() {
  try { process.loadEnvFile(path.join(__dirname, '../../.env')); } catch { /* the environment may already have the values */ }
  const E = process.env, argv = process.argv.slice(2);
  const opt = (k, d) => (argv.find((a) => a.startsWith(`--${k}=`)) || `=${d}`).split('=')[1];
  const PORT = Number(E.CONSOLE_PORT || 8787);
  const N8N = String(E.N8N_BASE_URL || '').replace(/\/$/, ''), SB = String(E.SUPABASE_URL || '').replace(/\/$/, '');
  const ACTOR = JSON.parse(fs.readFileSync(path.join(__dirname, '../collect/wf1-collect.json'), 'utf8'))
    .nodes.find((n) => n.name === 'Config').parameters.assignments.assignments.find((a) => a.name === 'actor_id').value;
  const n8nH = { 'X-N8N-API-KEY': E.N8N_API_KEY || '' }, apifyH = { Authorization: `Bearer ${E.APIFY_TOKEN || ''}` };
  const sbGet = (q) => getJson(`${SB}/rest/v1/${q}`, { apikey: E.SUPABASE_ANON_KEY, Authorization: `Bearer ${E.SUPABASE_ANON_KEY}` });

  // pipeline health, cached so an open console costs about one API call per source every 15-60 s
  async function status() {
    const now = Date.now();
    const [n8n, apify, telegram] = await Promise.all([
      settle(() => cached('n8n', 15e3, async () => {
        const [w, x] = await Promise.all([cached('workflows', 60e3, () => getJson(`${N8N}/api/v1/workflows?limit=100`, n8nH)),
          getJson(`${N8N}/api/v1/executions?limit=250`, n8nH)]);
        return n8nSummary(w.data, x.data, Date.now());
      })),
      settle(() => cached('apify', 30e3, async () => {
        const runs = (await getJson(`https://api.apify.com/v2/acts/${ACTOR}/runs?desc=1&limit=20`, apifyH)).data.items;
        const ok = runs.find((r) => r.status === 'SUCCEEDED');
        const meta = ok && await cached(`meta:${ok.id}`, 3600e3, () => getJson(
          `https://api.apify.com/v2/key-value-stores/${ok.defaultKeyValueStoreId}/records/RUN_META`, apifyH).catch(() => null));
        const schedule = await cached('schedule', 300e3, async () => {
          const s = (await getJson('https://api.apify.com/v2/schedules?limit=100', apifyH)).data.items.find((x) => x.name === 'airguard-adsb-every-5-min');
          return s ? (await getJson(`https://api.apify.com/v2/schedules/${s.id}`, apifyH)).data : null;
        });
        return apifySummary(runs, meta, schedule, Date.now());
      })),
      settle(() => cached('telegram', 60e3, async () => {
        const bot = `https://api.telegram.org/bot${E.TELEGRAM_BOT_TOKEN}`;
        const me = await cached('tg-me', 600e3, async () => (await getJson(`${bot}/getMe`)).result);
        return telegramSummary(me, (await getJson(`${bot}/getWebhookInfo`)).result, Date.now());
      })),
    ]);
    return { now: isoZ(now), nextCollect: nextCollect(now), n8n, apify, telegram,
      fleet: fleet ? { on: true, drones: snapshot ? snapshot.drones.length : 0, reports: fleet.reports, speed: fleet.speed } : { on: false } };
  }

  // the ADS-B sensor network as of the last collect: the aircraft of the newest succeeded actor run
  const aircraft = () => cached('aircraft', 60e3, async () => {
    const run = (await getJson(`https://api.apify.com/v2/acts/${ACTOR}/runs?desc=1&limit=10`, apifyH)).data.items.find((r) => r.status === 'SUCCEEDED');
    if (!run) return { ts: null, source: null, aircraft: [] };
    return cached(`aircraft:${run.id}`, 3600e3, async () => aircraftView(await getJson(
      `https://api.apify.com/v2/datasets/${run.defaultDatasetId}/items?clean=true&limit=3000&fields=ts,source,hex,flight,lat,lon,nic,nac_p,alt_geom,alt_baro,empty`, apifyH)));
  });

  // the simulated fleet: sorties from the mirror + the latest decisions, reports to WF7, telemetry to the browser
  let fleet = null, snapshot = null;
  const streams = new Set();
  async function postReport(report) {
    if (!E.DRONE_INTAKE_TOKEN) throw new Error('DRONE_INTAKE_TOKEN is missing in .env');
    const r = await fetch(`${N8N}/webhook/airguard-drone`, { method: 'POST', body: JSON.stringify(report), signal: AbortSignal.timeout(20e3),
      headers: { 'content-type': 'application/json', 'X-AirGuard-Token': E.DRONE_INTAKE_TOKEN } });
    if (!r.ok) throw new Error(`WF7 answered HTTP ${r.status}`);
  }
  async function refreshSorties() {
    try {
      const since = new Date(Date.now() - 48 * 3600e3).toISOString();
      const [sorties, decisions, sync] = await Promise.all([sbGet('sorties?select=*'),
        sbGet(`decisions?select=id,ts,sortie_id,level,new_launch_at,human_answer,decided_by,reason&ts=gte.${since}&order=id.desc&limit=1000`),
        sbGet('sheet_sync?select=synced_at')]);
      fleet.setSorties(boardRows(sorties, decisions, sync[0] && sync[0].synced_at));
      if (fleet.mirrorReal) fleet.setRealBad(await sbGet('cell_status?select=cell_id,state&state=in.(JAMMED,SPOOF)'));
    } catch (e) { console.error(`fleet  could not read the sortie mirror: ${e.message}`); }
  }
  if (!argv.includes('--no-fleet')) {
    fleet = new Fleet({ post: postReport, log: (l) => console.log(`fleet  ${l}`), speed: Number(opt('fleet-speed', 1)) || 1, mirrorReal: argv.includes('--mirror-real') });
    refreshSorties();
    setInterval(refreshSorties, 30e3);
    setInterval(() => {
      snapshot = fleet.tick(Date.now());
      const msg = `data: ${JSON.stringify(snapshot)}\n\n`;
      for (const s of streams) s.write(msg);
    }, 2000);
    setInterval(() => { for (const s of streams) s.write(': keep-alive\n\n'); }, 20e3);
  }

  async function demo(op) {
    if (!E.CONSOLE_TOKEN) throw new Error('CONSOLE_TOKEN is missing in .env, so WF8 cannot be called');
    const body = op === 'load' ? { op, rows: demoPlan(new Date()) } : { op };
    const r = await fetch(`${N8N}/webhook/airguard-console`, { method: 'POST', body: JSON.stringify(body), signal: AbortSignal.timeout(90e3),
      headers: { 'content-type': 'application/json', 'X-AirGuard-Token': E.CONSOLE_TOKEN } });
    const text = await r.text();
    if (!r.ok) throw new Error(`WF8 answered HTTP ${r.status}`);
    if (fleet) setTimeout(refreshSorties, 1500);
    try { return JSON.parse(text); } catch { return { ok: true }; }
  }

  const config = () => `window.AIRGUARD = ${JSON.stringify({ url: SB, key: E.SUPABASE_ANON_KEY || '', fleet: !!fleet,
    demo: !!(E.CONSOLE_TOKEN && N8N), speed: fleet ? fleet.speed : null })};\n`;

  const server = http.createServer(async (req, res) => {
    const send = (code, type, body) => { res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }); res.end(body); };
    const json = (code, obj) => send(code, 'application/json; charset=utf-8', JSON.stringify(obj));
    if (!allowedHost(req.headers.host, PORT)) return send(421, 'text/plain', 'use http://localhost:' + PORT);
    const { pathname } = new URL(req.url, `http://${req.headers.host}`);
    try {
      if (req.method === 'GET') {
        if (FILES[pathname]) return send(200, FILES[pathname][1], fs.readFileSync(path.join(__dirname, FILES[pathname][0])));
        if (pathname === '/config.js') return send(200, 'text/javascript; charset=utf-8', config());
        if (pathname === '/api/status') return json(200, await status());
        if (pathname === '/api/aircraft') return json(200, await aircraft());
        if (pathname === '/api/fleet') return json(200, snapshot || { drones: [], grounded: [], effects: [], events: [], reports: {} });
        if (pathname === '/api/fleet/stream') {
          res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
          res.write('retry: 3000\n\n');
          if (snapshot) res.write(`data: ${JSON.stringify(snapshot)}\n\n`);
          streams.add(res);
          req.on('close', () => streams.delete(res));
          return undefined;
        }
        return send(404, 'text/plain', 'not found');
      }
      if (req.method !== 'POST') return send(405, 'text/plain', 'method not allowed');
      if (!sameOrigin(req.headers.origin, PORT)) return json(403, { error: 'refused: the request did not come from this console' });
      const body = await readJson(req);
      if (pathname === '/api/sim/effect') {
        if (!fleet) return json(409, { error: 'the simulated fleet is off (--no-fleet)' });
        fleet.setEffect(body.cell_id, body.kind);
        return json(200, { effects: [...fleet.effects].map(([cell_id, e]) => ({ cell_id, ...e })) });
      }
      if (pathname === '/api/demo') {
        if (!['load', 'remove', 'sync'].includes(body.op)) return json(400, { error: 'op must be load, remove or sync' });
        return json(200, await demo(body.op));
      }
      return json(404, { error: 'not found' });
    } catch (e) { return json(500, { error: e.message }); }
  });
  server.listen(PORT, HOST, () => {
    console.log(`AirGuard ops console: http://localhost:${PORT}`);
    console.log(`  fleet ${fleet ? `on (SIMULATED, ${fleet.speed}x${fleet.mirrorReal ? ', mirrors real incidents' : ''})` : 'off'}`
      + ` · demo plan ${E.CONSOLE_TOKEN ? 'on' : 'off (no CONSOLE_TOKEN)'} · drone reports ${E.DRONE_INTAKE_TOKEN ? 'on' : 'off (no DRONE_INTAKE_TOKEN)'}`);
  });
}

if (require.main === module) main();
module.exports = { allowedHost, sameOrigin };
