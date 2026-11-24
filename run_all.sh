#!/bin/sh
# Run the whole pipeline for Gemona 2026 tasks 2 and 3. Results go to out/ (or $WAKEFIELD_OUT).
set -e
cd "$(dirname "$0")/wakefield"
for T in T2 T3; do
  TASKID=$T python3 parse.py
  for PHI0 in 0.8 3 20 8; do TASKID=$T python3 field.py 0.15 $PHI0 > /dev/null; done
  TASKID=$T python3 field.py 0.15 8 | head -12
  TASKID=$T python3 export.py
  TASKID=$T python3 front.py
done
python3 compare.py
