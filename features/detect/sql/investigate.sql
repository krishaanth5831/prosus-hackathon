-- F14 loss investigator: the GNSS picture for one cell around one moment (±1 h).
-- Parameters: $1 = cell_id (text, e.g. '54.5_20.5'), $2 = time (timestamptz, UTC ISO 8601).
-- One result set: observations and incidents in time order, tagged by kind.
select 'observation' as kind, o.ts, o.cell_id,
  o.n_degraded || '/' || o.n_total || ' degraded (ratio ' || round(o.ratio::numeric, 2) || '), '
    || o.n_spoof || ' alt-gap, ' || o.source as detail
from observations o
where o.cell_id = $1 and o.ts between $2::timestamptz - interval '1 hour' and $2::timestamptz + interval '1 hour'
union all
select 'incident', i.opened_at, i.cell_id,
  '#' || i.id || ' ' || i.type || ' ' || i.severity || ' ' || i.status || ': ' || i.evidence
    || coalesce(', may-lift ' || to_char(i.may_lift_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), '')
    || coalesce(', closed ' || to_char(i.closed_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), '')
from incidents i
where i.cell_id = $1
  and i.opened_at <= $2::timestamptz + interval '1 hour'
  and coalesce(i.closed_at, 'infinity') >= $2::timestamptz - interval '1 hour'
order by ts;
