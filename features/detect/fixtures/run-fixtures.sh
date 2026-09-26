#!/usr/bin/env bash
# C2: runs detect_fixture.sql against SUPABASE_DB_URL (from the environment or .env) with psql.
# Only test cell 89.5_179.5. Exits non-zero on the first failing check. Cleans up on exit.
# Usage: bash features/detect/fixtures/run-fixtures.sh     (PSQL=/path/to/psql to override)
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../../.." && pwd)"
if [ -z "${SUPABASE_DB_URL:-}" ] && [ -f "$root/.env" ]; then
  SUPABASE_DB_URL="$(grep -E '^SUPABASE_DB_URL=' "$root/.env" | head -1 | cut -d= -f2- | tr -d '\r')"
fi
: "${SUPABASE_DB_URL:?set SUPABASE_DB_URL or put it in .env}"
PSQL="${PSQL:-psql}"
null=/dev/null; [ "${OS:-}" = "Windows_NT" ] && null=NUL   # native Windows psql has no /dev/null

cleanup() {
  "$PSQL" "$SUPABASE_DB_URL" -X -q -v ON_ERROR_STOP=1 -c "
    delete from decisions where incident_id in (select id from incidents where cell_id = '89.5_179.5');
    delete from observations where cell_id = '89.5_179.5';
    delete from incidents    where cell_id = '89.5_179.5';
    delete from baselines    where cell_id = '89.5_179.5';" && echo "cleanup: test cell 89.5_179.5 is empty"
}
trap cleanup EXIT

cd "$here"
"$PSQL" "$SUPABASE_DB_URL" -X -v null="$null" -f detect_fixture.sql
