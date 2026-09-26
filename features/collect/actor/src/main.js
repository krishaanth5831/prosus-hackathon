// Owner: Person A (see CLAUDE.md)
// Apify actor: polls adsb.lol, falls back to adsb.fi. Spec: docs/plan.md §5.1. Output: shared/contracts/CONTRACTS.md C2.
import { Actor, log } from 'apify';

await Actor.init();
const input = (await Actor.getInput()) ?? {};
const points = input.points?.length ? input.points : [
  { lat: 56.5, lon: 21.0, nm: 250 },   // Latvia/Lithuania coast + Kaliningrad approach
  { lat: 59.8, lon: 25.0, nm: 200 },   // Gulf of Finland / Estonia
  { lat: 54.5, lon: 18.5, nm: 150 },   // Gdańsk / Kaliningrad west
];
const SOURCES = [
  { name: 'adsb.lol', url: (p) => `https://api.adsb.lol/v2/point/${p.lat}/${p.lon}/${p.nm}` },
  { name: 'adsb.fi',  url: (p) => `https://opendata.adsb.fi/api/v2/lat/${p.lat}/lon/${p.lon}/dist/${p.nm}` },
];
const sources = input.forceFallback ? SOURCES.slice(1) : SOURCES;
// adsb.lol answers 403 to Node's default user-agent ("node"), so say who we are
const headers = { 'user-agent': 'airguard-adsb-collector/0.1 (+https://github.com/krishaanth5831/prosus-hackathon)' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ts = new Date().toISOString();
const seen = new Map();          // dedupe by hex: the query circles overlap
const errors = input.forceFallback ? ['forceFallback: adsb.lol skipped on purpose'] : [];
let used = null;

for (const src of sources) {
  for (const p of points) {
    try {
      const res = await fetch(src.url(p), { headers, signal: AbortSignal.timeout(15000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      const ac = body.ac ?? body.aircraft ?? [];   // adsb.lol answers {ac}, adsb.fi answers {aircraft}
      for (const a of ac) if (a.hex && a.lat != null && (a.seen_pos ?? 0) <= 60) seen.set(a.hex, a);
    } catch (e) { errors.push(`${src.name} @${p.lat},${p.lon}: ${e.message}`); }
    await sleep(1500);
  }
  if (seen.size > 0) { used = src.name; break; }   // primary gave nothing → try the next source
}

const rows = [...seen.values()].map((a) => ({
  ts, source: used, hex: a.hex, flight: a.flight?.trim() || null,
  lat: a.lat, lon: a.lon, nic: a.nic ?? null, nac_p: a.nac_p ?? null,
  alt_geom: a.alt_geom ?? null, alt_baro: typeof a.alt_baro === 'number' ? a.alt_baro : null,
}));
await Actor.pushData(rows.length ? rows : [{ ts, empty: true, errors }]);
await Actor.setValue('RUN_META', { ts, source: used, aircraft: rows.length,
  failover: used !== null && used !== 'adsb.lol', errors });
log.info(`${rows.length} aircraft from ${used ?? 'no source'}`, { errors });
await Actor.exit();
