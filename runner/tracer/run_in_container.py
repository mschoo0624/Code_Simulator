#!/usr/bin/env python3
"""
run_in_container.py — container entrypoint.

Reads {"language", "solution", "driver"} as JSON from stdin, compiles the two
panes as ONE translation unit (main_tu includes both files so diagnostics and
debug info keep real filenames/lines), runs the GDB tracer, and prints a Trace
JSON object to stdout. Everything else goes to stderr.
"""
import json
import os
import re
import subprocess
import sys

WORK = "/work"
COMPILE_TIMEOUT_S = 10
GDB_TIMEOUT_S = 11  # tracer self-limits at 8 s wall; this is the hard stop
OUTPUT_CAP = 4096

COMMON_FLAGS = [
    "-g", "-O0", "-fno-inline", "-fno-omit-frame-pointer",
    "-fno-optimize-sibling-calls", "-Wall", "-Wextra",
    "-fdiagnostics-format=json",
]


def fail(message):
    json.dump({"error": message}, sys.stdout)
    sys.exit(1)


def read_capped(path, cap=OUTPUT_CAP):
    try:
        with open(path, "rb") as f:
            return f.read(cap).decode("utf-8", "replace")
    except OSError:
        return ""


def parse_diagnostics(stderr_text):
    """Parse gcc -fdiagnostics-format=json output; fall back to regex."""
    diags = []

    def add(kind, message, file, line, col):
        severity = {"error": "error", "fatal error": "error",
                    "warning": "warning", "note": "note"}.get(kind, "error")
        diags.append({
            "file": os.path.basename(file or ""),
            "line": int(line or 0),
            "col": int(col or 0),
            "severity": severity,
            "message": message,
        })

    def walk(entries):
        for d in entries:
            if not isinstance(d, dict):
                continue
            loc = {}
            locations = d.get("locations") or []
            if locations:
                loc = locations[0].get("caret") or {}
            add(d.get("kind", "error"), d.get("message", ""),
                loc.get("file"), loc.get("line"), loc.get("column"))
            walk(d.get("children") or [])

    parsed_json = False
    for raw_line in stderr_text.splitlines():
        raw_line = raw_line.strip()
        if raw_line.startswith("["):
            try:
                walk(json.loads(raw_line))
                parsed_json = True
            except json.JSONDecodeError:
                pass
    if not parsed_json:
        pattern = re.compile(
            r"^([^:\s][^:]*):(\d+):(\d+):\s+(error|warning|note|fatal error):\s+(.*)$")
        for raw_line in stderr_text.splitlines():
            m = pattern.match(raw_line)
            if m:
                add(m.group(4), m.group(5), m.group(1), m.group(2), m.group(3))
    return diags


def main():
    try:
        req = json.load(sys.stdin)
    except json.JSONDecodeError:
        return fail("invalid request JSON")

    lang = req.get("language")
    if lang not in ("c", "cpp"):
        return fail("language must be 'c' or 'cpp'")
    solution = req.get("solution")
    driver = req.get("driver")
    if not isinstance(solution, str) or not isinstance(driver, str):
        return fail("solution and driver must be strings")

    ext = "c" if lang == "c" else "cpp"
    sol_name = "solution." + ext
    drv_name = "driver." + ext
    tu_name = "main_tu." + ext

    for name, content in ((sol_name, solution), (drv_name, driver)):
        with open(os.path.join(WORK, name), "w") as f:
            f.write(content if content.endswith("\n") else content + "\n")
    with open(os.path.join(WORK, tu_name), "w") as f:
        f.write('#include "%s"\n#include "%s"\n' % (sol_name, drv_name))

    if lang == "c":
        cmd = ["gcc", "-std=c17"] + COMMON_FLAGS + ["-o", "a.out", tu_name]
    else:
        cmd = ["g++", "-std=c++20"] + COMMON_FLAGS + ["-o", "a.out", tu_name]

    trace = {
        "language": lang,
        "solutionFile": sol_name,
        "truncated": False,
        "compile": {"ok": False, "diagnostics": []},
        "stdout": "",
        "stderr": "",
        "exitCode": None,
        "steps": [],
    }

    try:
        comp = subprocess.run(cmd, cwd=WORK, capture_output=True, text=True,
                              timeout=COMPILE_TIMEOUT_S)
    except subprocess.TimeoutExpired:
        trace["compile"]["diagnostics"] = [{
            "file": sol_name, "line": 1, "col": 1, "severity": "error",
            "message": "compilation timed out after %ds" % COMPILE_TIMEOUT_S,
        }]
        json.dump(trace, sys.stdout)
        return None

    diags = parse_diagnostics(comp.stderr)
    if comp.returncode != 0 and not any(d["severity"] == "error" for d in diags):
        diags.append({
            "file": sol_name, "line": 1, "col": 1, "severity": "error",
            "message": (comp.stderr or "compilation failed")[:2000],
        })
    trace["compile"] = {"ok": comp.returncode == 0, "diagnostics": diags}
    if comp.returncode != 0:
        json.dump(trace, sys.stdout)
        return None

    env = os.environ.copy()
    env.update({
        "TRACER_WORK": WORK,
        "TRACER_SOLUTION": sol_name,
        "TRACER_DRIVER": drv_name,
    })
    gdb_timed_out = False
    try:
        subprocess.run(
            ["gdb", "-q", "-batch", "-x", "/opt/gdb_tracer.py",
             os.path.join(WORK, "a.out")],
            cwd=WORK, env=env, capture_output=True, text=True,
            timeout=GDB_TIMEOUT_S)
    except subprocess.TimeoutExpired:
        gdb_timed_out = True

    part = {}
    try:
        with open(os.path.join(WORK, "trace.json")) as f:
            part = json.load(f)
    except (OSError, json.JSONDecodeError):
        part = {}

    trace["steps"] = part.get("steps", [])
    trace["truncated"] = bool(part.get("truncated", False)) or gdb_timed_out
    reason = part.get("truncatedReason")
    if gdb_timed_out and not reason:
        reason = "wall_time"
    if reason:
        trace["truncatedReason"] = reason
    trace["exitCode"] = part.get("exitCode")
    if part.get("signal"):
        trace["signal"] = part["signal"]
    if part.get("leaks") is not None:
        trace["leaks"] = part["leaks"]
    trace["stdout"] = read_capped(os.path.join(WORK, "stdout.txt"))
    trace["stderr"] = read_capped(os.path.join(WORK, "stderr.txt"))

    json.dump(trace, sys.stdout)
    return None


if __name__ == "__main__":
    main()
