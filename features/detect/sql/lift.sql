-- WF2 step 2 (plan §5.4). MAY-LIFT after 30 quiet minutes. "Quiet" only counts with coverage
-- (>= 5 checks with n_total >= 3, or a NORMAL drone report), because UNKNOWN is never clean.
-- No bad drone report in the last 60 min either (the window detect.sql re-arms on).
-- Notification only: sorties are NOT touched.
update incidents i set status = 'may_lift', may_lift_at = now()
where i.status = 'open' and i.opened_at < now() - interval '30 minutes'
  and ((select count(*) from observations o
        where o.cell_id = i.cell_id and o.ts > now() - interval '30 minutes' and o.n_total >= 3) >= 5
    or exists (select 1 from drone_reports d
        where d.cell_id = i.cell_id and d.ts > now() - interval '30 minutes' and d.verdict = 'NORMAL'))
  and not exists (select 1 from observations o left join baselines b using (cell_id)
       where o.cell_id = i.cell_id and o.ts > now() - interval '30 minutes'
         and ((i.type = 'JAMMED' and o.ratio >= coalesce(b.threshold, 0.3))
           or (i.type = 'SPOOF'  and o.n_spoof >= 2)))
  and not exists (select 1 from drone_reports d
       where d.cell_id = i.cell_id and d.ts > now() - interval '60 minutes' and d.verdict = i.type)
returning *;
