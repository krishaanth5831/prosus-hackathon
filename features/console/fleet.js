// Owner: Krish (see CLAUDE.md)
// Simulated border-patrol fleet for the ops console. ALL OF ITS DATA IS SIMULATED.
// It plays the unit's ground station: when a sortie's launch time comes and the sheet (plus the gate's latest
// decision) still lets it fly, a drone takes off and patrols the sortie's planned cells. HOLD and CANCELLED sorties
// stay on the ground. Telemetry uses MAVLink GPS_RAW_INT / PX4 SensorGps field names. Like a real ground station,
// the fleet sends C12 leg reports to WF7, so everything after that is the real pipeline.
// GNSS degrades only in cells where the user placed a simulated jammer or spoofer (and, if mirrorReal is on,
// in cells with a live incident). Real aircraft data never turns into simulated drone evidence by default.
const { droneReport } = require('../collect/droneReport.js');

const SPEED = 25;                 // m/s cruise
const FLIGHT_MIN = 60;            // a patrol lasts 60 min
const REPORT_MIN = 15;            // a leg report at least every 15 min (every report is an n8n execution)
const EARLY_SAMPLES = 15;         // a bad spell is reported after 15 samples (30 s at one sample per 2 s)
const MIN_GAP_MIN = 5;            // at most one report per drone every 5 min, except the first of a new bad spell
const SPELL_COOLDOWN_MIN = 10;    // ... and that one at most every 10 min per cell (a fast drone crosses it again and again)
const FLYABLE = ['PLANNED', 'RESCHEDULED', 'LAUNCH_APPROVED'];
const KEPT_DOWN = ['HOLD', 'CANCELLED'];
const SOURCE = 'sim:border-patrol-mavlink';
const POOL = Array.from({ length: 16 }, (_, i) => `BG-UAV-${String(i + 1).padStart(2, '0')}`);
const CELL_RE = /^-?\d+\.\d_-?\d+\.\d$/;

const cellId = (lat, lon) => `${(Math.floor(lat / 0.5) * 0.5).toFixed(1)}_${(Math.floor(lon / 0.5) * 0.5).toFixed(1)}`;
const corner = (id) => id.split('_').map(Number);
const rad = (d) => d * Math.PI / 180;
const metres = (a, b) => Math.hypot((b[0] - a[0]) * 110540, (b[1] - a[1]) * 111320 * Math.cos(rad((a[0] + b[0]) / 2)));
const bearing = (a, b) => (Math.atan2((b[1] - a[1]) * Math.cos(rad((a[0] + b[0]) / 2)), b[0] - a[0]) * 180 / Math.PI + 360) % 360;
const isoZ = (t) => new Date(t).toISOString().replace('.000Z', 'Z');

// routeFor(cells) -> { points: [[lat, lon]...], loop }: a box inside a single cell, else a line through the cell centres
function routeFor(cells) {
  const ids = cells.filter((c) => CELL_RE.test(c));
  if (!ids.length) return { points: [], loop: false };
  if (ids.length === 1) {
    const [la, lo] = corner(ids[0]);
    return { points: [[la + 0.12, lo + 0.1], [la + 0.12, lo + 0.4], [la + 0.38, lo + 0.4], [la + 0.38, lo + 0.1]], loop: true };
  }
  return { points: ids.map((c) => { const [la, lo] = corner(c); return [la + 0.25, lo + 0.25]; }), loop: false };
}

// positionAt(route, metres flown) -> { lat, lon, hdg }: loops a box, goes back and forth along a line
function positionAt({ points, loop }, d) {
  const pts = loop ? [...points, points[0]] : points;
  const legs = [];
  for (let i = 0; i < pts.length - 1; i++) legs.push({ a: pts[i], b: pts[i + 1], len: metres(pts[i], pts[i + 1]) });
  const total = legs.reduce((s, l) => s + l.len, 0);
  if (!total) return { lat: pts[0][0], lon: pts[0][1], hdg: 0 };
  let u = loop ? d % total : d % (2 * total), back = false;
  if (!loop && u > total) { u = 2 * total - u; back = true; }       // on the way back: same point, opposite heading
  for (const l of legs) {
    if (u <= l.len) {
      const f = u / l.len, hdg = bearing(l.a, l.b);
      return { lat: l.a[0] + (l.b[0] - l.a[0]) * f, lon: l.a[1] + (l.b[1] - l.a[1]) * f, hdg: back ? (hdg + 180) % 360 : hdg };
    }
    u -= l.len;
  }
  const last = pts[pts.length - 1];
  return { lat: last[0], lon: last[1], hdg: 0 };
}

// gnss(environment, rng) -> one GNSS health sample (h_acc in metres here, mm in the C12 report)
function gnss(env, rng) {
  const r = (a, b) => a + (b - a) * rng(), i = (a, b) => Math.floor(r(a, b + 1));
  if (env === 'JAMMED' && rng() < 0.8) return { fix_type: i(0, 2), satellites_visible: i(0, 5), h_acc: r(15, 80), jamming_state: rng() < 0.7 ? 3 : 2, spoofing_state: 1, gap: r(5, 40) };
  if (env === 'SPOOF' && rng() < 0.65) return { fix_type: 3, satellites_visible: i(12, 16), h_acc: r(0.5, 1.2), jamming_state: 1, spoofing_state: rng() < 0.8 ? 2 : 3, gap: r(300, 900) };
  return { fix_type: 3, satellites_visible: i(11, 17), h_acc: r(0.8, 2.6), jamming_state: 1, spoofing_state: 1, gap: r(1, 8) };
}

