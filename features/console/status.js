// Owner: Krish (see CLAUDE.md)
// Pure summaries for the console's Pipeline view, built by server.js from the n8n, Apify and Telegram APIs.
// Nothing here ever carries a token: only names, states and times reach the browser.

const FIVE_MIN = 5 * 60e3;

// n8nSummary(workflows: GET /workflows data, executions: GET /executions data, now ms)
//   -> { WF1: { id, name, active, last: {status, startedAt, stoppedAt} | null, hour: {runs, errors} }, ... }
function n8nSummary(workflows, executions, now) {
  const out = {};
  for (const w of workflows) {
    const m = /^AirGuard (WF\d+)\b/.exec(w.name || '');
    if (!m) continue;
    const runs = executions.filter((e) => String(e.workflowId) === String(w.id))
      .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
    const hour = runs.filter((e) => now - Date.parse(e.startedAt) < 3600e3);
    const last = runs[0];
    out[m[1]] = {
      id: w.id, name: w.name, active: !!w.active,
      last: last ? { status: last.status, startedAt: last.startedAt, stoppedAt: last.stoppedAt || null } : null,
      hour: { runs: hour.length, errors: hour.filter((e) => ['error', 'crashed'].includes(e.status)).length },
    };
  }
  return out;
}

// apifySummary(runs: GET /acts/{id}/runs items (newest first), meta: RUN_META of the newest succeeded run, schedule, now)
function apifySummary(runs, meta, schedule, now) {
  const pick = (r) => r && { id: r.id, status: r.status, startedAt: r.startedAt, finishedAt: r.finishedAt || null,
    secs: r.finishedAt ? Math.round((Date.parse(r.finishedAt) - Date.parse(r.startedAt)) / 1000) : null };
  const hour = runs.filter((r) => now - Date.parse(r.startedAt) < 3600e3);
  return {
    last: pick(runs[0]), lastOk: pick(runs.find((r) => r.status === 'SUCCEEDED')),
    source: meta ? meta.source : null, aircraft: meta ? meta.aircraft : null,
    failover: meta ? !!meta.failover : null, errors: meta && Array.isArray(meta.errors) ? meta.errors.slice(0, 3) : [],
    hour: { runs: hour.length, failed: hour.filter((r) => !['SUCCEEDED', 'RUNNING', 'READY'].includes(r.status)).length },
    schedule: schedule ? { cron: schedule.cronExpression, enabled: !!schedule.isEnabled, nextRunAt: schedule.nextRunAt || null } : null,
  };
}

// telegramSummary(getMe result, getWebhookInfo result, now, getChat result, member count): the bot's name, the ops
// group's title and size, and whether n8n's webhook is healthy. Never an id or the webhook URL.
function telegramSummary(me, hook, now, chat = null, members = null) {
  const lastError = hook && hook.last_error_date ? hook.last_error_date * 1000 : null;
  return {
    bot: me ? me.username : null,
    webhook: hook ? !!hook.url : null,
    pending: hook ? hook.pending_update_count || 0 : null,
    lastError: lastError && now - lastError < 3600e3 ? { at: new Date(lastError).toISOString(), message: hook.last_error_message } : null,
    group: chat ? { title: chat.title || null, members: Number.isFinite(members) ? members : null } : null,
  };
}

// aircraftView(dataset items of one actor run, C2) -> the aircraft the map draws: the ADS-B sensor network at that
// collect. degraded / spoof use the same rules as binCells.js (NIC < 7 or NACp < 8; GPS/baro gap > 1500 ft).
function aircraftView(items) {
  const rows = (Array.isArray(items) ? items : []).filter((a) => a && !a.empty && Number.isFinite(a.lat) && Number.isFinite(a.lon));
  return {
    ts: rows.length ? rows[0].ts : null, source: rows.length ? rows[0].source : null,
    aircraft: rows.map((a) => {
      const sensor = a.nic != null || a.nac_p != null;
      return { lat: +a.lat.toFixed(4), lon: +a.lon.toFixed(4), flight: String(a.flight || a.hex || '').trim().slice(0, 10),
        alt: a.alt_baro ?? a.alt_geom ?? null, sensor,
        degraded: sensor && ((a.nic ?? 99) < 7 || (a.nac_p ?? 99) < 8),
        spoof: Number.isFinite(a.alt_geom) && Number.isFinite(a.alt_baro) && Math.abs(a.alt_geom - a.alt_baro) > 1500 };
    }),
  };
}

// nextCollect(now) -> the next */5 UTC boundary: when the Apify schedule starts the next cycle
const nextCollect = (now) => new Date(Math.floor(now / FIVE_MIN) * FIVE_MIN + FIVE_MIN).toISOString();

if (typeof module !== 'undefined') module.exports = { n8nSummary, apifySummary, telegramSummary, aircraftView, nextCollect };
