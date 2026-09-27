// Owner: Krish (see CLAUDE.md)
// demoPlan(now) -> 16 fictional C5 sortie rows (T-301..T-316) along the real eastern-flank borders, for the ops
// console's "Load demo plan" button. Four launched in the last 40 min (the simulated fleet flies them), twelve
// launch over the next 11 h (the gate checks them every cycle). Test ids per C11, unit names say DEMO.
const HOUR = 3600e3, MIN = 60e3;
const WINDOW_MIN = { priority: 60, routine: 360, low: 180 };      // as gen-sorties.js: window_end = launch + this
const AREAS = [
  { unit: 'LT Border Guard · Lazdijai (DEMO)', cells: ['54.0_23.0', '54.0_23.5'] },       // Suwałki gap
  { unit: 'EE Border Guard · Narva (DEMO)', cells: ['59.0_27.5', '59.0_27.0'] },           // Narva river
  { unit: 'LV Border Guard · Latgale (DEMO)', cells: ['56.0_27.5', '56.5_27.5'] },         // Latvia–Russia/Belarus
  { unit: 'LT Border Guard · Pagėgiai (DEMO)', cells: ['55.0_21.5', '55.0_22.0'] },        // Kaliningrad
  { unit: 'LT Border Guard · Šalčininkai (DEMO)', cells: ['54.0_25.0', '54.5_25.0'] },     // Belarus
  { unit: 'PL Border Guard · Podlaskie (DEMO)', cells: ['53.0_23.5', '53.5_23.0'] },       // Poland–Belarus
  { unit: 'LT Border Guard · Ignalina (DEMO)', cells: ['55.0_26.0', '55.5_26.5'] },        // Belarus–Latvia
  { unit: 'EE Border Guard · Värska (DEMO)', cells: ['57.5_27.0', '58.0_27.0'] },          // south of Lake Peipus
];
// [minutes from now, area index, priority, both cells?]
const PLAN = [
  [-35, 0, 'routine', true], [-22, 1, 'priority', true], [-12, 2, 'low', false], [-4, 3, 'routine', true],
  [25, 4, 'priority', true], [50, 0, 'routine', false], [75, 5, 'low', true], [100, 6, 'routine', true],
  [140, 7, 'priority', true], [180, 1, 'routine', false], [240, 3, 'low', true], [300, 2, 'routine', true],
  [360, 0, 'priority', true], [450, 4, 'routine', false], [540, 7, 'low', true], [660, 5, 'routine', true],
];
const iso = (t) => new Date(t).toISOString().replace('.000Z', 'Z');

function demoPlan(now = new Date()) {
  const t0 = Math.floor(now.getTime() / MIN) * MIN;
  return PLAN.map(([m, a, priority, both], i) => {
    const launch = t0 + m * MIN, area = AREAS[a];
    return { sortie_id: `T-${301 + i}`, unit: area.unit, priority, launch_at: iso(launch),
      window_end: iso(launch + WINDOW_MIN[priority] * MIN), cells: (both ? area.cells : area.cells.slice(0, 1)).join(';'),
      status: 'PLANNED', decided_by: '', note: 'DEMO sortie (fictional)' };
  });
}

if (typeof module !== 'undefined') module.exports = { demoPlan, AREAS, HOUR };
