// Owner: Krish (see CLAUDE.md)
// A simulated drone's patrol route and where the drone is on it after d metres. Shared by the fleet (node) and the
// console map (browser), so the map moves each drone along its route between two telemetry updates and draws the
// part it has flown. A route is fixed at takeoff and flown lap after lap: a closed patrol path with banked turns
// (corner-cut twice) that never leaves the sortie's planned cells. One cell: a patrol loop, a figure-eight or a search
// sweep. More cells: a border track, out along one side and back along the other, crossing between two cells that only
// touch at a corner exactly at that corner. The shape comes from a seed (the sortie id): a sortie always flies the same
// path, and two sorties over the same cells fly different ones.
const AG_ROUTE = (() => {
  const CELL_RE = /^-?\d+\.\d_-?\d+\.\d$/;
  const rad = (d) => d * Math.PI / 180;
  const metres = (a, b) => Math.hypot((b[0] - a[0]) * 110540, (b[1] - a[1]) * 111320 * Math.cos(rad((a[0] + b[0]) / 2)));
  const bearing = (a, b) => (Math.atan2((b[1] - a[1]) * Math.cos(rad((a[0] + b[0]) / 2)), b[0] - a[0]) * 180 / Math.PI + 360) % 360;
  const corner = (id) => id.split('_').map(Number);

  function random(seed) {                        // mulberry32, seeded with an FNV-1a hash of the seed
    let a = 2166136261;
    for (const ch of String(seed)) a = Math.imul(a ^ ch.charCodeAt(0), 16777619);
    return () => {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  // a point of cell `id`: u from its west edge (0) to its east edge (1), v from south (0) to north (1), kept 10% inside
  const inside = (x) => Math.min(0.9, Math.max(0.1, x));
  const inCell = (id, u, v) => { const [la, lo] = corner(id); return [la + 0.5 * inside(v), lo + 0.5 * inside(u)]; };

  // one cell: the pattern's waypoints as (u, v)
  const PATTERNS = {
    'patrol loop': (r) => {
      const n = 7 + Math.floor(r() * 3), phase = r() * 2 * Math.PI, turn = r() < 0.5 ? 1 : -1;
      return Array.from({ length: n }, (_, k) => {
        const a = phase + turn * (2 * Math.PI * k / n + (r() - 0.5) * 0.5), m = 0.2 + r() * 0.18;
        return [0.5 + m * Math.cos(a), 0.5 + m * Math.sin(a)];
      });
    },
    'figure-eight': (r) => {                        // two lobes, one each way round, crossing in the middle of the cell
      const axis = r() * Math.PI, out = [];
      for (const side of [1, -1]) {
        const cu = 0.5 + side * 0.2 * Math.cos(axis), cv = 0.5 + side * 0.2 * Math.sin(axis), start = Math.atan2(0.5 - cv, 0.5 - cu);
        out.push([0.5, 0.5]);
        for (let k = 1; k <= 5; k++) {
          const a = start + side * 2 * Math.PI * k / 6, m = 0.15 + r() * 0.07;
          out.push([cu + m * Math.cos(a), cv + m * Math.sin(a)]);
        }
      }
      return out;
    },
    'search sweep': (r) => {                        // a creeping line across the cell, then home along its edge
      const zigs = 5 + Math.floor(r() * 3), across = r() < 0.5, out = [];
      for (let k = 0; k < zigs; k++) out.push([k % 2 ? 0.8 + r() * 0.06 : 0.14 + r() * 0.06, 0.12 + 0.76 * k / (zigs - 1)]);
      const home = zigs % 2 ? 0.92 : 0.08;
      out.push([home, 0.62 + (r() - 0.5) * 0.06], [home, 0.3 + (r() - 0.5) * 0.06]);
      return out.map(([u, v]) => (across ? [u, v] : [v, u]));
    },
  };

  // more cells: out along the left of the track and back along the right, joined cell by cell. Two cells that only
  // touch at a corner are crossed exactly at that corner (a pinned point), so the track never flies over a cell that
  // is not planned.
  function track(ids, r) {
    const c = ids.map(corner), out = [], back = [];
    for (let i = 0; i < ids.length; i++) {
      const j = i < ids.length - 1 ? i + 1 : i - 1, s = i < ids.length - 1 ? 1 : -1;
      const du = Math.sign(c[j][1] - c[i][1]) * s, dv = Math.sign(c[j][0] - c[i][0]) * s, n = Math.hypot(du, dv) || 1;
      const tu = du / n, tv = dv / n, m = 2 + Math.floor(r() * 2);
      const band = (side) => Array.from({ length: m }, (_, k) => {
        const along = -0.3 + 0.6 * k / (m - 1) + (r() - 0.5) * 0.1, off = side * (0.16 + r() * 0.16);
        return inCell(ids[i], 0.5 + tu * along - tv * off, 0.5 + tv * along + tu * off);
      });
      out.push(band(1)); back.push(band(-1).reverse());
    }
    const pin = (i, j) => {                          // the corner two cells share when they touch only there
      const dla = Math.abs(c[i][0] - c[j][0]), dlo = Math.abs(c[i][1] - c[j][1]);
      return dla === 0.5 && dlo === 0.5 ? [Math.max(c[i][0], c[j][0]), Math.max(c[i][1], c[j][1])] : null;
    };
    const pts = [], pins = [];
    const add = (list, pinned = false) => { for (const p of list) { pts.push(p); pins.push(pinned); } };
    for (let i = 0; i < ids.length; i++) { add(out[i]); if (i < ids.length - 1 && pin(i, i + 1)) add([pin(i, i + 1)], true); }
    for (let i = ids.length - 1; i >= 0; i--) { add(back[i]); if (i > 0 && pin(i - 1, i)) add([pin(i - 1, i)], true); }
    return { pts, pins };
  }

  // corner cutting on the closed path, twice: each turn becomes a curve; pinned points stay where they are
  function smooth(pts, pins) {
    const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    for (let n = 0; n < 2; n++) {
      const p = [], q = [];
      for (let i = 0; i < pts.length; i++) {
        const a = pts[(i - 1 + pts.length) % pts.length], b = pts[i], c = pts[(i + 1) % pts.length];
        if (pins[i]) { p.push(b); q.push(true); continue; }
        p.push(mix(a, b, 0.75), mix(b, c, 0.25)); q.push(false, false);
      }
      pts = p; pins = q;
    }
    return pts;
  }

  // routeFor(cells, seed) -> { points: [[lat, lon]...] (a closed path), loop: true, pattern }
  function routeFor(cells, seed = '') {
    const ids = [...new Set(cells.filter((c) => CELL_RE.test(c)))];
    if (!ids.length) return { points: [], loop: true, pattern: null };
    const r = random(`${seed}|${ids.join(';')}`);
    let pts, pins, pattern = 'border track';
    if (ids.length === 1) {
      const names = Object.keys(PATTERNS);
      pattern = names[Math.floor(r() * names.length)];
      pts = PATTERNS[pattern](r).map(([u, v]) => inCell(ids[0], u, v));
      pins = pts.map(() => false);
    } else ({ pts, pins } = track(ids, r));
    return { points: smooth(pts, pins).map(([la, lo]) => [+la.toFixed(5), +lo.toFixed(5)]), loop: true, pattern };
  }

  const cache = new WeakMap();                     // a route's legs, measured once
  function legsOf(points) {
    let c = cache.get(points);
    if (!c) {
      const pts = [...points, points[0]], legs = [];
      for (let i = 0; i < pts.length - 1; i++) legs.push({ a: pts[i], b: pts[i + 1], len: metres(pts[i], pts[i + 1]) });
      c = { legs, len: legs.reduce((s, l) => s + l.len, 0) };
      cache.set(points, c);
    }
    return c;
  }

  // positionAt(route, metres flown) -> { lat, lon, hdg, lap, along, len, leg }: lap counts from 1; along = metres flown
  // on this lap, of len; leg = the stretch of the path the drone is on.
  function positionAt({ points }, d) {
    const { legs, len } = legsOf(points);
    if (!len) return { lat: points[0][0], lon: points[0][1], hdg: 0, lap: 1, along: 0, len: 0, leg: 0 };
    const lap = Math.floor(d / len) + 1, along = d - (lap - 1) * len;
    let u = along;
    for (let i = 0; i < legs.length; i++) {
      const l = legs[i];
      if (u <= l.len || i === legs.length - 1) {
        const f = l.len ? Math.min(1, u / l.len) : 0;
        return { lat: l.a[0] + (l.b[0] - l.a[0]) * f, lon: l.a[1] + (l.b[1] - l.a[1]) * f, hdg: bearing(l.a, l.b), lap, along, len, leg: i };
      }
      u -= l.len;
    }
    return null;
  }

  // flownPath(route, metres flown) -> [[lat, lon]...]: this lap so far, from its first point to the drone
  function flownPath(route, d) {
    const p = positionAt(route, d);
    return [...[...route.points, route.points[0]].slice(0, p.leg + 1), [p.lat, p.lon]];
  }

  return { CELL_RE, routeFor, positionAt, flownPath };
})();
if (typeof module !== 'undefined') module.exports = AG_ROUTE;
