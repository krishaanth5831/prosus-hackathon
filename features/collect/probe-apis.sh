#!/usr/bin/env bash
# Owner: Person A (see CLAUDE.md)
# Probe both ADS-B sources with the actor's 3 query points and rules (docs/plan.md §5.1).
# Prints "source: N aircraft, M degraded" per source. Degraded = nic < 7 or nac_p < 8.
# Needs curl + jq, no keys. Exits 1 if a source returns no aircraft.
set -euo pipefail

POINTS=("56.5 21.0 250" "59.8 25.0 200" "54.5 18.5 150")

url() { # source lat lon nm
  case "$1" in
    adsb.lol) echo "https://api.adsb.lol/v2/point/$2/$3/$4" ;;
    adsb.fi)  echo "https://opendata.adsb.fi/api/v2/lat/$2/lon/$3/dist/$4" ;;
  esac
}

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
status=0

for src in adsb.lol adsb.fi; do
  : > "$tmp/$src"
  for p in "${POINTS[@]}"; do
    read -r lat lon nm <<< "$p"
    # adsb.lol answers {ac: [...]}, adsb.fi answers {aircraft: [...]}
    if ! curl -sS --fail -m 15 "$(url "$src" "$lat" "$lon" "$nm")" \
        | jq -c '(.ac // .aircraft // [])[]' >> "$tmp/$src"; then
      echo "$src @$lat,$lon: request failed" >&2
    fi
    sleep 1.5   # polite spacing, same as the actor
  done
  # same filter as the actor: has hex + position, position at most 60 s old, deduped by hex
  line=$(jq -rs --arg src "$src" '
    [.[] | select(.hex and .lat != null and (.seen_pos // 0) <= 60)] | unique_by(.hex) as $ac
    | ($ac | map(select((.nic // 99) < 7 or (.nac_p // 99) < 8)) | length) as $degraded
    | "\($src): \($ac | length) aircraft, \($degraded) degraded"' "$tmp/$src")
  echo "$line"
  case "$line" in *": 0 aircraft"*) status=1 ;; esac
done

exit "$status"
