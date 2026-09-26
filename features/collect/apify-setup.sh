#!/usr/bin/env bash
# Owner: Person A (see CLAUDE.md)
# Creates the Apify schedule and both run webhooks for the actor (docs/plan.md §5.1 "Apify setup").
# Needs APIFY_TOKEN and N8N_BASE_URL (see .env.example). Skips anything that already exists.
# Usage: set -a; source .env; set +a; features/collect/apify-setup.sh
set -euo pipefail
: "${APIFY_TOKEN:?}" "${N8N_BASE_URL:?}"

API=https://api.apify.com/v2
N8N=${N8N_BASE_URL%/}
api() { curl -sS --fail-with-body -m 30 -H "Authorization: Bearer $APIFY_TOKEN" -H 'Content-Type: application/json' "$@"; }

actor=$(api "$API/acts?my=true" | jq -r '.data.items[] | select(.name == "airguard-adsb-collector") | .id')
[ -n "$actor" ] || { echo "actor not found: run 'npx apify-cli push' in features/collect/actor first" >&2; exit 1; }

# every 5 min, never two runs at once, 256 MB / 120 s (about $0.0002 a run)
if api "$API/schedules" | jq -e '.data.items[] | select(.name == "airguard-adsb-every-5-min")' > /dev/null; then
  echo "schedule exists"
else
  jq -nc --arg a "$actor" '{name: "airguard-adsb-every-5-min", cronExpression: "*/5 * * * *", timezone: "UTC",
      isEnabled: true, isExclusive: true, actions: [{type: "RUN_ACTOR", actorId: $a,
      runInput: {body: "{}", contentType: "application/json; charset=utf-8"},
      runOptions: {build: "latest", timeoutSecs: 120, memoryMbytes: 256}}]}' \
    | api -X POST "$API/schedules" --data-binary @- | jq -r '"schedule created: \(.data.id)"'
fi

hook() { # <event types as JSON> <n8n webhook path>
  if api "$API/webhooks" | jq -e --arg u "$N8N/webhook/$2" '.data.items[] | select(.requestUrl == $u)' > /dev/null; then
    echo "webhook $2 exists"
  else
    jq -nc --arg a "$actor" --arg u "$N8N/webhook/$2" --argjson e "$1" '{eventTypes: $e, condition: {actorId: $a}, requestUrl: $u}' \
      | api -X POST "$API/webhooks" --data-binary @- | jq -r --arg p "$2" '"webhook \($p) created: \(.data.id)"'
  fi
}
hook '["ACTOR.RUN.SUCCEEDED"]' airguard-apify                             # → WF1 Collect
hook '["ACTOR.RUN.FAILED", "ACTOR.RUN.TIMED_OUT"]' airguard-apify-failed   # → WF4 Heal
