-- WF2 step 3 (plan §5.4). Close after 2 h of MAY-LIFT. Sorties are NOT touched: a HOLD stays until a human lifts it.
update incidents set status = 'closed', closed_at = now()
where status = 'may_lift' and may_lift_at < now() - interval '2 hours' returning *;
