#!/bin/sh
# Run both implementations on Gemona 2026 tasks 2 and 3 and compare them.
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export WAKEFIELD_OUT="${WAKEFIELD_OUT:-$ROOT/out}"
mkdir -p "$WAKEFIELD_OUT"
for N in 2 3; do
  (cd "$ROOT/wakefield" && TASKID=T$N python3 parse.py > /dev/null && TASKID=T$N python3 field.py 0.15 8 > /dev/null)
  node "$ROOT/app/test/export_results.js" "$ROOT/data/gemona-2026/tasks/task$N.xctsk.txt" "$ROOT/data/gemona-2026/task$N-igc.zip" "$WAKEFIELD_OUT/js_T$N.json"
  python3 "$ROOT/tests/check_consistency.py" "$WAKEFIELD_OUT/res_T${N}_0.15_8.0.json" "$WAKEFIELD_OUT/js_T$N.json"
done
