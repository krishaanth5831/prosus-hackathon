// Owner: Krish (see CLAUDE.md)
// A simulated drone's patrol route and where the drone is on it after d metres. Shared by the fleet (node) and the
// console map (browser), so the map moves each drone along its route between two telemetry updates and draws the
// part it has flown. A route is fixed at takeoff: a box inside a single cell, lap after lap, else a line through the
// cell centres, out and back.
const AG_ROUTE = (() => {
  const CELL_RE = /^-?\d+\.\d_-?\d+\.\d$/;
  const rad = (d) => d * Math.PI / 180;
  const metres = (a, b) => Math.hypot((b[0] - a[0]) * 110540, (b[1] - a[1]) * 111320 * Math.cos(rad((a[0] + b[0]) / 2)));
  const bearing = (a, b) => (Math.atan2((b[1] - a[1]) * Math.cos(rad((a[0] + b[0]) / 2)), b[0] - a[0]) * 180 / Math.PI + 360) % 360;
  const corner = (id) => id.split('_').map(Number);

  // routeFor(cells) -> { points: [[lat, lon]...], loop }: a box inside a single cell, else a line through the cell centres
  function routeFor(cells) {
    const ids = [...new Set(cells.filter((c) => CELL_RE.test(c)))];
    if (!ids.length) return { points: [], loop: false };
    if (ids.length === 1) {
      const [la, lo] = corner(ids[0]);
      return { points: [[la + 0.12, lo + 0.1], [la + 0.12, lo + 0.4], [la + 0.38, lo + 0.4], [la + 0.38, lo + 0.1]], loop: true };
    }
    return { points: ids.map((c) => { const [la, lo] = corner(c); return [la + 0.25, lo + 0.25]; }), loop: false };
  }

  // positionAt(route, metres flown) -> { lat, lon, hdg, pass, back, along, len, leg }
  // pass counts laps of the box, or one-way passes along the line, from 1; along = metres flown on this pass, of len;
  // leg = the route segment the drone is on.
  function positionAt({ points, loop }, d) {
    const pts = loop ? [...points, points[0]] : points, legs = [];
    for (let i = 0; i < pts.length - 1; i++) legs.push({ a: pts[i], b: pts[i + 1], len: metres(pts[i], pts[i + 1]) });
    const len = legs.reduce((s, l) => s + l.len, 0);
    if (!len) return { lat: pts[0][0], lon: pts[0][1], hdg: 0, pass: 1, back: false, along: 0, len: 0, leg: 0 };
    const pass = Math.floor(d / len) + 1, back = !loop && pass % 2 === 0, along = d - (pass - 1) * len;
    let u = back ? len - along : along;                  // on the way back: the same points, the other heading
    for (let i = 0; i < legs.length; i++) {
      const l = legs[i];
      if (u <= l.len || i === legs.length - 1) {
        const f = l.len ? Math.min(1, u / l.len) : 0, hdg = bearing(l.a, l.b);
        return { lat: l.a[0] + (l.b[0] - l.a[0]) * f, lon: l.a[1] + (l.b[1] - l.a[1]) * f, hdg: back ? (hdg + 180) % 360 : hdg, pass, back, along, len, leg: i };
      }
      u -= l.len;
    }
    return null;
  }

  // flownPath(route, metres flown) -> [[lat, lon]...]: this pass so far, from where it began to the drone
  function flownPath(route, d) {
    const p = positionAt(route, d), pts = route.loop ? [...route.points, route.points[0]] : route.points;
    return [...(p.back ? pts.slice(p.leg + 1).reverse() : pts.slice(0, p.leg + 1)), [p.lat, p.lon]];
  }

  return { CELL_RE, routeFor, positionAt, flownPath };
})();
if (typeof module !== 'undefined') module.exports = AG_ROUTE;