// airborne(sorties, now) -> the board rows that fly now: launch passed less than FLIGHT_MIN ago and still allowed to fly
const inWindow = (s, now) => { const t = Date.parse(s.launch_at); return Number.isFinite(t) && t <= now && now < t + FLIGHT_MIN * 60e3; };
const airborne = (sorties, now) => sorties.filter((s) => FLYABLE.includes(s.status) && inWindow(s, now) && routeFor(s.cellList || []).points.length);
const keptDown = (sorties, now) => sorties.filter((s) => KEPT_DOWN.includes(s.status) && inWindow(s, now));

class Fleet {
  // post(report) -> Promise: sends a C12 report to WF7. speed multiplies the cruise speed (1 = real time).
  constructor({ post, log = () => {}, rng = Math.random, speed = 1, mirrorReal = false } = {}) {
    Object.assign(this, { post, log, rng, speed, mirrorReal });
    this.sorties = []; this.effects = new Map(); this.realBad = new Map(); this.flights = new Map();
    this.events = []; this.reports = { sent: 0, failed: 0, last: null };
  }
  setSorties(rows) { this.sorties = rows; }
  setRealBad(cells) { this.realBad = new Map(cells.map((c) => [c.cell_id, c.state])); }
  setEffect(cell, kind) {
    if (!CELL_RE.test(cell || '')) throw new Error('cell_id must look like 54.0_23.0');
    if (kind === 'jam' || kind === 'spoof') this.effects.set(cell, { kind, since: isoZ(Date.now()) });
    else this.effects.delete(cell);
    this.event(null, `SIMULATION ${kind === 'jam' ? 'JAMMER ON' : kind === 'spoof' ? 'SPOOFER ON' : 'EFFECT OFF'} ${cell}`, 'set from the ops console');
  }
  environment(cell) {
    const e = this.effects.get(cell);
    if (e) return e.kind === 'jam' ? 'JAMMED' : 'SPOOF';
    if (this.mirrorReal && ['JAMMED', 'SPOOF'].includes(this.realBad.get(cell))) return this.realBad.get(cell);
    return 'NORMAL';
  }
  event(f, action, detail, now = Date.now()) {
    const e = { t: isoZ(now), drone_id: f ? f.drone_id : null, sortie_id: f ? f.sortie_id : null, action, detail };
    if (f) { f.events.unshift(e); f.events.length = Math.min(f.events.length, 30); }
    this.events.unshift(e); this.events.length = Math.min(this.events.length, 100);
    this.log(`${e.t} ${action}${detail ? ` · ${detail}` : ''}`);
  }
  // tick(now) -> snapshot for the console; call every 2 s
  tick(now = Date.now()) {
    const up = airborne(this.sorties, now), ids = new Set(up.map((s) => s.sortie_id));
    for (const [id, f] of this.flights) if (!ids.has(id)) { this.flush(f, 'landed', now); this.event(f, `LANDED ${f.drone_id}`, `sortie ${id}`, now); this.flights.delete(id); }
    for (const s of up) if (!this.flights.has(s.sortie_id)) {
      const used = new Set([...this.flights.values()].map((f) => f.drone_id));
      const start = [...s.sortie_id].reduce((h, c) => h * 31 + c.charCodeAt(0), 7) % POOL.length;
      const drone = [...POOL.slice(start), ...POOL.slice(0, start)].find((d) => !used.has(d)) || `BG-UAV-X${this.flights.size}`;
      const f = { sortie_id: s.sortie_id, drone_id: drone, unit: s.unit, priority: s.priority, launch: Date.parse(s.launch_at),
        route: routeFor(s.cellList), events: [], seg: null, env: 'NORMAL', spell: null, spells: new Map(), lastReport: null };
      this.flights.set(s.sortie_id, f);
      this.event(f, `TAKEOFF ${drone}`, `sortie ${s.sortie_id} · ${s.priority} · ${s.cellList.join(', ')}`, now);
    }
    const drones = [];
    for (const f of this.flights.values()) drones.push(this.fly(f, now));
    return { t: isoZ(now), source: SOURCE, speed: this.speed, drones,
      grounded: keptDown(this.sorties, now).map((s) => ({ sortie_id: s.sortie_id, status: s.status, launch_at: s.launch_at, unit: s.unit, cells: s.cellList })),
      effects: [...this.effects].map(([cell_id, e]) => ({ cell_id, ...e })), reports: this.reports, events: this.events.slice(0, 40) };
  }
  fly(f, now) {
    const elapsed = now - f.launch, pos = positionAt(f.route, SPEED * this.speed * elapsed / 1000);
    const cell = cellId(pos.lat, pos.lon), env = this.environment(cell), g = gnss(env, this.rng);
    const bad = g.fix_type < 3 || g.h_acc > 10 || g.jamming_state >= 2, spoofed = g.spoofing_state >= 2;
    const ghost = spoofed ? [pos.lat - 0.3, pos.lon + 0.45] : null;       // where the spoofed receiver claims to be
    const nav = bad ? 'INS + optical flow' : spoofed ? 'INS (GNSS rejected)' : 'GNSS';
    if (env !== f.env) {
      if (env === 'JAMMED') this.event(f, `GNSS DEGRADED ${f.drone_id}`, `entered ${cell}: ${g.satellites_visible} sats, h_acc ${g.h_acc.toFixed(0)} m, jamming flag ${g.jamming_state === 3 ? 'CRITICAL' : 'WARNING'} → EKF rejected GNSS, flying on INS + optical flow`, now);
      else if (env === 'SPOOF') this.event(f, `GNSS SPOOF SUSPECTED ${f.drone_id}`, `entered ${cell}: confident fix but GNSS/INS gap ${g.gap.toFixed(0)} m → GNSS rejected, holding course on INS`, now);
      else this.event(f, `GNSS RESTORED ${f.drone_id}`, `in ${cell}: ${g.satellites_visible} sats, h_acc ${g.h_acc.toFixed(1)} m`, now);
      f.env = env;
    }
    // C12 samples, placed by the leg (planned cell) they were taken in, never by the GNSS position
    if (!f.seg || f.seg.cell !== cell) { if (f.seg) this.flush(f, 'left the cell', now); f.seg = { cell, samples: [] }; }
    f.seg.samples.push({ t: isoZ(now), fix_type: g.fix_type, satellites_visible: g.satellites_visible, h_acc: Math.round(g.h_acc * 1000),
      jamming_state: g.jamming_state, spoofing_state: g.spoofing_state, lat: +(ghost ? ghost[0] : pos.lat).toFixed(6), lon: +(ghost ? ghost[1] : pos.lon).toFixed(6) });
    const spell = env === 'NORMAL' ? null : `${cell}|${env}`;
    const cooled = spell && !(now - (f.spells.get(spell) || -Infinity) < SPELL_COOLDOWN_MIN * 60e3);
    if (spell && f.spell !== spell && cooled && f.seg.samples.length >= EARLY_SAMPLES) {
      f.spell = spell; f.spells.set(spell, now); this.flush(f, 'bad GNSS, reported early', now, true); f.seg = { cell, samples: [] };
    }
    else if (Date.parse(f.seg.samples[0].t) <= now - REPORT_MIN * 60e3) { this.flush(f, 'periodic', now); f.seg = { cell, samples: [] }; }
    if (!spell) f.spell = null;
    const mins = elapsed / 60e3;
    return { drone_id: f.drone_id, sortie_id: f.sortie_id, unit: f.unit, priority: f.priority, lat: +pos.lat.toFixed(5), lon: +pos.lon.toFixed(5),
      alt: Math.round(180 + 60 * Math.sin(elapsed / 90e3)), spd: +(SPEED + Math.sin(elapsed / 20e3)).toFixed(1), hdg: Math.round(pos.hdg),
      batt: Math.max(20, Math.round(100 - 70 * mins / FLIGHT_MIN)), rssi: Math.round(-52 - 12 * Math.abs(Math.sin(elapsed / 300e3)) - this.rng() * 4),
      fix_type: g.fix_type, sats: g.satellites_visible, h_acc: +g.h_acc.toFixed(1), jam: g.jamming_state, spoof: g.spoofing_state,
      gap: Math.round(g.gap), nav, cell, env, ghost, airborne_min: Math.floor(mins), route: f.route, events: f.events.slice(0, 20) };
  }
  // flush: send the leg segment as a C12 report (droneReport is what WF7 runs; used here only to name the verdict)
  flush(f, why, now, urgent = false) {
    const seg = f.seg;
    if (!seg || seg.samples.length < 10) return;
    if (!urgent && f.lastReport !== null && now - f.lastReport < MIN_GAP_MIN * 60e3) return;   // every report is an n8n execution
    f.lastReport = now;
    const report = { source: SOURCE, drone_id: f.drone_id, sortie_id: f.sortie_id,
      legs: [{ cell_id: seg.cell, from: seg.samples[0].t, to: seg.samples[seg.samples.length - 1].t }], samples: seg.samples };
    const r = droneReport(report, now), row = r.ok ? r.rows[0] : null;
    const what = row ? `${seg.cell} ${row.verdict} ${row.n_degraded}/${row.n_samples}` : seg.cell;
    this.event(f, `REPORT → WF7 ${f.sortie_id}`, `${what} (${why})`, now);
    Promise.resolve(this.post(report)).then(() => { this.reports.sent++; this.reports.last = { t: isoZ(Date.now()), what }; },
      (e) => { this.reports.failed++; this.log(`report ${f.sortie_id} failed: ${e.message}`); });
  }
}

module.exports = { Fleet, routeFor, positionAt, gnss, airborne, keptDown, cellId, SOURCE, FLIGHT_MIN };
