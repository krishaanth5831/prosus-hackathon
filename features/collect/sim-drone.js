#!/usr/bin/env node
// Owner: Krish (see CLAUDE.md)
// Simulated border-patrol drone. Builds a C12 report with MAVLink field names (GPS_RAW_INT fix_type,
// satellites_visible, h_acc in mm, plus the PX4 SensorGps jamming_state / spoofing_state flags) and can POST it to WF7.
// Every report it makes has source "sim:border-patrol-mavlink", so AirGuard shows it as SIMULATED.
//
// usage: node features/collect/sim-drone.js --sortie T-101 --drone BG-UAV-07 \
//          --leg 89.5_178.5=jammed --leg 89.5_178.0=spoofed --leg 89.5_177.5=normal [--minutes 10] [--seed 7] [--post]
// Without --post it prints the report. --post sends it to $N8N_BASE_URL/webhook/airguard-drone with the
// X-AirGuard-Token header from $DRONE_INTAKE_TOKEN (both read from .env if not in the environment).
const fs = require('node:fs');
const path = require('node:path');

const SOURCE = 'sim:border-patrol-mavlink';
const SCENARIOS = ['normal', 'jammed', 'spoofed'];

function rng(seed) {                                    // mulberry32: same seed, same flight
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// simulate({ sortie, drone, legs: [{cell_id, scenario}], minutes per leg, every s, end ms, seed }) -> C12 report
function simulate({ sortie, drone, legs, minutes = 10, every = 5, end = Date.now(), seed = 1 }) {
  const r = rng(seed), between = (a, b) => a + (b - a) * r(), int = (a, b) => Math.floor(between(a, b + 1));
  const legMs = minutes * 60e3, start = Math.floor(end / 1000) * 1000 - legs.length * legMs;
  const report = { source: SOURCE, drone_id: drone, sortie_id: sortie, legs: [], samples: [] };
  legs.forEach(({ cell_id, scenario }, i) => {
    if (!SCENARIOS.includes(scenario)) throw new Error(`scenario "${scenario}": use ${SCENARIOS.join(', ')}`);
    const from = start + i * legMs, to = from + legMs;
    report.legs.push({ cell_id, from: new Date(from).toISOString(), to: new Date(to).toISOString() });
    const [lat0, lon0] = cell_id.split('_').map(Number);
    for (let t = from + every * 1000, k = 0; t <= to; t += every * 1000, k++) {
      const onset = k >= 12;                             // the first minute of every leg looks normal
      const s = { t: new Date(t).toISOString(), fix_type: 3, satellites_visible: int(11, 16), h_acc: int(900, 2500),
        jamming_state: 1, spoofing_state: 1, lat: +(lat0 + 0.25 + between(-0.1, 0.1)).toFixed(6),
        lon: +(lon0 + 0.25 + between(-0.1, 0.1)).toFixed(6) };
      if (scenario === 'jammed' && onset && r() < 0.8) {
        Object.assign(s, { fix_type: int(0, 2), satellites_visible: int(0, 5), h_acc: int(12000, 80000), jamming_state: r() < 0.7 ? 3 : 2 });
      }
      if (scenario === 'spoofed' && onset && r() < 0.6) {  // a spoofer hands out a confident fix somewhere else
        Object.assign(s, { h_acc: int(500, 1200), spoofing_state: r() < 0.8 ? 2 : 3, lat: +(s.lat - 0.6).toFixed(6), lon: +(s.lon - 0.9).toFixed(6) });
      }
      report.samples.push(s);
    }
  });
  return report;
}

function envValue(name) {
  if (process.env[name]) return process.env[name];
  const file = path.join(__dirname, '../../.env');
  const line = fs.existsSync(file) && fs.readFileSync(file, 'utf8').split(/\r?\n/).find((l) => l.startsWith(`${name}=`));
  if (!line) throw new Error(`set ${name} or put it in .env`);
  return line.slice(name.length + 1).trim().replace(/^(['"])(.*)\1$/, '$2');
}

async function main(argv) {
  const opt = (flag) => argv.flatMap((a, i) => (a === flag ? [argv[i + 1]] : []));
  const legs = opt('--leg').map((l) => { const [cell_id, scenario] = l.split('='); return { cell_id, scenario }; });
  if (!legs.length) throw new Error('give at least one --leg <cell_id>=<normal|jammed|spoofed>');
  const report = simulate({ sortie: opt('--sortie')[0] ?? 'T-101', drone: opt('--drone')[0] ?? 'BG-UAV-07', legs,
    minutes: Number(opt('--minutes')[0] ?? 10), seed: Number(opt('--seed')[0] ?? 1) });
  if (!argv.includes('--post')) return console.log(JSON.stringify(report, null, 2));
  const url = `${envValue('N8N_BASE_URL').replace(/\/$/, '')}/webhook/airguard-drone`;
  const res = await fetch(url, { method: 'POST', body: JSON.stringify(report),
    headers: { 'content-type': 'application/json', 'X-AirGuard-Token': envValue('DRONE_INTAKE_TOKEN') } });
  console.log(`POST /webhook/airguard-drone: HTTP ${res.status} · ${report.sortie_id} · ${report.samples.length} samples · `
    + legs.map((l) => `${l.cell_id}=${l.scenario}`).join(' '));
  if (!res.ok) process.exitCode = 1;
}

if (require.main === module) main(process.argv.slice(2)).catch((e) => { console.error(e.message); process.exit(1); });
module.exports = { simulate, SOURCE };
