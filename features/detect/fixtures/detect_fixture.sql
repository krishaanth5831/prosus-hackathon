-- C2: behavioural checks for detect.sql, lift.sql and close.sql. Run through run-fixtures.sh.
-- Only touches test cell 89.5_179.5 (C11). Timestamps are relative to now().
-- Everything runs in ONE transaction that is rolled back at the end, so nothing persists
-- (and it works on the Supabase transaction pooler). The real query files run inside that
-- transaction; anything they change in other cells is rolled back with it.
\set ON_ERROR_STOP on
\set QUIET on
\pset tuples_only on
\pset format unaligned
\set c '''89.5_179.5'''

begin;

create function pg_temp.expect(label text, got text, want text) returns text language plpgsql as $$
begin
  if got is distinct from want then
    raise exception 'FAIL: % (got %, want %)', label, coalesce(got, 'null'), coalesce(want, 'null');
  end if;
  return 'PASS: ' || label;
end $$;

create function pg_temp.reset() returns void language sql as $$
  delete from observations where cell_id = '89.5_179.5';
  delete from incidents    where cell_id = '89.5_179.5';
  delete from baselines    where cell_id = '89.5_179.5';
$$;

create function pg_temp.obs(age interval, n_total int, n_degraded int, n_spoof int default 0) returns void language sql as $$
  insert into observations (ts, cell_id, n_total, n_degraded, ratio, n_spoof, source)
  values (now() - age, '89.5_179.5', n_total, n_degraded,
          case when n_total > 0 then n_degraded::float / n_total else 0 end, n_spoof, 'fixture');
$$;

create function pg_temp.live() returns text language sql as $$
  select count(*)::text from incidents where cell_id = '89.5_179.5' and status <> 'closed';
$$;

-- 1. persistence: one high check is noise, two in a row is an incident, re-running changes nothing
\o :null
select pg_temp.reset();
select pg_temp.obs('1 minute', 10, 8);
\ir ../sql/detect.sql
\o
select pg_temp.expect('1 high check -> 0 incidents', pg_temp.live(), '0');

\o :null
select pg_temp.obs('6 minutes', 10, 7);
\ir ../sql/detect.sql
\o
select pg_temp.expect('2 high checks -> 1 incident', pg_temp.live(), '1');
select pg_temp.expect('  ...JAMMED high, evidence from the latest check',
  (select type || ' ' || severity || ' ' || evidence from incidents where cell_id = :c),
  'JAMMED high 8/10 aircraft degraded, 2 checks in a row');

\o :null
\ir ../sql/detect.sql
\o
select pg_temp.expect('re-run detect -> still 1 incident', pg_temp.live(), '1');

-- 2. coverage: fewer than 3 sensor aircraft is UNKNOWN, never an incident
\o :null
select pg_temp.reset();
select pg_temp.obs('1 minute', 2, 2);
select pg_temp.obs('6 minutes', 2, 2);
\ir ../sql/detect.sql
\o
select pg_temp.expect('n_total < 3 (2/2 degraded, twice) -> 0 incidents', pg_temp.live(), '0');

-- 3. re-arm: a MAY-LIFT incident that goes high again is open again, and no duplicate appears
\o :null
select pg_temp.reset();
insert into incidents (cell_id, type, status, severity, confidence, evidence, opened_at, may_lift_at)
values ('89.5_179.5', 'JAMMED', 'may_lift', 'medium', 'medium (ADS-B only)', 'fixture',
        now() - interval '2 hours', now() - interval '10 minutes');
select pg_temp.obs('1 minute', 10, 6);
select pg_temp.obs('6 minutes', 10, 6);
\ir ../sql/detect.sql
\o
select pg_temp.expect('may_lift + 2 high checks -> re-armed to open',
  (select status || ', may_lift_at ' || coalesce(may_lift_at::text, 'null') from incidents where cell_id = :c),
  'open, may_lift_at null');
select pg_temp.expect('  ...still exactly 1 live incident', pg_temp.live(), '1');

-- 4. MAY-LIFT needs coverage: quiet without sensors is not quiet
\o :null
select pg_temp.reset();
insert into incidents (cell_id, type, status, severity, confidence, evidence, opened_at)
values ('89.5_179.5', 'JAMMED', 'open', 'high', 'medium (ADS-B only)', 'fixture', now() - interval '45 minutes');
select pg_temp.obs(a * interval '5 minutes', 2, 0) from generate_series(0, 5) a;
\ir ../sql/lift.sql
\o
select pg_temp.expect('6 quiet checks with n_total < 3 -> no MAY-LIFT',
  (select status from incidents where cell_id = :c), 'open');

\o :null
select pg_temp.obs(interval '1 minute' + a * interval '5 minutes', 10, 1) from generate_series(0, 3) a;
\ir ../sql/lift.sql
\o
select pg_temp.expect('4 covered quiet checks -> no MAY-LIFT',
  (select status from incidents where cell_id = :c), 'open');

\o :null
select pg_temp.obs('21 minutes', 10, 1);
\ir ../sql/lift.sql
\o
select pg_temp.expect('5 covered quiet checks -> MAY-LIFT',
  (select status from incidents where cell_id = :c), 'may_lift');

-- 5. one high check inside the 30 min blocks MAY-LIFT
\o :null
select pg_temp.reset();
insert into incidents (cell_id, type, status, severity, confidence, evidence, opened_at)
values ('89.5_179.5', 'JAMMED', 'open', 'high', 'medium (ADS-B only)', 'fixture', now() - interval '45 minutes');
select pg_temp.obs(a * interval '5 minutes', 10, 1) from generate_series(0, 5) a;
select pg_temp.obs('12 minutes', 10, 5);
\ir ../sql/lift.sql
\o
select pg_temp.expect('6 quiet + 1 high check in 30 min -> no MAY-LIFT',
  (select status from incidents where cell_id = :c), 'open');

-- 6. close: 2 h after MAY-LIFT the incident closes (the query never touches sorties)
\o :null
select pg_temp.reset();
insert into incidents (cell_id, type, status, severity, confidence, evidence, opened_at, may_lift_at)
values ('89.5_179.5', 'JAMMED', 'may_lift', 'high', 'medium (ADS-B only)', 'fixture',
        now() - interval '4 hours', now() - interval '130 minutes');
\ir ../sql/close.sql
\o
select pg_temp.expect('MAY-LIFT for > 2 h -> closed',
  (select status from incidents where cell_id = :c), 'closed');

-- 7. per-cell baseline: a raised threshold (false-alarm learning) is respected
\o :null
select pg_temp.reset();
insert into baselines (cell_id, threshold) values ('89.5_179.5', 0.5);
select pg_temp.obs('1 minute', 10, 4);
select pg_temp.obs('6 minutes', 10, 4);
\ir ../sql/detect.sql
\o
select pg_temp.expect('ratio 0.4 twice under a 0.5 baseline -> 0 incidents', pg_temp.live(), '0');

-- 8. spoof: >= 2 aircraft with an altitude gap on 2 checks -> SPOOF incident
\o :null
select pg_temp.reset();
select pg_temp.obs('1 minute', 10, 0, 2);
select pg_temp.obs('6 minutes', 10, 0, 3);
\ir ../sql/detect.sql
\o
select pg_temp.expect('n_spoof >= 2 twice -> 1 SPOOF incident',
  (select string_agg(type, ',') from incidents where cell_id = :c), 'SPOOF');

rollback;
\echo ALL FIXTURES PASSED
