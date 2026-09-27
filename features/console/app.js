// Owner: Krish (see CLAUDE.md)
// AirGuard ops console, browser side. Reads Supabase live with the anon key (select-only by RLS): cell_status,
// incidents, agent_log, decisions, the sortie mirror and drone_reports, pushed by Supabase Realtime. Pipeline health
// comes from the local server (/api/status: n8n, Apify, Telegram) and the simulated fleet from /api/fleet/stream.
// Times are shown in CEST (Europe/Amsterdam) with the UTC time in the hover title; the data itself stays UTC.
(() => {
  const CFG = window.AIRGUARD || {};
  const TZ = 'Europe/Amsterdam';
  const SHOW_TEST = new URLSearchParams(location.search).has('test');     // C11 test cells (89.5_*) stay hidden
  const TABLES = ['agent_log', 'incidents', 'decisions', 'drone_reports', 'observations', 'sorties', 'sheet_sync'];
  const LEVEL = { L1_RESCHEDULE: 'RESCHEDULED +2 h', L2_CANCEL: 'CANCELLED', L3_HOLD: 'HOLD', L4_SPOOF_HOLD: 'HOLD · SPOOFING',
    BRAKE_HOLD: 'HOLD · BRAKE', UNVERIFIED: 'UNVERIFIED', WATCH: 'WATCH' };
  const STATE_LABEL = { JAMMED: 'JAMMED', SPOOF: 'SPOOF', UNKNOWN: 'UNKNOWN', NO_KNOWN_ISSUE: 'NO KNOWN ISSUE' };

  // ---------- helpers ----------
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const dtf = (o) => new Intl.DateTimeFormat('en-GB', { timeZone: TZ, ...o });
  const HM = dtf({ hour: '2-digit', minute: '2-digit' }), HMS = dtf({ hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const DAY = dtf({ day: 'numeric', month: 'short' });
  const zone = (d) => dtf({ timeZoneName: 'short' }).formatToParts(d).find((p) => p.type === 'timeZoneName').value;
  const ms = (t) => (t instanceof Date ? t.getTime() : typeof t === 'number' ? t : Date.parse(t));
  const utc = (t) => new Date(ms(t)).toISOString().replace('.000Z', 'Z');
  const tm = (t, sec = false) => {
    if (!t || !Number.isFinite(ms(t))) return '–';
    const d = new Date(ms(t)), day = DAY.format(d) === DAY.format(new Date()) ? '' : `${DAY.format(d)} `;
    return `<time datetime="${utc(d)}" title="${utc(d)} UTC">${day}${(sec ? HMS : HM).format(d)}</time>`;
  };
  const rel = (t) => {
    const m = Math.round((ms(t) - Date.now()) / 60e3);
    if (!Number.isFinite(m)) return '';
    const a = Math.abs(m), s = a < 60 ? `${a} min` : `${Math.floor(a / 60)} h ${a % 60} min`;
    return m === 0 ? 'now' : m > 0 ? `in ${s}` : `${s} ago`;
  };
  const isTest = (id) => /^89\.5_/.test(String(id || ''));
  const cellOf = (lat, lon) => `${(Math.floor(lat / 0.5) * 0.5).toFixed(1)}_${(Math.floor(lon / 0.5) * 0.5).toFixed(1)}`;
  const bounds = (id) => { const [la, lo] = id.split('_').map(Number); return [[la, lo], [la + 0.5, lo + 0.5]]; };
  const debounce = (fn, wait) => { let t = null; return () => { clearTimeout(t); t = setTimeout(fn, wait); }; };
  const fixName = (f) => ['NO GPS', 'NO FIX', '2D FIX', '3D FIX'][f] || `FIX ${f}`;
  const jamName = (j) => ['UNKNOWN', 'OK', 'WARNING', 'CRITICAL'][j] || String(j);
  const spoofName = (s) => ['UNKNOWN', 'NONE', 'INDICATED', 'MULTIPLE'][s] || String(s);

  function toast(kind, title, text) {
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    el.innerHTML = `<b>${esc(title)}</b>${text ? `<p>${esc(text)}</p>` : ''}`;
    const box = $('#toasts');
    box.prepend(el);
    while (box.children.length > 4) box.lastChild.remove();
    setTimeout(() => el.remove(), 9000);
  }
  let bannerEl = null;
  function banner(text) {
    if (!text) { if (bannerEl) bannerEl.remove(); bannerEl = null; return; }
    if (!bannerEl) { bannerEl = document.createElement('div'); bannerEl.className = 'banner'; $('#v-live').appendChild(bannerEl); }
    bannerEl.textContent = text;
  }
  function spark(cv, data, color, o = {}) {
    if (!cv || data.length < 2) return;
    const dpr = devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
    if (!w) return;
    cv.width = w * dpr; cv.height = h * dpr;
    const c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0);
    const min = o.min ?? Math.min(...data), max = o.max ?? Math.max(...data), sp = max - min || 1;
    const pts = data.map((v, i) => [i / (data.length - 1) * w, h - 2 - ((v - min) / sp) * (h - 4)]);
    c.beginPath(); pts.forEach(([x, y], i) => c[i ? 'lineTo' : 'moveTo'](x, y)); c.lineTo(w, h); c.lineTo(0, h); c.closePath();
    const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, `${color}55`); g.addColorStop(1, `${color}00`); c.fillStyle = g; c.fill();
    c.beginPath(); pts.forEach(([x, y], i) => c[i ? 'lineTo' : 'moveTo'](x, y)); c.strokeStyle = color; c.lineWidth = 1.4; c.stroke();
    const [ex, ey] = pts[pts.length - 1]; c.fillStyle = color; c.beginPath(); c.arc(ex - 1.5, ey, 2.4, 0, 7); c.fill();
  }

  // ---------- state ----------
  const S = { cells: new Map(), incidents: new Map(), log: [], decisions: new Map(), sorties: new Map(), sync: null, reports: [],
    fleet: null, status: null, air: null, obsHour: null, rt: 'CONNECTING', view: 'live', sel: null, tab: 'tel', filter: 'all',
    hist: new Map(), trails: new Map(), seenEvents: new Set(), lastRuns: {}, confirm: null, newLogId: null };
  const rows = () => window.boardRows([...S.sorties.values()], [...S.decisions.values()], S.sync && S.sync.synced_at);

  // ---------- map: the console's own drawing of the eastern flank (geo.js), locked to that region ----------
  // A flat projection like the design (x = lon · cos 57°, y = lat) and no tile server. You can zoom in, never out.
  const GEO = AG_GEO, RG = GEO.REGION;
  const CRS = L.extend({}, L.CRS.Simple, { transformation: new L.Transformation(Math.cos(57 * Math.PI / 180), 0, -1, 0) });
  const REGION = L.latLngBounds([RG.lat0, RG.lon0], [RG.lat1, RG.lon1]);
  const map = L.map('map', { crs: CRS, zoomControl: false, zoomSnap: 0.1, zoomDelta: 0.5, wheelPxPerZoomLevel: 120,
    maxBounds: REGION, maxBoundsViscosity: 1, inertia: false });
  map.attributionControl.setPrefix(false).addAttribution('Outlines approximate · ADS-B: adsb.lol / adsb.fi');
  let fitted = false;
  function lockRegion() {                         // zoomed all the way out = the whole region; only zooming in is allowed
    const z = map.getBoundsZoom(REGION, false, L.point(16, 16));
    map.setMinZoom(z); map.setMaxZoom(z + 4);
    if (!fitted || map.getZoom() < z) { map.fitBounds(REGION, { padding: [8, 8], animate: false }); fitted = true; }
  }
  lockRegion();
  map.on('resize', lockRegion);
  L.control.zoom({ position: 'bottomright' }).addTo(map);
  map.createPane('base').style.zIndex = 250;
  map.getPane('base').style.pointerEvents = 'none';
  map.createPane('air').style.zIndex = 380;
  const flip = ([lon, lat]) => [lat, lon];
  const off = { pane: 'base', interactive: false };
  for (let la = RG.lat0 + 0.5; la < RG.lat1; la += 0.5) L.polyline([[la, RG.lon0], [la, RG.lon1]], { ...off, color: '#a0b4c8', weight: 1, opacity: la % 1 ? 0.035 : 0.07 }).addTo(map);
  for (let lo = Math.ceil(RG.lon0 * 2) / 2; lo < RG.lon1; lo += 0.5) L.polyline([[RG.lat0, lo], [RG.lat1, lo]], { ...off, color: '#a0b4c8', weight: 1, opacity: lo % 1 ? 0.035 : 0.07 }).addTo(map);
  for (const line of GEO.COAST) L.polyline(line.map(flip), { ...off, color: '#3a4b5a', weight: 1.2 }).addTo(map);
  for (const [line, hostile] of GEO.BORDERS) L.polyline(line.map(flip), { ...off, color: hostile ? '#6b7a88' : '#2c3a47', weight: hostile ? 1.6 : 1, dashArray: hostile ? null : '4 4' }).addTo(map);
  for (const l of GEO.LABELS) {
    L.marker([l.lat, l.lon], { ...off, keyboard: false, icon: L.divIcon({ className: `geo-lbl${l.sea ? ' sea' : ''}`, html: esc(l.t), iconSize: [170, 14], iconAnchor: [85, 7] }) }).addTo(map);
  }
  const G = { air: L.layerGroup().addTo(map), cells: L.layerGroup().addTo(map), effects: L.layerGroup().addTo(map), sel: L.layerGroup().addTo(map),
    trails: L.layerGroup().addTo(map), drones: L.layerGroup().addTo(map) };
  map.on('click', (e) => { if (REGION.contains(e.latlng)) openCell(cellOf(e.latlng.lat, e.latlng.lng), e.latlng); });

  // the ADS-B sensor network at the last collect (real aircraft, from the newest Apify run)
  function drawAircraft() {
    G.air.clearLayers();
    for (const a of (S.air && S.air.aircraft) || []) {
      if (!REGION.contains([a.lat, a.lon])) continue;
      const col = a.spoof ? '#a58bff' : a.degraded ? '#ff8a7a' : '#aabed2';
      L.circleMarker([a.lat, a.lon], { pane: 'air', radius: a.sensor ? 2.2 : 1.5, stroke: false, fillColor: col, fillOpacity: a.degraded || a.spoof ? 0.95 : 0.55, bubblingMouseEvents: false })
        .bindTooltip(`${esc(a.flight || 'aircraft')} · ${a.alt ?? '–'} ft${a.degraded ? ' · GNSS degraded' : ''}${a.spoof ? ' · GPS/baro gap > 1500 ft' : ''}${a.sensor ? '' : ' · no NIC/NACp, not a sensor'}`, { direction: 'top', offset: [0, -4] })
        .addTo(G.air);
    }
  }

  const shapes = new Map();
  function cellLook(c) {
    if (c.state === 'JAMMED') return { cls: 'jam', color: '#ff5d5d', o: { color: '#ff5d5d', weight: 1.2, opacity: 0.9, fillColor: '#ff5d5d', fillOpacity: c.severity === 'high' ? 0.34 : 0.22 } };
    if (c.state === 'SPOOF') return { cls: 'spoof', color: '#a58bff', o: { color: '#a58bff', weight: 1.2, opacity: 0.9, fillColor: '#a58bff', fillOpacity: 0.3 } };
    if (c.state === 'UNKNOWN') return { cls: 'unk', o: { stroke: false, fillOpacity: 1 } };
    const drone = (c.n_total ?? 0) < 3 && !!c.drone_evidence;
    return { cls: drone ? 'nki drone' : 'nki', o: { color: drone ? '#4fd1e0' : '#a0b4c8', weight: 1, opacity: drone ? 0.55 : 0.3, dashArray: drone ? '2 3' : null, fillOpacity: 0 } };
  }
  function drawCells() {
    const seen = new Set();
    for (const c of S.cells.values()) {
      seen.add(c.cell_id);
      const look = cellLook(c), key = `${look.cls}|${c.severity || ''}`, old = shapes.get(c.cell_id);
      if (old && old.key === key) continue;
      if (old) { G.cells.removeLayer(old.layer); if (old.ripple) G.cells.removeLayer(old.ripple); }
      const layer = L.rectangle(bounds(c.cell_id), { ...look.o, className: `cell ${look.cls}`, bubblingMouseEvents: false })
        .on('click', (e) => openCell(c.cell_id, e.latlng));
      const ripple = look.color ? L.rectangle(bounds(c.cell_id), { color: look.color, weight: 1.2, fill: false, interactive: false, className: 'ripple' }) : null;
      G.cells.addLayer(layer); if (ripple) G.cells.addLayer(ripple);
      shapes.set(c.cell_id, { key, layer, ripple });
    }
    for (const [id, s] of shapes) if (!seen.has(id)) { G.cells.removeLayer(s.layer); if (s.ripple) G.cells.removeLayer(s.ripple); shapes.delete(id); }
  }
  function drawEffects() {
    G.effects.clearLayers();
    for (const e of (S.fleet && S.fleet.effects) || []) {
      L.rectangle(bounds(e.cell_id), { color: '#ffb547', weight: 1.6, dashArray: '6 8', fill: false, className: 'fx', interactive: false })
        .bindTooltip(`SIMULATED ${e.kind === 'jam' ? 'JAMMER' : 'SPOOFER'}`, { permanent: true, direction: 'center', className: 'fxtip' }).addTo(G.effects);
    }
  }
  function openCell(id, latlng) {
    L.popup({ maxWidth: 340, autoPanPadding: [40, 60] }).setLatLng(latlng).setContent(cellHtml(id)).openOn(map);
  }
  function cellHtml(id) {
    const c = S.cells.get(id), state = c ? c.state : 'UNKNOWN';
    const inc = [...S.incidents.values()].filter((i) => i.cell_id === id);
    const through = rows().filter((r) => r.cellList.includes(id)).sort((a, b) => ms(a.launch_at) - ms(b.launch_at)).slice(0, 8);
    const fx = ((S.fleet && S.fleet.effects) || []).find((e) => e.cell_id === id);
    const color = { JAMMED: 'var(--red)', SPOOF: 'var(--violet)', UNKNOWN: 'var(--unk)', NO_KNOWN_ISSUE: 'var(--text)' }[state];
    return `<div class="pop"><h4 style="color:${color}">${esc(id)} · ${STATE_LABEL[state]}</h4>
      <p>${c && c.n_total != null ? `${c.n_degraded}/${c.n_total} sensor aircraft degraded (ratio ${Number(c.ratio).toFixed(2)}), checked ${tm(c.ts)}`
        : 'No fresh aircraft observation here (none, or older than 15 min).'}</p>
      ${inc.map((i) => `<p><b>incident #${i.id}</b> · ${esc(i.type)} ${esc(i.severity)} · ${esc(i.status)} · opened ${tm(i.opened_at)}<br>confidence ${esc(i.confidence)}<br>${esc(i.evidence)}</p>`).join('')}
      ${c && c.drone_evidence ? `<p>drone report ${tm(c.drone_ts)}: ${esc(c.drone_evidence)}</p>` : ''}
      <p>${through.length ? `Sorties through this cell: ${through.map((r) => `${esc(r.sortie_id)} (${esc(r.status)}, ${tm(r.launch_at)})`).join(', ')}` : 'No sortie is planned through this cell.'}</p>
      ${CFG.fleet ? `<div class="row">${fx ? `<span class="lbl" style="color:var(--amber)">simulated ${fx.kind === 'jam' ? 'jammer' : 'spoofer'} here</span><button class="btn" data-fx="none" data-cell="${esc(id)}">Remove</button>`
        : `<button class="btn warn" data-fx="jam" data-cell="${esc(id)}">Simulate jammer</button><button class="btn warn" data-fx="spoof" data-cell="${esc(id)}">Simulate spoofer</button>`}</div>
        <p class="note">Only the simulated drones feel it. What they report runs through the real pipeline: WF7 → WF2 → WF3 → Telegram.</p>` : ''}</div>`;
  }

  // drones, drawn like the design: an arrow on its heading, its id, its GNSS state, a trail. They glide between updates.
  const marks = new Map();
  const droneHtml = () => '<div class="ring"></div><div class="bad"></div><div class="body"><svg viewBox="-7 -9 14 16" width="14" height="16"><path d="M0 -8 L6 6 L0 3 L-6 6 Z"/></svg></div><div class="tag"><span></span><em></em></div>';
  const TRAIL = { color: '#c8d7e6', weight: 1, opacity: 0.18 }, TRAIL_SEL = { color: '#4fd1e0', weight: 2, opacity: 0.8 };
  function drawDrones() {
    const drones = (S.fleet && S.fleet.drones) || [], ids = new Set(drones.map((d) => d.drone_id)), now = performance.now();
    for (const d of drones) {
      let k = marks.get(d.drone_id);
      if (!k) {
        const m = L.marker([d.lat, d.lon], { icon: L.divIcon({ className: 'drone-ic', iconSize: [0, 0], html: droneHtml() }), keyboard: false })
          .on('click', () => selectDrone(d.drone_id)).addTo(G.drones);
        k = { m, from: [d.lat, d.lon], to: [d.lat, d.lon], t0: now, trail: null };
        marks.set(d.drone_id, k);
      } else { const p = k.m.getLatLng(); k.from = [p.lat, p.lng]; k.to = [d.lat, d.lon]; k.t0 = now; }
      const el = k.m.getElement();
      if (el) {
        el.classList.remove('NORMAL', 'JAMMED', 'SPOOF'); el.classList.add(d.env); el.classList.toggle('sel', d.drone_id === S.sel);
        el.querySelector('.body').style.setProperty('--hdg', `${d.hdg}deg`);
        el.querySelector('.tag span').textContent = d.drone_id.replace('BG-', '');
        el.querySelector('.tag em').textContent = d.env === 'JAMMED' ? 'GNSS JAMMED' : d.env === 'SPOOF' ? 'GNSS SPOOF?' : '';
      }
      const tr = S.trails.get(d.drone_id) || [];
      if (!k.trail) k.trail = L.polyline(tr, { ...TRAIL, interactive: false }).addTo(G.trails);
      k.trail.setLatLngs(tr);
      k.trail.setStyle(d.drone_id === S.sel ? TRAIL_SEL : TRAIL);
    }
    for (const [id, k] of marks) if (!ids.has(id)) { G.drones.removeLayer(k.m); if (k.trail) G.trails.removeLayer(k.trail); marks.delete(id); }
    G.sel.clearLayers();
    const d = drones.find((x) => x.drone_id === S.sel);
    if (d && d.route && d.route.points.length) {
      const pts = d.route.loop ? [...d.route.points, d.route.points[0]] : d.route.points;
      L.polyline(pts, { color: '#4fd1e0', weight: 1.2, dashArray: '3 4', opacity: 0.45, interactive: false }).addTo(G.sel);
    }
    if (d && d.ghost) {
      L.polyline([[d.lat, d.lon], d.ghost], { color: '#a58bff', weight: 1, dashArray: '2 5', interactive: false }).addTo(G.sel);
      L.marker(d.ghost, { icon: L.divIcon({ className: 'ghost-ic', iconSize: [0, 0] }), interactive: false })
        .bindTooltip('spoofed GNSS fix', { permanent: true, direction: 'right', offset: [8, 0] }).addTo(G.sel);
    }
  }
  (function glide(t) {
    for (const k of marks.values()) {
      const f = Math.min(1, (t - k.t0) / 2000);
      k.m.setLatLng([k.from[0] + (k.to[0] - k.from[0]) * f, k.from[1] + (k.to[1] - k.from[1]) * f]);
    }
    requestAnimationFrame(glide);
  })(performance.now());

  // ---------- views ----------
  function go(v) {
    S.view = v;
    document.querySelectorAll('#nav button').forEach((b) => b.classList.toggle('on', b.dataset.v === v));
    document.querySelectorAll('.view').forEach((s) => s.classList.toggle('on', s.id === `v-${v}`));
    if (v === 'live') setTimeout(() => map.invalidateSize(), 50);
    render();
  }
  document.querySelectorAll('#nav button').forEach((b) => { b.onclick = () => go(b.dataset.v); });
  $('#close').onclick = () => { $('#drawer').classList.remove('open'); S.sel = null; drawDrones(); };
  document.querySelectorAll('#dtabs button').forEach((b) => {
    b.onclick = () => { S.tab = b.dataset.t; document.querySelectorAll('#dtabs button').forEach((x) => x.classList.toggle('on', x === b)); renderDrawer(true); };
  });
  document.querySelectorAll('#filters button').forEach((b) => {
    b.onclick = () => { S.filter = b.dataset.f; document.querySelectorAll('#filters button').forEach((x) => x.classList.toggle('on', x === b)); renderLog(); };
  });
  function selectDrone(id) {
    S.sel = id; S.tab = S.tab || 'tel';
    $('#drawer').classList.add('open');
    if (S.view !== 'live') go('live');
    renderDrawer(true); drawDrones();
    const d = ((S.fleet && S.fleet.drones) || []).find((x) => x.drone_id === id);
    if (d) map.panTo([d.lat, d.lon], { animate: true });
  }
  const logHtml = (l, isNew) => `<div class="ev k-${window.logKind(l.workflow)}${isNew ? ' new' : ''}"><div><span class="a">${esc(l.action)}</span><span class="m">${tm(l.ts, true)} · ${esc(l.workflow)}</span></div>`
    + `<div class="r">${esc(l.reason)}</div>${l.outcome ? `<div class="o">→ ${esc(l.outcome)}</div>` : ''}</div>`;

  function renderChips() {
    const n = { JAMMED: 0, SPOOF: 0, UNKNOWN: 0, NO_KNOWN_ISSUE: 0 };
    for (const c of S.cells.values()) n[c.state] = (n[c.state] || 0) + 1;
    const R = rows(), hold = R.filter((r) => r.status === 'HOLD').length, need = R.filter((r) => r.pending).length;
    const air = ((S.fleet && S.fleet.drones) || []).length;
    $('#chips').innerHTML = [['var(--red)', `${n.JAMMED} JAMMED`], ['var(--violet)', `${n.SPOOF} SPOOF`], ['var(--unk)', `${n.UNKNOWN} UNKNOWN`],
      ['#9fb0c2', `${n.NO_KNOWN_ISSUE} NO KNOWN ISSUE`], ['var(--amber)', `${hold} ON HOLD`], ...(CFG.fleet ? [['var(--cyan)', `${air} AIRBORNE`]] : [])]
      .map(([col, t]) => `<div class="chip"><span class="dot" style="background:${col}"></span>${t}</div>`).join('')
      + (need ? `<div class="chip hot"><span class="dot" style="background:var(--amber)"></span>${need} WAITING FOR THE OFFICER</div>` : '');
    $('#needCount').hidden = !need; $('#needCount').textContent = need;
  }
  function renderTicker() {
    const l = S.log[0];
    if (l) $('#ticker').innerHTML = `<span class="t">${tm(l.ts, true)}</span><span class="a">${esc(l.action)}</span><span class="r">${esc(l.reason)}</span>`;
  }

  function renderDrawer(full) {
    const d = ((S.fleet && S.fleet.drones) || []).find((x) => x.drone_id === S.sel);
    if (!S.sel) return;
    if (!d) {
      $('#dId').textContent = S.sel; $('#dState').innerHTML = '<span class="state">LANDED</span>';
      $('#dbody').innerHTML = '<p class="sub">This drone has landed. Its reports stay in the agent log.</p>';
      return;
    }
    $('#dId').textContent = d.drone_id;
    $('#dUnit').textContent = `${d.unit || ''} · sortie ${d.sortie_id} · ${d.priority || ''}`;
    $('#dState').innerHTML = `<span class="state s-${d.env}">GNSS ${d.env === 'NORMAL' ? 'NOMINAL' : d.env === 'JAMMED' ? 'JAMMED' : 'SPOOF SUSPECTED'} · ${esc(d.nav)}</span>`;
    const b = $('#dbody');
    if (S.tab === 'tel') {
      if (full || !b.querySelector('#tg1')) {
        b.innerHTML = `<div class="lbl" style="margin-bottom:6px">GNSS health</div><div class="tgrid" id="tg1"></div>
          <div class="sparks"><div class="sp"><div class="lbl">Satellites</div><canvas id="spS"></canvas></div><div class="sp"><div class="lbl">h_acc (m)</div><canvas id="spH"></canvas></div></div>
          <div class="lbl" style="margin-bottom:6px">Flight</div><div class="tgrid" id="tg2"></div>
          <p class="note">SIMULATED telemetry in MAVLink GPS_RAW_INT and PX4 SensorGps field names, every 2 s.</p>`;
      }
      const c = S.cells.get(d.cell), fx = ((S.fleet && S.fleet.effects) || []).find((e) => e.cell_id === d.cell);
      const cell = (k, v, cls = '') => `<div><div class="k">${k}</div><div class="v ${cls}">${esc(v)}</div></div>`;
      $('#tg1').innerHTML = cell('GNSS fix', fixName(d.fix_type), d.fix_type < 3 ? 'bad' : '') + cell('Satellites', d.sats, d.sats < 6 ? 'bad' : '')
        + cell('h_acc', `${d.h_acc} m`, d.h_acc > 10 ? 'bad' : '') + cell('Jamming flag', jamName(d.jam), d.jam >= 2 ? 'bad' : '')
        + cell('Spoofing flag', spoofName(d.spoof), d.spoof >= 2 ? 'spoof' : '') + cell('GNSS / INS gap', `${d.gap} m`, d.gap > 100 ? 'spoof' : '')
        + cell('Navigation', d.nav, d.nav !== 'GNSS' ? 'warn' : '')
        + cell('Cell', `${d.cell} · ${STATE_LABEL[c ? c.state : 'UNKNOWN']}${fx ? ' · sim ' + (fx.kind === 'jam' ? 'jammer' : 'spoofer') : ''}`, c && c.state === 'JAMMED' ? 'bad' : c && c.state === 'SPOOF' ? 'spoof' : '');
      $('#tg2').innerHTML = cell('Position', `${d.lat.toFixed(4)}°N ${d.lon.toFixed(4)}°E`) + cell('Altitude', `${d.alt} m AGL`) + cell('Ground speed', `${d.spd} m/s`)
        + cell('Heading', `${String(d.hdg).padStart(3, '0')}°`) + cell('Battery', `${d.batt} %`, d.batt < 30 ? 'warn' : '') + cell('Link', `${d.rssi} dBm`)
        + cell('Airborne', `${d.airborne_min} min`) + cell('Sortie', d.sortie_id);
      const h = S.hist.get(d.drone_id) || { sats: [], hacc: [] };
      spark($('#spS'), h.sats, '#4fd1e0', { min: 0, max: 18 }); spark($('#spH'), h.hacc, d.env === 'NORMAL' ? '#4fd1e0' : '#ff5d5d', { min: 0 });
    } else if (S.tab === 'drone') {
      const ev = d.events || [];
      b.innerHTML = '<p class="sub">What the drone and its ground station did on their own: GNSS changes, the autopilot\'s reaction, reports sent to AirGuard.</p>'
        + (ev.length ? ev.map((e) => `<div class="ev k-drone"><div><span class="a">${esc(e.action)}</span><span class="m">${tm(e.t, true)}</span></div><div class="r">${esc(e.detail)}</div></div>`).join('')
          : '<p class="sub">Nothing yet.</p>');
    } else {
      const R = rows().find((r) => r.sortie_id === d.sortie_id), cells = new Set([...(R ? R.cellList : []), d.cell]);
      const hit = (l) => `${l.action} ${l.reason}`.includes(d.sortie_id) || `${l.reason}`.includes(d.drone_id) || [...cells].some((c) => `${l.action} ${l.reason}`.includes(c));
      const items = [...S.log.filter(hit).map((l) => ({ t: l.ts, html: logHtml(l) })),
        ...S.reports.filter((r) => r.drone_id === d.drone_id).map((r) => ({ t: r.ts, html: `<div class="ev k-drone"><div><span class="a">STORED REPORT ${esc(r.cell_id)} ${esc(r.verdict)}</span><span class="m">${tm(r.ts, true)} · drone_reports</span></div><div class="r">${esc(r.evidence)}</div></div>` }))]
        .sort((a, b) => ms(b.t) - ms(a.t)).slice(0, 30);
      b.innerHTML = `<div class="box"><div class="lbl">Sortie ${esc(d.sortie_id)}${R ? ` · ${esc(R.status)}` : ''}</div><div style="margin-top:4px">Airborne ${d.airborne_min} min. AirGuard gates sorties before launch; this drone's reports feed the next decisions for ${[...cells].map(esc).join(', ')}.</div></div>`
        + (items.map((i) => i.html).join('') || '<p class="sub">No AirGuard decision about this sortie or its cells yet.</p>');
    }
  }

  function renderFleet() {
    const F = S.fleet || { drones: [], grounded: [], effects: [], events: [], reports: {} };
    $('#fleetSub').textContent = CFG.fleet
      ? `${F.drones.length} simulated drones in the air. Each flies a sortie from the sheet once its launch time comes; HOLD and CANCELLED sorties stay on the ground. Telemetry every 2 s${F.speed > 1 ? ` at ${F.speed}× speed` : ''}. Reports sent to WF7: ${(F.reports && F.reports.sent) || 0}${F.reports && F.reports.failed ? `, failed: ${F.reports.failed}` : ''}.`
      : 'The simulated fleet is off (the server was started with --no-fleet).';
    $('#fleetRows').innerHTML = F.drones.map((d) => `<tr class="click" data-id="${esc(d.drone_id)}"><td style="font-weight:600">${esc(d.drone_id)}</td><td>${esc(d.sortie_id)}</td><td>${esc(d.unit)}</td>`
      + `<td><span class="state s-${d.env}" style="margin:0">${d.env === 'NORMAL' ? 'NOMINAL' : d.env}</span></td><td>${d.sats}</td><td class="v ${d.h_acc > 10 ? 'bad' : ''}">${d.h_acc} m</td>`
      + `<td>${esc(d.nav)}</td><td>${d.batt} %</td><td>${d.airborne_min} min</td><td><canvas id="fs-${esc(d.drone_id)}"></canvas></td></tr>`).join('')
      || '<tr><td colspan="10" style="color:var(--muted)">No drone in the air. A sortie flies when its launch time comes; load the demo plan on the Sorties page to start some.</td></tr>';
    for (const d of F.drones) spark(document.getElementById(`fs-${d.drone_id}`), (S.hist.get(d.drone_id) || { hacc: [] }).hacc, d.env === 'NORMAL' ? '#4fd1e0' : '#ff5d5d', { min: 0 });
    document.querySelectorAll('#fleetRows tr.click').forEach((r) => { r.onclick = () => selectDrone(r.dataset.id); });
    $('#grounded').innerHTML = F.grounded.length ? F.grounded.map((s) => `<div class="box"><b style="font-family:var(--mono)">${esc(s.sortie_id)}</b> · ${esc(s.status)} · launch was ${tm(s.launch_at)}<div class="note">${esc(s.unit)} · ${s.cells.map(esc).join(', ')}</div></div>`).join('')
      : '<p class="sub">None right now.</p>';
    $('#effects').innerHTML = F.effects.length ? F.effects.map((e) => `<div class="box" style="display:flex;justify-content:space-between;align-items:center;gap:8px"><span><b style="font-family:var(--mono)">${esc(e.cell_id)}</b> · simulated ${e.kind === 'jam' ? 'jammer' : 'spoofer'} since ${tm(e.since)}</span><button class="btn" data-fx="none" data-cell="${esc(e.cell_id)}">Remove</button></div>`).join('')
      : '<p class="sub">None. Click a cell on the map to place one.</p>';
    $('#fleetEvents').innerHTML = (F.events || []).slice(0, 30).map((e) => `<div class="ev k-drone"><div><span class="a">${esc(e.action)}</span><span class="m">${tm(e.t, true)}</span></div><div class="r">${esc(e.detail)}</div></div>`).join('') || '<p class="sub">Nothing yet.</p>';
  }

  function renderBoard() {
    const now = Date.now(), flying = new Set(((S.fleet && S.fleet.drones) || []).map((d) => d.sortie_id)), R = rows();
    const g = { officer: [], flight: [], hold: [], changed: [], upcoming: [], past: [] };
    for (const r of R) g[window.column(r, now, flying)].push(r);
    for (const k of Object.keys(g)) g[k].sort((a, b) => ms(a.launch_at) - ms(b.launch_at));
    const bot = S.status && S.status.telegram && S.status.telegram.bot;
    $('#sortiesSub').innerHTML = `${R.length} sorties in the Google Sheet "AirGuard Sorties". The mirror synced ${S.sync ? `${tm(S.sync.synced_at)} (${rel(S.sync.synced_at)}) by ${esc(S.sync.by)}` : 'never'}; decisions made since then show at once.`;
    $('#demoBar').hidden = !CFG.demo;
    $('#pending').innerHTML = g.officer.map((r) => `<div class="tg"><div class="lbl" style="margin-bottom:6px">Telegram · waiting for the duty officer${bot ? ` · <a href="https://t.me/${esc(bot)}" target="_blank" rel="noopener">@${esc(bot)}</a>` : ''}</div>`
      + `<div class="msg">⛔ ${esc(LEVEL[r.level] || 'HOLD')} · ${esc(r.sortie_id)} · ${esc(r.unit)} · launch ${HM.format(new Date(ms(r.launch_at)))}\n${esc(r.reason)}\nAgent: held. Needs your call. It never says safe.</div>`
      + `<div class="keys"><span>Keep HOLD</span><span>Launch anyway</span><span>False alarm</span></div><div class="note">Answer on the phone; this page updates the moment WF6 records it.</div></div>`).join('');
    const lv = (l) => (['L3_HOLD', 'L4_SPOOF_HOLD', 'BRAKE_HOLD'].includes(l) ? 'hold' : ['L1_RESCHEDULE', 'L2_CANCEL'].includes(l) ? 'move' : 'quiet');
    const card = (r) => `<div class="card${r.pending ? ' need' : ''}"><div class="top"><span>${esc(r.sortie_id)}</span><span class="pri">${esc(r.priority)}</span></div>`
      + `<div class="lbl" style="margin-top:3px;text-transform:none;letter-spacing:0">${esc(r.unit)}</div>`
      + `<div class="lbl">launch ${tm(r.launch_at)} · ${rel(r.launch_at)}</div><div class="lbl">${r.cellList.map(esc).join(' · ')}</div>`
      + `<div class="lv ${r.level ? lv(r.level) : 'quiet'}">${r.level ? LEVEL[r.level] : esc(r.status)}${r.decided_by && r.decided_by.startsWith('human:') ? ` · ${esc(r.decided_by.slice(6))}` : ''}</div>`
      + (r.reason ? `<div class="why">${esc(r.reason)}</div>` : '') + '</div>';
    const cols = [['officer', 'NEEDS THE OFFICER'], ['flight', 'IN FLIGHT'], ['hold', 'ON HOLD'], ['changed', 'MOVED OR CANCELLED'], ['upcoming', 'UPCOMING']];
    $('#board').innerHTML = cols.map(([k, t]) => `<div class="col"><h3>${t}<span style="color:var(--muted)">${g[k].length}</span></h3>${g[k].map(card).join('') || '<div class="note">none</div>'}</div>`).join('');
    $('#past').innerHTML = g.past.length ? `Launched earlier and no longer flying: ${g.past.map((r) => `${esc(r.sortie_id)} (${esc(r.status)}, ${tm(r.launch_at)})`).join(', ')}` : '';
    const c = S.confirm;
    $('#confirm').innerHTML = !c ? '' : `<div class="confirm"><p>${c === 'load'
      ? 'Writes 16 fictional sorties (T-301 to T-316) into the Google Sheet and replaces older T-* test rows. Four launch right away and the simulated fleet flies them. The gate checks the other twelve every 5 minutes, so expect real Telegram messages (UNVERIFIED notices, HOLD cards) on your phone.'
      : 'Removes every T-* test sortie from the Google Sheet. Other rows stay.'}</p><button class="btn warn" data-go="${c}">${c === 'load' ? 'Load 16 demo sorties' : 'Remove T-* sorties'}</button><button class="btn" data-go="cancel">Cancel</button></div>`;
  }
  function renderLog() {
    const L = S.log.filter((l) => S.filter === 'all' || window.logKind(l.workflow) === S.filter).slice(0, 150);
    $('#feed').innerHTML = L.map((l) => logHtml(l, l.id === S.newLogId)).join('') || '<p class="sub">No lines yet.</p>';
    S.newLogId = null;
  }

  const NODES = [
    ['apify', 'Apify actor', 'adsb.lol, fallback adsb.fi, every 5 min'], ['WF1', 'WF1 Collect', 'checks the run with Apify, bins aircraft into 0.5° cells'],
    ['WF7', 'WF7 Telemetry', 'drone GNSS leg reports (C12)'], ['db', 'Supabase', 'observations · incidents · decisions · realtime'],
    ['WF2', 'WF2 Detect', 'opens, may-lifts and closes incidents'], ['WF3', 'WF3 Gate', 'decides every sortie, syncs the sheet mirror'],
    ['sheet', 'Google Sheet', '"AirGuard Sorties", tab sorties'], ['WF6', 'Telegram · WF6', 'FYI and HOLD cards, the officer answers'],
    ['WF4', 'WF4 Heal', 'failover, failure webhook, stale-data watchdog'], ['WF5', 'WF5 Report', 'morning report at 07:00'],
    ['WF8', 'WF8 Console', 'demo plan and sheet sync on request'],
  ];
  function nodeLines(k) {
    const st = S.status || {}, ok = (b, t) => `<span class="${b ? 'ok' : 'err'}">● ${esc(t)}</span>`;
    if (k === 'apify') {
      const a = st.apify;
      if (!a) return ['loading…'];
      if (a.error) return [ok(false, a.error)];
      const L = a.last || {};
      return [ok(L.status === 'SUCCEEDED' || L.status === 'RUNNING', `last run ${String(L.status || '–').toLowerCase()} ${L.startedAt ? rel(L.startedAt) : ''}`),
        `<span>source <b>${esc(a.source || '–')}</b> · <b>${a.aircraft ?? '–'}</b> aircraft${a.failover ? ' · <b style="color:var(--amber)">failover</b>' : ''}</span>`,
        `<span>${a.hour.runs} runs in the last hour${a.hour.failed ? `, <b style="color:var(--amber)">${a.hour.failed} failed</b>` : ''}</span>`,
        a.schedule ? `<span>schedule ${esc(a.schedule.cron)} · ${a.schedule.enabled ? 'on' : '<b style="color:var(--amber)">off</b>'}</span>` : ''];
    }
    if (k === 'db') {
      const inc = [...S.incidents.values()].filter((i) => SHOW_TEST || !isTest(i.cell_id)).length;
      return [ok(S.rt === 'SUBSCRIBED', S.rt === 'SUBSCRIBED' ? 'realtime connected' : `realtime ${S.rt.toLowerCase()}`),
        `<span><b>${S.obsHour ?? '–'}</b> observations in the last hour</span>`, `<span><b>${inc}</b> open incidents</span>`];
    }
    if (k === 'sheet') return S.sync ? [ok(true, `mirror synced ${rel(S.sync.synced_at)}`), `<span><b>${S.sync.n_rows}</b> rows · by ${esc(S.sync.by)}</span>`] : ['not synced yet'];
    const n = st.n8n;
    if (!n) return ['loading…'];
    if (n.error) return [ok(false, n.error)];
    const w = n[k], lines = [];
    if (!w) return [`<span class="err">● not found in n8n</span>`];
    lines.push(ok(w.active && (!w.last || w.last.status !== 'error'), `${w.active ? 'published' : 'not published'}${w.last ? ` · last ${w.last.status} ${rel(w.last.startedAt)}` : ' · no run yet'}`));
    lines.push(`<span>${w.hour.runs} runs in the last hour${w.hour.errors ? `, <b style="color:var(--amber)">${w.hour.errors} errors</b>` : ''}</span>`);
    if (k === 'WF6' && st.telegram && !st.telegram.error) {
      const t = st.telegram;
      lines.push(`<span>bot <b>@${esc(t.bot || '–')}</b> · webhook ${t.webhook ? 'set' : '<b style="color:var(--amber)">missing</b>'}${t.pending ? ` · ${t.pending} pending` : ''}</span>`);
      if (t.lastError) lines.push(`<span class="err">last error ${rel(t.lastError.at)}: ${esc(t.lastError.message)}</span>`);
    }
    if (k === 'WF7' && st.fleet && st.fleet.on) lines.push(`<span>${st.fleet.reports.sent || 0} simulated reports sent by this console</span>`);
    return lines;
  }
  function renderPipe(pulse = []) {
    $('#flow').innerHTML = NODES.map(([k, name, desc]) => `<div class="node${pulse.includes(k) ? ' pulse' : ''}" data-k="${k}"><div class="lbl">${k.startsWith('WF') ? k : k === 'db' ? 'DATABASE' : k.toUpperCase()}</div>`
      + `<div class="n">${name}</div><div class="d">${desc}</div><div class="st">${nodeLines(k).filter(Boolean).join('')}</div></div>`).join('');
    $('#obsHour').textContent = S.obsHour ?? '–';
    $('#incOpen').textContent = [...S.incidents.values()].filter((i) => SHOW_TEST || !isTest(i.cell_id)).length;
  }

  function render() {
    renderChips(); renderTicker();
    if (S.view === 'live' && S.sel) renderDrawer(false);
    if (S.view === 'fleet') renderFleet();
    if (S.view === 'sorties') renderBoard();
    if (S.view === 'log') renderLog();
    if (S.view === 'pipe') renderPipe();
  }
  const soonRender = debounce(render, 250);

  // clicks: simulation effects, demo buttons
  document.addEventListener('click', async (e) => {
    const fx = e.target.closest('[data-fx]'), demo = e.target.closest('[data-demo]'), goBtn = e.target.closest('[data-go]');
    try {
      if (fx) {
        fx.disabled = true;
        const r = await post('/api/sim/effect', { cell_id: fx.dataset.cell, kind: fx.dataset.fx });
        if (S.fleet) S.fleet.effects = r.effects;
        drawEffects(); map.closePopup(); render();
        toast('drone', fx.dataset.fx === 'none' ? `Simulation removed from ${fx.dataset.cell}` : `Simulated ${fx.dataset.fx === 'jam' ? 'jammer' : 'spoofer'} placed in ${fx.dataset.cell}`,
          fx.dataset.fx === 'none' ? '' : 'Drones flying through it report bad GNSS to WF7; the next 5-minute cycle turns that into an incident.');
      }
      if (demo) {
        if (demo.dataset.demo === 'sync') { demo.disabled = true; const r = await post('/api/demo', { op: 'sync' }); toast('console', 'Sheet mirror synced', `${r.rows ?? '?'} rows`); demo.disabled = false; }
        else { S.confirm = demo.dataset.demo; renderBoard(); }
      }
      if (goBtn) {
        const op = goBtn.dataset.go;
        S.confirm = null; renderBoard();
        if (op !== 'cancel') {
          toast('console', op === 'load' ? 'Loading the demo plan…' : 'Removing T-* sorties…', 'WF8 is writing the Google Sheet.');
          const r = await post('/api/demo', { op });
          toast('console', op === 'load' ? 'Demo plan loaded' : 'Test sorties removed', `the sheet now has ${r.rows ?? '?'} rows`);
        }
      }
    } catch (err) { toast('bad', 'That did not work', err.message); if (fx) fx.disabled = false; }
  });
  async function post(url, body) {
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    return j;
  }

  // ---------- data ----------
  const sb = window.supabase && CFG.url && CFG.key ? window.supabase.createClient(CFG.url, CFG.key, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
  const q = async (p) => { const { data, error } = await p; if (error) throw new Error(error.message); return data; };
  async function loadCells() {
    const data = await q(sb.from('cell_status').select('*'));
    const onMap = (id) => { const [la, lo] = id.split('_').map(Number); return REGION.contains([la + 0.25, lo + 0.25]); };   // the region only
    S.cells = new Map(data.filter((c) => (SHOW_TEST || !isTest(c.cell_id)) && onMap(c.cell_id)).map((c) => [c.cell_id, c]));
    drawCells(); renderChips();
  }
  async function loadAll() {
    const since = (h) => new Date(Date.now() - h * 3600e3).toISOString();
    try {
      const [inc, log, dec, sor, sync, rep, obs] = await Promise.all([
        q(sb.from('incidents').select('*').neq('status', 'closed')),
        q(sb.from('agent_log').select('*').order('id', { ascending: false }).limit(200)),
        q(sb.from('decisions').select('*').gte('ts', since(48)).order('id', { ascending: false }).limit(1000)),
        q(sb.from('sorties').select('*')),
        q(sb.from('sheet_sync').select('*').eq('id', 1)),
        q(sb.from('drone_reports').select('*').gte('ts', since(2)).order('id', { ascending: false }).limit(300)),
        sb.from('observations').select('id', { count: 'exact', head: true }).gte('ts', since(1)),
      ]);
      S.incidents = new Map(inc.map((i) => [i.id, i])); S.log = log; S.decisions = new Map(dec.map((d) => [d.id, d]));
      S.sorties = new Map(sor.map((s) => [s.sortie_id, s])); S.sync = sync[0] || null; S.reports = rep; S.obsHour = obs.count;
      await loadCells();
      banner(null);
      render();
    } catch (e) { banner(`Supabase: ${e.message}. Retrying.`); }
  }
  const soonCells = debounce(() => loadCells().catch(() => {}), 2500);

  function onChange(table, p) {
    const row = p.new && Object.keys(p.new).length ? p.new : null, old = p.old || {};
    if (table === 'agent_log' && row) {
      S.log.unshift(row); S.log.length = Math.min(S.log.length, 300); S.newLogId = row.id;
      const kind = window.logKind(row.workflow);
      toast(kind === 'pipeline' && /SWITCH|ALERT|REJECT|FLAG NO DATA/.test(row.action) ? 'bad' : kind, row.action, row.reason);
      $('#ticker').animate([{ opacity: 0.3 }, { opacity: 1 }], 500);
    }
    if (table === 'incidents') { const r = row || old; if (row && row.status !== 'closed') S.incidents.set(row.id, row); else S.incidents.delete(r.id); soonCells(); }
    if (table === 'observations' && row) { S.obsHour = (S.obsHour || 0) + 1; soonCells(); }
    if (table === 'drone_reports' && row) { S.reports.unshift(row); S.reports.length = Math.min(S.reports.length, 300); soonCells(); }
    if (table === 'decisions' && row) S.decisions.set(row.id, row);
    if (table === 'sorties') { if (p.eventType === 'DELETE') S.sorties.delete(old.sortie_id); else if (row) S.sorties.set(row.sortie_id, row); }
    if (table === 'sheet_sync' && row) S.sync = row;
    soonRender();
  }
  function renderRt() {
    const on = S.rt === 'SUBSCRIBED', el = $('#rt');
    el.className = `rt ${on ? 'on' : S.rt === 'CONNECTING' ? '' : 'off'}`;
    el.textContent = on ? 'LIVE' : S.rt === 'CONNECTING' ? 'CONNECTING' : 'RECONNECTING';
  }
  function subscribe() {
    const ch = sb.channel('airguard-console');
    for (const table of TABLES) ch.on('postgres_changes', { event: '*', schema: 'public', table }, (p) => onChange(table, p));
    ch.subscribe((st) => { S.rt = st; renderRt(); if (st === 'SUBSCRIBED') loadAll(); });
  }

  async function loadStatus() {
    try {
      const r = await fetch('/api/status');
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const st = await r.json(), pulse = [];
      for (const k of ['WF1', 'WF2', 'WF3', 'WF4', 'WF5', 'WF6', 'WF7', 'WF8']) {
        const t = st.n8n && st.n8n[k] && st.n8n[k].last && st.n8n[k].last.startedAt;
        if (t && S.lastRuns[k] && S.lastRuns[k] !== t) pulse.push(k, ...(k === 'WF1' ? ['apify', 'db'] : k === 'WF3' ? ['sheet'] : []));
        if (t) S.lastRuns[k] = t;
      }
      S.status = st;
      $('#src').textContent = (st.apify && st.apify.source) || '–';
      if (S.view === 'pipe') renderPipe(pulse);
      if (S.view === 'sorties') renderBoard();
    } catch (e) { S.status = S.status || {}; }
  }

  async function loadAircraft() {
    try { const r = await fetch('/api/aircraft'); if (r.ok) { S.air = await r.json(); drawAircraft(); } } catch { /* the map keeps the last picture */ }
  }

  function onFleet() {
    const F = S.fleet;
    for (const d of F.drones) {
      const tr = S.trails.get(d.drone_id) || []; tr.push([d.lat, d.lon]); if (tr.length > 90) tr.shift(); S.trails.set(d.drone_id, tr);
      const h = S.hist.get(d.drone_id) || { sats: [], hacc: [] }; h.sats.push(d.sats); h.hacc.push(d.h_acc);
      if (h.sats.length > 90) { h.sats.shift(); h.hacc.shift(); }
      S.hist.set(d.drone_id, h);
    }
    for (const e of (F.events || []).slice().reverse()) {
      const key = `${e.t}|${e.action}`;
      if (S.seenEvents.has(key)) continue;
      S.seenEvents.add(key);
      if (S.fleetReady && /TAKEOFF|LANDED|GNSS|SIMULATION/.test(e.action)) toast('drone', e.action, e.detail);
    }
    S.fleetReady = true;
    drawDrones(); drawEffects();
    if (S.view === 'live' && S.sel) renderDrawer(false);
    if (S.view === 'fleet') renderFleet();
    renderChips();
  }
  function startFleet() {
    if (!CFG.fleet) return;
    $('#simBadge').hidden = false;
    const es = new EventSource('/api/fleet/stream');
    es.onmessage = (m) => { S.fleet = JSON.parse(m.data); onFleet(); };
  }

  function clock() {
    const now = new Date();
    $('#clock').textContent = HMS.format(now); $('#zone').textContent = zone(now);
    const left = Math.max(0, Math.ceil((Math.floor(now / 300e3) * 300e3 + 300e3 - now) / 1000));
    const txt = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
    $('#cyc').textContent = txt; $('#cd2').textContent = txt;
  }

  // ---------- start ----------
  clock(); setInterval(clock, 1000);
  if (!sb) { banner('No Supabase URL or anon key: start the console with npm run console so it can write /config.js.'); return; }
  loadAll(); subscribe(); startFleet(); loadStatus(); loadAircraft();
  setInterval(() => loadCells().catch(() => {}), 30e3);      // cell_status is a view: states also age out with no row change
  setInterval(loadStatus, 15e3);
  setInterval(loadAircraft, 60e3);                          // a new picture after every 5-min collect
  setInterval(() => { if (S.rt !== 'SUBSCRIBED') loadAll(); }, 20e3);   // no realtime: poll
  setInterval(loadAll, 5 * 60e3);
  setInterval(() => { if (S.view === 'sorties' || S.view === 'pipe') render(); }, 30e3);   // relative times
})();
