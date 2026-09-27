-- 003: the ops console (features/console) reads everything from Supabase, live, with the anon key.

-- decisions become readable like agent_log, which already carries the same text
create policy "public read" on decisions for select using (true);

-- sorties: a mirror of the Google Sheet tab "sorties" (C5). The sheet stays the planner and the source of truth;
-- WF3 syncs the mirror every cycle right after it reads the sheet, WF8 after a console request.
-- Values are kept exactly as the sheet has them (text).
create table sorties (
  sortie_id text primary key,
  unit text, priority text, launch_at text, window_end text, cells text, status text, decided_by text, note text,
  changed_at timestamptz not null default now()      -- last time this row changed in the mirror
);
create table sheet_sync (
  id int primary key default 1 check (id = 1),     -- one row: when the mirror last matched the sheet
  synced_at timestamptz not null,
  n_rows int not null,
  by text not null                                  -- 'WF3' | 'WF8'
);
alter table sorties    enable row level security;
alter table sheet_sync enable row level security;
create policy "public read" on sorties    for select using (true);
create policy "public read" on sheet_sync for select using (true);
grant select on sorties, sheet_sync to anon;

-- sync_sorties(the sheet rows as JSON, who): the mirror becomes exactly the sheet. Rows without a sortie_id are
-- ignored, unchanged rows are not touched (so realtime only sends real changes). Returns the number of rows.
create function sync_sorties(p_rows jsonb, p_by text) returns int language plpgsql as $$
declare n int;
begin
  with src as (
    select distinct on (x.sortie_id) x.*
    from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as x(sortie_id text, unit text, priority text,
      launch_at text, window_end text, cells text, status text, decided_by text, note text)
    where coalesce(trim(x.sortie_id), '') <> ''
    order by x.sortie_id
  ), gone as (
    delete from sorties s where not exists (select 1 from src where src.sortie_id = s.sortie_id)
  ), upsert as (
    insert into sorties (sortie_id, unit, priority, launch_at, window_end, cells, status, decided_by, note)
    select sortie_id, unit, priority, launch_at, window_end, cells, status, decided_by, note from src
    on conflict (sortie_id) do update set unit = excluded.unit, priority = excluded.priority,
      launch_at = excluded.launch_at, window_end = excluded.window_end, cells = excluded.cells,
      status = excluded.status, decided_by = excluded.decided_by, note = excluded.note, changed_at = now()
    where (sorties.unit, sorties.priority, sorties.launch_at, sorties.window_end, sorties.cells, sorties.status,
           sorties.decided_by, sorties.note)
      is distinct from (excluded.unit, excluded.priority, excluded.launch_at, excluded.window_end, excluded.cells,
           excluded.status, excluded.decided_by, excluded.note)
  )
  select count(*) into n from src;
  insert into sheet_sync (id, synced_at, n_rows, by) values (1, now(), n, p_by)
    on conflict (id) do update set synced_at = excluded.synced_at, n_rows = excluded.n_rows, by = excluded.by;
  return n;
end $$;
-- only n8n (the postgres role) syncs: never callable through the public REST API
revoke execute on function sync_sorties(jsonb, text) from public, anon, authenticated;

-- realtime: the console subscribes to these tables (cell_status is a view: the console refetches it)
alter publication supabase_realtime add table agent_log, incidents, decisions, drone_reports, observations, sorties, sheet_sync;
