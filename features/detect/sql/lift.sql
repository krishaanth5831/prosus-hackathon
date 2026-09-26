-- WF2 step 2 (plan §5.4). MAY-LIFT after 30 quiet minutes. "Quiet" only counts with coverage
-- (>= 5 checks with n_total >= 3), because UNKNOWN is never clean. Notification only: sorties are NOT touched.
update incidents i set status = 'may_lift', may_lift_at = now()
where i.status = 'open' and i.opened_at < now() - interval '30 minutes'
  and (select count(*) from observations o
       where o.cell_id = i.cell_id and o.ts > now() - interval '30 minutes' and o.n_total >= 3) >= 5
  and not exists (select 1 from observations o left join baselines b using (cell_id)
       where o.cell_id = i.cell_id and o.ts > now() - interval '30 minutes'
         and ((i.type = 'JAMMED' and o.ratio >= coalesce(b.threshold, 0.3))
           or (i.type = 'SPOOF'  and o.n_spoof >= 2)))
returning *;
