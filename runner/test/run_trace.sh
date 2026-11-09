#!/usr/bin/env bash
# Run one trace through the runner container.
# Usage: run_trace.sh <c|cpp> <solution_file> <driver_file>
set -euo pipefail

LANGUAGE=${1:?usage: run_trace.sh <c|cpp> <solution_file> <driver_file>}
SOLUTION=${2:?missing solution file}
DRIVER=${3:?missing driver file}
IMAGE=${IMAGE:-codelens-runner}

python3 - "$LANGUAGE" "$SOLUTION" "$DRIVER" <<'PY' |
import json, sys
lang, sol, drv = sys.argv[1], sys.argv[2], sys.argv[3]
with open(sol) as f: solution = f.read()
with open(drv) as f: driver = f.read()
print(json.dumps({"language": lang, "solution": solution, "driver": driver}))
PY
docker run --rm -i \
    --network none \
    --read-only \
    --tmpfs /work:rw,exec,size=32m,mode=1777 \
    --memory 256m --memory-swap 256m \
    --cpus 1 \
    --pids-limit 128 \
    --cap-drop ALL \
    --security-opt no-new-privileges \
    "$IMAGE"
