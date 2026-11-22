// Owner: Krish (see CLAUDE.md)
// demoPlan(now) -> 60 fictional C5 sortie rows (T-301..T-360) along the real eastern-flank borders, for the ops
// console's "Load demo plan" button (WF8 takes at most 60). Ten launched in the last 50 min, so the simulated fleet
// flies ten drones at once; fifty launch over the next 11 h, one every 13 min (the gate checks them every cycle).
// Test ids per C11, unit names say DEMO, the notes are the mission. Priorities 1 : 2 : 1 (priority : routine : low).
// The story: a simulated jammer on Lazdijai 54.0_23.5 is felt by T-301's drone, and the gate then reroutes T-312
// (text), asks the officer about priority T-313 (card) and reschedules T-314 (text). 54.0_23.5 is on 5 of the 50: no brake.
const HOUR = 3600e3, MIN = 60e3;
const WINDOW_MIN = { priority: 60, routine: 360, low: 180 };      // as gen-sorties.js: window_end = launch + this
const AREAS = [
  { unit: 'LT Border Guard · Lazdijai (DEMO)', cells: ['54.0_23.0', '54.0_23.5'] },       // 0 Suwałki gap
  { unit: 'EE Border Guard · Narva (DEMO)', cells: ['59.0_27.5', '59.0_27.0'] },           // 1 Narva river
  { unit: 'LV Border Guard · Latgale (DEMO)', cells: ['56.0_27.5', '56.5_27.5'] },         // 2 Latvia–Russia/Belarus
  { unit: 'LT Border Guard · Pagėgiai (DEMO)', cells: ['55.0_21.5', '55.0_22.0'] },        // 3 Kaliningrad
  { unit: 'LT Border Guard · Šalčininkai (DEMO)', cells: ['54.0_25.0', '54.5_25.0'] },     // 4 Belarus
  { unit: 'PL Border Guard · Suwałki (DEMO)', cells: ['54.0_22.5', '53.5_23.0'] },         // 5 Poland: Suwałki gap to Belarus
  { unit: 'LT Border Guard · Ignalina (DEMO)', cells: ['55.0_26.0', '55.5_26.5'] },        // 6 Belarus–Latvia
  { unit: 'EE Border Guard · Värska (DEMO)', cells: ['57.5_27.0', '58.0_27.0'] },          // 7 south of Lake Peipus
  { unit: 'LT Border Guard · Kybartai (DEMO)', cells: ['54.5_22.5', '55.0_22.5'] },        // 8 Kaliningrad
  { unit: 'LT Border Guard · Varėna (DEMO)', cells: ['54.0_24.0', '54.0_24.5'] },          // 9 Belarus
  { unit: 'LT Border Guard · Medininkai (DEMO)', cells: ['54.5_25.5'] },                   // 10 Belarus, east of Vilnius
  { unit: 'LV Border Guard · Zilupe (DEMO)', cells: ['56.0_28.0'] },                       // 11 Latvia–Russia–Belarus
  { unit: 'LV Border Guard · Vientuļi (DEMO)', cells: ['57.0_27.5'] },                     // 12 Latvia–Russia
  { unit: 'EE Border Guard · Koidula (DEMO)', cells: ['57.5_27.5'] },                      // 13 Estonia–Russia
  { unit: 'PL Border Guard · Gołdap (DEMO)', cells: ['54.0_22.0'] },                       // 14 Poland–Kaliningrad
  { unit: 'LT Border Guard · Nida (DEMO)', cells: ['55.0_21.0'] },                         // 15 Curonian Spit
];
// in the air now: [minutes from now, area, priority, cells: both | first | second]
const AIRBORNE = [
  [-48, 0, 'routine', 'both'], [-43, 1, 'priority', 'both'], [-38, 2, 'low', 'both'], [-33, 3, 'routine', 'both'],
  [-28, 4, 'routine', 'both'], [-23, 8, 'priority', 'both'], [-18, 6, 'low', 'both'], [-13, 7, 'routine', 'both'],
  [-8, 10, 'routine', 'both'], [-3, 11, 'low', 'both'],
];
// the rest of the day: one launch every 13 min from +15; the first ones fly where a drone already patrols. Šalčininkai
// (the cell a simulated spoofer hit earlier) comes only after 2 h, Lazdijai 54.0_23.5 stays under a quarter of the plan.
const FIRST = 15, EVERY = 13, SCHEDULED = 50;
const STORY = { 1: [0, 'routine', 'both'], 2: [0, 'priority', 'second'], 3: [0, 'routine', 'second'] };
const ROUND = [1, 8, 3, 5, 9, 12, 2, 6, 13, 7, 14, 4, 10, 11, 15, 0];
const PRIORITY = ['routine', 'low', 'routine', 'priority'];
const PLAN = [...AIRBORNE, ...Array.from({ length: SCHEDULED }, (_, i) => [FIRST + i * EVERY,
  ...(STORY[i] || [ROUND[i % ROUND.length], PRIORITY[i % PRIORITY.length], i % 3 === 0 ? 'first' : 'both'])])];
const PICK = { both: (c) => c, first: (c) => c.slice(0, 1), second: (c) => c.slice(-1) };
// the note column: what the patrol is for, as a unit would write it
const TASKS = {
  priority: ['Movement reported near the border line: find it and keep it in view', 'Support the ground patrol at the crossing point',
    'Search for a missing person reported near the border', 'Cover the checkpoint during the evening vehicle surge'],
  routine: ['Border patrol: fence line and tree line', 'Patrol the river crossing points', 'Sector sweep, report anything unusual',
    'Patrol the forest roads that lead to the border', 'Watch the lake shore and the reed beds', 'Night-to-day handover patrol of the sector'],
  low: ['Survey the new fence section', 'Camera and gimbal check after maintenance', 'Training flight for a new pilot', 'Mapping pass for the sector chart'],
};
const iso = (t) => new Date(t).toISOString().replace('.000Z', 'Z');

function demoPlan(now = new Date()) {
  const t0 = Math.floor(now.getTime() / MIN) * MIN;
  const used = { priority: 0, routine: 0, low: 0 };
  return PLAN.map(([m, a, priority, which], i) => {
    const launch = t0 + m * MIN, area = AREAS[a];
    return { sortie_id: `T-${301 + i}`, unit: area.unit, priority, launch_at: iso(launch),
      window_end: iso(launch + WINDOW_MIN[priority] * MIN), cells: PICK[which](area.cells).join(';'),
      status: 'PLANNED', decided_by: '', note: TASKS[priority][used[priority]++ % TASKS[priority].length] };
  });
}

if (typeof module !== 'undefined') module.exports = { demoPlan, AREAS, HOUR };
