-- 004: reroutes (C6) and the Telegram chat for the ops console (C14). Run after 003.

-- L1_REROUTE: the cells the sortie keeps, joined by ';' as in the sheet (C5). Null for every other level.
alter table decisions add column new_cells text;

-- telegram_log: every message AirGuard sends to the ops group, every card it edits and every tap on a card, as the
-- group shows them. n8n writes a row right after each Telegram call (WF2–WF6). No chat id and no user id: the console
-- reads it with the anon key, like agent_log.
create table telegram_log (
  id bigserial primary key,
  ts timestamptz not null default now(),       -- when Telegram stamped the message; a tap: when WF6 got it
  workflow text not null,                      -- WF2..WF6 (C8)
  kind text not null check (kind in ('message', 'edit', 'tap')),
  message_id bigint,                           -- the message in the group; an edit or a tap names the message it is about
  text text not null default '',               -- as the group shows it; a tap: the label of the button
  buttons jsonb,                               -- a card's button labels, row by row: [["Hold","Launch anyway","Cancel"]]
  who text                                     -- a tap: 'human:<first name>', or 'not on the allowlist'
);
create index telegram_log_message on telegram_log (message_id);

alter table telegram_log enable row level security;
create policy "public read" on telegram_log for select using (true);
grant select on telegram_log to anon;

-- realtime: the console's Telegram view shows each row the moment n8n writes it
alter publication supabase_realtime add table telegram_log;
