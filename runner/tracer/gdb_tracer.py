"""
gdb_tracer.py — runs inside `gdb -q -batch -x gdb_tracer.py ./a.out`.

Steps through the inferior, records a Step only when the current frame is in
the solution file, serializes locals into the Value model, and writes a
partial Trace JSON to $TRACER_WORK/trace.json (incrementally, so the
orchestrator can salvage it if GDB has to be killed).

Configuration comes from environment variables:
  TRACER_WORK      working dir (default /work)
  TRACER_SOLUTION  solution file basename, e.g. solution.c
  TRACER_DRIVER    driver file basename, e.g. driver.c
"""
import glob
import json
import os
import re
import signal as signal_mod
import sys
import threading
import time

import gdb

WORK = os.environ.get("TRACER_WORK", "/work")
SOLUTION_FILE = os.environ.get("TRACER_SOLUTION", "solution.c")
DRIVER_FILE = os.environ.get("TRACER_DRIVER", "driver.c")

MAX_STEPS = int(os.environ.get("TRACER_MAX_STEPS", "600"))
MAX_WALL_S = float(os.environ.get("TRACER_MAX_WALL", "8"))
MAX_DEPTH = 40
MAX_ARRAY = 50
MAX_NODES = 40
MAX_STR = 64
MAX_STRUCT_DEPTH = 3
STEP_BUDGET = 50000
DUMP_EVERY = 25
DEBUG = os.environ.get("TRACER_DEBUG") == "1"
CAPTURE_RETURNS = os.environ.get("TRACER_RETURNS", "1") != "0"


def dbg(msg):
    if DEBUG:
        sys.stderr.write("[tracer] %s\n" % msg)
        sys.stderr.flush()


RVALUE_REF = getattr(gdb, "TYPE_CODE_RVALUE_REF", None)

# ---------------------------------------------------------------------------
# allocation table (fed by the LD_PRELOAD shim's log)
# ---------------------------------------------------------------------------


class AllocTable:
    def __init__(self, path):
        self.path = path
        self.offset = 0
        self.blocks = {}  # int addr -> {"size": int, "live": bool, "caller": int}

    def refresh(self):
        try:
            with open(self.path, "rb") as f:
                f.seek(self.offset)
                data = f.read()
                self.offset += len(data)
        except OSError:
            return
        for line in data.decode("ascii", "replace").splitlines():
            parts = line.split()
            if not parts:
                continue
            try:
                op = parts[0]
                if op in ("m", "c") and len(parts) >= 3:
                    caller = int(parts[3], 16) if len(parts) > 3 else 0
                    self.blocks[int(parts[1], 16)] = {
                        "size": int(parts[2]), "live": True, "caller": caller,
                    }
                elif op == "r" and len(parts) >= 4:
                    old, new, size = int(parts[1], 16), int(parts[2], 16), int(parts[3])
                    caller = int(parts[4], 16) if len(parts) > 4 else 0
                    if old and old != new and old in self.blocks:
                        self.blocks[old]["live"] = False
                    self.blocks[new] = {"size": size, "live": True, "caller": caller}
                elif op == "f" and len(parts) >= 2:
                    addr = int(parts[1], 16)
                    if addr in self.blocks:
                        self.blocks[addr]["live"] = False
            except (ValueError, IndexError):
                continue

    def find(self, addr):
        """Return (block_start, block, byte_offset) or (None, None, None)."""
        blk = self.blocks.get(addr)
        if blk is not None:
            return addr, blk, 0
        for start, b in self.blocks.items():
            if start < addr < start + b["size"]:
                return start, b, addr - start
        return None, None, None


ALLOC = AllocTable(os.path.join(WORK, "alloc.log"))

# ---------------------------------------------------------------------------
# value serialization
# ---------------------------------------------------------------------------


def type_name(t):
    try:
        return str(t)
    except Exception:
        return "?"


def safe_repr(val, limit=120):
    try:
        return str(val)[:limit]
    except Exception:
        return "<unreadable>"


def is_char_type(t):
    try:
        return t.code == gdb.TYPE_CODE_INT and t.sizeof == 1 and "char" in (t.name or "")
    except Exception:
        return False


def new_ctx(regions):
    return {"regions": regions, "nodes": [0]}


def serialize(val, ctx):
    return _ser(val, ctx, set(), 0)


def _ser(val, ctx, visited, sdepth):
    try:
        if val.is_optimized_out:
            return {"k": "unknown", "repr": "<optimized out>"}
        t = val.type.strip_typedefs()
    except Exception:
        return {"k": "unknown", "repr": "<unreadable>"}
    try:
        code = t.code
        if code == gdb.TYPE_CODE_REF or (RVALUE_REF is not None and code == RVALUE_REF):
            return _ser(val.referenced_value(), ctx, visited, sdepth)
        if code in (gdb.TYPE_CODE_STRUCT, gdb.TYPE_CODE_UNION):
            viz = None
            try:
                viz = gdb.default_visualizer(val)
            except Exception:
                viz = None
            if viz is not None:
                return _ser_visualized(val, viz, ctx, visited, sdepth)
            return _ser_struct(val, t, ctx, visited, sdepth)
        if code == gdb.TYPE_CODE_BOOL:
            return {"k": "bool", "v": bool(val)}
        if code == gdb.TYPE_CODE_INT:
            iv = int(val)
            if is_char_type(t):
                b = iv & 0xFF
                ch = chr(b) if 32 <= b < 127 else "\\x%02x" % b
                return {"k": "char", "v": ch, "code": iv}
            return {"k": "int", "t": type_name(val.type),
                    "v": iv if abs(iv) <= 2 ** 53 else str(iv)}
        if code == gdb.TYPE_CODE_ENUM:
            return {"k": "int", "t": type_name(val.type), "v": int(val)}
        if code == gdb.TYPE_CODE_FLT:
            fv = float(val)
            if fv != fv or fv in (float("inf"), float("-inf")):
                return {"k": "unknown", "repr": repr(fv)}
            return {"k": "float", "t": type_name(val.type), "v": fv}
        if code == gdb.TYPE_CODE_ARRAY:
            return _ser_array(val, t, ctx, visited, sdepth)
        if code == gdb.TYPE_CODE_PTR:
            return _ser_ptr(val, t, ctx, visited, sdepth)
        return {"k": "unknown", "repr": safe_repr(val)}
    except (gdb.MemoryError, gdb.error, ValueError, OverflowError, RuntimeError):
        return {"k": "unknown", "repr": "<unreadable>"}


def _read_c_string(addr, limit=MAX_STR):
    inf = gdb.selected_inferior()
    raw = bytes(inf.read_memory(addr, limit + 1))
    nul = raw.find(b"\x00")
    data = raw[:nul] if nul >= 0 else raw[:limit]
    return data.decode("utf-8", "replace"), (nul < 0)


def _ser_array(val, t, ctx, visited, sdepth):
    et = t.target().strip_typedefs()
    lo, hi = t.range()
    n = hi - lo + 1
    tn = type_name(val.type)
    if is_char_type(et):
        try:
            inf = gdb.selected_inferior()
            raw = bytes(inf.read_memory(int(val.address), min(n, MAX_STR)))
            nul = raw.find(b"\x00")
            s = (raw[:nul] if nul >= 0 else raw).decode("utf-8", "replace")
            return {"k": "str", "t": tn, "v": s}
        except Exception:
            return {"k": "unknown", "repr": "<unreadable char array>"}
    items = []
    cap = min(n, MAX_ARRAY)
    for i in range(cap):
        items.append(_ser(val[lo + i], ctx, visited, sdepth + 1))
    out = {"k": "array", "t": tn, "len": n, "items": items, "source": "stack"}
    if n > cap:
        out["truncated"] = True
    return out


def _region_hit(ctx, addr):
    for r in ctx["regions"]:
        if r["start"] <= addr < r["start"] + r["size"]:
            return r
    return None


def _ser_ptr(val, t, ctx, visited, sdepth):
    addr = int(val)
    if addr == 0:
        return {"k": "null"}
    tn = type_name(val.type)
    tt = t.target().strip_typedefs()

    # char* -> string
    if is_char_type(tt):
        try:
            s, truncated = _read_c_string(addr)
            return {"k": "str", "t": tn, "v": s}
        except Exception:
            return {"k": "ptr", "t": tn, "addr": hex(addr), "invalid": True}

    if addr in visited:
        return {"k": "ref", "addr": hex(addr)}

    out = {"k": "ptr", "t": tn, "addr": hex(addr)}
    esz = 1
    try:
        esz = max(1, tt.sizeof)
    except Exception:
        pass

    start, blk, byte_off = ALLOC.find(addr)
    if blk is not None:
        out["alloc"] = {"size": blk["size"], "live": blk["live"]}
        if byte_off != 0:
            out["base"] = hex(start)
            out["offset"] = byte_off // esz
            return out
    else:
        region = _region_hit(ctx, addr)
        if region is not None and addr != region["start"]:
            out["base"] = region["name"]
            out["offset"] = (addr - region["start"]) // region["esz"]
            return out

    if tt.code == gdb.TYPE_CODE_VOID:
        return out

    # pointer at the start of a live heap block of scalars -> heap array target
    if (blk is not None and blk["live"] and byte_off == 0
            and tt.code not in (gdb.TYPE_CODE_STRUCT, gdb.TYPE_CODE_UNION)):
        n = max(1, blk["size"] // esz)
        cap = min(n, MAX_ARRAY)
        items = []
        try:
            for i in range(cap):
                items.append(_ser((val + i).dereference(), ctx, visited, sdepth + 1))
        except (gdb.MemoryError, gdb.error):
            out["invalid"] = True
            return out
        target = {"k": "array", "t": type_name(tt), "len": n, "items": items,
                  "source": "heap"}
        if n > cap:
            target["truncated"] = True
        out["target"] = target
        return out

    # pointer to struct/union: follow the node graph (lists, trees)
    if tt.code in (gdb.TYPE_CODE_STRUCT, gdb.TYPE_CODE_UNION):
        if blk is not None and not blk["live"]:
            return out  # freed: do not read
        if ctx["nodes"][0] >= MAX_NODES:
            return out
        ctx["nodes"][0] += 1
        visited = visited | {addr}
        try:
            # a followed node starts a fresh struct-nesting budget; the chain
            # itself is bounded by MAX_NODES, cycles by `visited`
            out["target"] = _ser(val.dereference(), ctx, visited, 0)
        except (gdb.MemoryError, gdb.error):
            out["invalid"] = True
        return out

    # plain pointer to a scalar (e.g. int* returnSize): show the single target
    if ctx["nodes"][0] < MAX_NODES:
        ctx["nodes"][0] += 1
        try:
            out["target"] = _ser(val.dereference(), ctx, visited | {addr}, 0)
        except (gdb.MemoryError, gdb.error):
            out["invalid"] = True
    return out


def _ser_struct(val, t, ctx, visited, sdepth):
    if sdepth > MAX_STRUCT_DEPTH:
        return {"k": "unknown", "repr": "<nested too deep>"}
    fields = {}
    for f in t.fields():
        if f.artificial or f.is_base_class or not f.name:
            continue
        try:
            fields[f.name] = _ser(val[f.name], ctx, visited, sdepth + 1)
        except (gdb.MemoryError, gdb.error):
            fields[f.name] = {"k": "unknown", "repr": "<unreadable>"}
    return {"k": "struct", "t": type_name(val.type), "fields": fields}


def _ser_visualized(val, viz, ctx, visited, sdepth):
    tn = type_name(val.type)
    hint = None
    try:
        if callable(getattr(viz, "display_hint", None)):
            hint = viz.display_hint()
    except Exception:
        hint = None
    try:
        if hint == "string":
            return {"k": "str", "t": tn, "v": str(viz.to_string())[:MAX_STR]}
        if hint == "array":
            items = []
            truncated = False
            count = 0
            for _name, child in viz.children():
                if count >= MAX_ARRAY:
                    truncated = True
                    break
                items.append(_ser(child, ctx, visited, sdepth + 1))
                count += 1
            length = count
            try:
                m = re.search(r"of length (\d+)", str(viz.to_string() or ""))
                if m:
                    length = int(m.group(1))
                    truncated = truncated or length > len(items)
            except Exception:
                pass
            out = {"k": "array", "t": tn, "len": length, "items": items,
                   "source": "stl"}
            if truncated:
                out["truncated"] = True
            return out
        if hint == "map":
            fields = {}
            key_repr = None
            count = 0
            for _name, child in viz.children():
                if count >= 2 * MAX_ARRAY:
                    break
                if key_repr is None:
                    key_repr = safe_repr(child, 40)
                else:
                    fields[key_repr] = _ser(child, ctx, visited, sdepth + 1)
                    key_repr = None
                count += 1
            return {"k": "struct", "t": tn, "fields": fields}
        return {"k": "unknown", "repr": str(viz.to_string())[:120]}
    except Exception:
        return {"k": "unknown", "repr": safe_repr(val)}


# ---------------------------------------------------------------------------
# frame helpers
# ---------------------------------------------------------------------------


def frame_depth(frame):
    d = 0
    f = frame
    while f is not None:
        d += 1
        try:
            f = f.older()
        except gdb.error:
            break
    return d


def frame_source_basename(frame):
    try:
        sal = frame.find_sal()
        if sal and sal.symtab:
            return os.path.basename(sal.symtab.filename), sal.line
    except gdb.error:
        pass
    return None, None


def frame_key(frame):
    try:
        sp = int(frame.read_register("sp"))
    except (gdb.error, ValueError):
        sp = 0
    name = frame.name() or "??"
    return (name, sp)


def collect_locals(frame, cur_line, sticky_shown):
    """Collect visible locals/arguments of `frame` as serialized Values."""
    key = frame_key(frame)
    shown = sticky_shown.setdefault(key, set())
    syms = {}
    try:
        block = frame.block()
    except RuntimeError:
        return {}
    b = block
    while b is not None:
        for sym in b:
            if not (sym.is_argument or sym.is_variable):
                continue
            if sym.name not in syms:  # innermost shadows outer
                syms[sym.name] = sym
        if b.function is not None:
            break
        b = b.superblock

    # Pre-pass: stack-array regions in this frame, for pointer base/offset.
    regions = []
    for name, sym in syms.items():
        try:
            st = sym.type.strip_typedefs()
            if st.code == gdb.TYPE_CODE_ARRAY:
                v = sym.value(frame)
                if v.address is not None:
                    et = st.target().strip_typedefs()
                    regions.append({
                        "name": name,
                        "start": int(v.address),
                        "size": st.sizeof,
                        "esz": max(1, et.sizeof),
                    })
        except Exception:
            continue

    out = {}
    for name, sym in syms.items():
        decl_line = getattr(sym, "line", 0) or 0
        visible = sym.is_argument or (0 < decl_line < cur_line) or name in shown
        if not visible:
            continue
        try:
            v = sym.value(frame)
        except gdb.error:
            continue
        out[name] = serialize(v, new_ctx(regions))
        shown.add(name)
    return out


def _items_of(sv):
    if not isinstance(sv, dict):
        return None
    if sv.get("k") == "array":
        return sv.get("items")
    if sv.get("k") == "ptr":
        tgt = sv.get("target")
        if isinstance(tgt, dict) and tgt.get("k") == "array":
            return tgt.get("items")
    return None


def diff_indices(prev, cur):
    a, b = _items_of(prev), _items_of(cur)
    if a is None or b is None:
        return []
    idxs = []
    for i in range(min(len(a), len(b))):
        if a[i] != b[i]:
            idxs.append(i)
    for i in range(min(len(a), len(b)), max(len(a), len(b))):
        idxs.append(i)
    return idxs


# ---------------------------------------------------------------------------
# tracing session
# ---------------------------------------------------------------------------


class Tracer:
    def __init__(self):
        self.steps = []
        self.sticky_shown = {}   # frame_key -> set of shown local names
        self.last_locals = {}    # frame_key -> previous serialized locals
        self.pending_returns = []
        self.truncated = False
        self.truncated_reason = None
        self.exited = False
        self.exit_code = None
        self.signal = None
        self.exe_ranges = []
        self.done = False
        self.watchdog_fired = False

    # -- watchdog -----------------------------------------------------------
    # A single `step` can block forever, e.g. in `while (1) { x = x + 1; }`
    # the whole loop is one source line, so `step` never reaches a *different*
    # line and never returns. The watchdog SIGINTs the inferior after the wall
    # budget so the blocking gdb.execute("step") comes back; the main loop
    # then treats that SIGINT as `wall_time` truncation, not a crash.
    def start_watchdog(self, inferior_pid, deadline):
        def loop():
            while not self.done:
                if time.time() > deadline:
                    self.watchdog_fired = True
                    try:
                        os.kill(inferior_pid, signal_mod.SIGINT)
                    except OSError:
                        return
                    time.sleep(0.5)  # re-fire in case a SIGINT was consumed
                else:
                    time.sleep(0.1)

        t = threading.Thread(target=loop, daemon=True)
        t.start()

    # -- events -----------------------------------------------------------
    def on_exited(self, event):
        self.exited = True
        self.exit_code = getattr(event, "exit_code", None)

    def on_stop(self, event):
        if isinstance(event, gdb.SignalEvent):
            self.signal = event.stop_signal

    # -- setup ------------------------------------------------------------
    def configure(self):
        gdb.execute("set pagination off")
        gdb.execute("set confirm off")
        gdb.execute("set print elements 200")
        gdb.execute("set auto-load safe-path /")
        try:
            gdb.execute("set disable-randomization off")
        except gdb.error:
            pass  # tolerate seccomp-related warnings
        for pattern in ("/usr/include/*", "/usr/lib/gcc/*", "/usr/lib/*"):
            try:
                gdb.execute("skip -gfi %s" % pattern, to_string=True)
            except gdb.error:
                pass
        self.load_pretty_printers()
        gdb.execute("set environment LD_PRELOAD /opt/alloc_shim.so")
        gdb.execute("set environment ALLOC_LOG %s/alloc.log" % WORK)
        gdb.events.exited.connect(self.on_exited)
        gdb.events.stop.connect(self.on_stop)

    def load_pretty_printers(self):
        for cand in glob.glob("/usr/share/gcc*/python"):
            if os.path.isdir(os.path.join(cand, "libstdcxx")):
                sys.path.insert(0, cand)
                try:
                    from libstdcxx.v6.printers import register_libstdcxx_printers
                    register_libstdcxx_printers(None)
                except Exception:
                    pass
                break

    def read_exe_ranges(self):
        try:
            text = gdb.execute("info proc mappings", to_string=True)
        except gdb.error:
            return
        for line in text.splitlines():
            parts = line.split()
            if len(parts) >= 5 and parts[0].startswith("0x"):
                objfile = parts[-1]
                if objfile.endswith("/a.out") or objfile.endswith("\\a.out"):
                    try:
                        self.exe_ranges.append((int(parts[0], 16), int(parts[1], 16)))
                    except ValueError:
                        continue

    # -- recording ----------------------------------------------------------
    def classify_event(self, depth):
        if not self.steps:
            return "call"
        prev = self.steps[-1]["stackDepth"]
        if depth > prev:
            return "call"
        if depth < prev:
            return "return"
        return "line"

    def record(self, frame, line, event=None, error=None):
        depth = frame_depth(frame)
        if depth > MAX_DEPTH:
            self.truncate("call_depth")
            return False
        ALLOC.refresh()
        locals_ = collect_locals(frame, line, self.sticky_shown)
        key = frame_key(frame)
        prev = self.last_locals.get(key)
        changed = []
        changed_indices = {}
        if prev is not None:
            for name, cur in locals_.items():
                pv = prev.get(name)
                if pv is None or pv != cur:
                    changed.append(name)
                idxs = diff_indices(pv, cur)
                if idxs:
                    changed_indices[name] = idxs
        self.last_locals[key] = locals_

        ev = event or self.classify_event(depth)
        step = {
            "idx": len(self.steps),
            "event": ev,
            "line": line,
            "func": frame.name() or "??",
            "stackDepth": depth,
            "locals": locals_,
            "changed": changed,
            "changedIndices": changed_indices,
        }
        if error:
            step["error"] = error
        if ev == "return" and self.pending_returns:
            rv = self.pending_returns.pop()
            if rv is not None:
                step["returnValue"] = rv
        if ev == "call":
            self.arm_finish_breakpoint(frame)
        self.steps.append(step)
        if len(self.steps) % DUMP_EVERY == 0:
            self.dump()
        if len(self.steps) >= MAX_STEPS:
            self.truncate("step_limit")
            return False
        return True

    def arm_finish_breakpoint(self, frame):
        if not CAPTURE_RETURNS:
            return
        tracer = self

        try:
            class _RetFB(gdb.FinishBreakpoint):
                def __init__(self):
                    super().__init__(frame, internal=True)

                def stop(self):
                    try:
                        if self.return_value is not None:
                            tracer.pending_returns.append(
                                serialize(self.return_value, new_ctx([])))
                    except Exception:
                        pass
                    return False

                def out_of_scope(self):
                    pass

            _RetFB()
        except Exception:
            pass  # best effort; documented in DECISIONS.md

    def record_exception(self):
        """SIGSEGV & friends: record an `exception` step at the nearest
        solution-file frame."""
        try:
            frame = gdb.selected_frame()
        except gdb.error:
            return
        f = frame
        while f is not None:
            base, line = frame_source_basename(f)
            if base == SOLUTION_FILE:
                try:
                    f.select()
                except gdb.error:
                    pass
                self.record(f, line, event="exception", error=self.signal)
                return
            try:
                f = f.older()
            except gdb.error:
                break
        # no solution frame: record against the innermost frame we have
        base, line = frame_source_basename(frame)
        self.record(frame, line or 0, event="exception", error=self.signal)

    def truncate(self, reason):
        if not self.truncated:
            self.truncated = True
            self.truncated_reason = reason

    # -- main loop ----------------------------------------------------------
    def run(self):
        self.configure()
        gdb.execute("tbreak main")
        try:
            gdb.execute("run > %s/stdout.txt 2> %s/stderr.txt < /dev/null"
                        % (WORK, WORK), to_string=True)
        except gdb.error:
            pass
        if self.exited:
            self.dump()
            return
        self.read_exe_ranges()

        start = time.time()
        try:
            inferior_pid = gdb.selected_inferior().pid
        except gdb.error:
            inferior_pid = 0
        if inferior_pid:
            self.start_watchdog(inferior_pid, start + MAX_WALL_S)
        ops = 0
        while True:
            if self.exited:
                break
            if self.watchdog_fired or time.time() - start > MAX_WALL_S:
                self.truncate("wall_time")
                break
            if ops >= STEP_BUDGET:
                self.truncate("step_budget")
                break
            ops += 1
            dbg("op %d: step (recorded=%d)" % (ops, len(self.steps)))
            try:
                gdb.execute("step", to_string=True)
            except gdb.error as e:
                dbg("step error: %s" % e)
                break
            if self.exited:
                break
            if self.signal:
                if self.signal == "SIGINT" and self.watchdog_fired:
                    self.truncate("wall_time")
                else:
                    self.record_exception()
                break
            try:
                frame = gdb.selected_frame()
            except gdb.error:
                break
            base, line = frame_source_basename(frame)
            dbg("stopped at %s:%s depth=?" % (base, line))
            if base == SOLUTION_FILE and line:
                if not self.record(frame, line):
                    break
            elif base == DRIVER_FILE:
                continue  # step silently through driver code
            else:
                # outside both files (library without skip coverage): escape
                try:
                    gdb.execute("finish", to_string=True)
                except gdb.error:
                    pass
                if self.signal:
                    if self.signal == "SIGINT" and self.watchdog_fired:
                        self.truncate("wall_time")
                    else:
                        self.record_exception()
                    break

        self.finish_up()

    def finish_up(self):
        self.done = True
        ALLOC.refresh()
        if self.signal == "SIGINT" and self.watchdog_fired:
            self.signal = None  # watchdog artifact, not a program signal
        self.dump()
        try:
            if gdb.selected_inferior().pid:
                gdb.execute("kill", to_string=True)
        except gdb.error:
            pass

    def leaks(self):
        out = []
        for addr in sorted(ALLOC.blocks):
            b = ALLOC.blocks[addr]
            if not b["live"]:
                continue
            caller = b.get("caller", 0)
            if self.exe_ranges and not any(lo <= caller < hi
                                           for lo, hi in self.exe_ranges):
                continue
            out.append({"addr": hex(addr), "size": b["size"]})
        return out

    def dump(self):
        data = {
            "truncated": self.truncated,
            "truncatedReason": self.truncated_reason,
            "exitCode": self.exit_code,
            "signal": self.signal,
            "leaks": self.leaks(),
            "steps": self.steps,
        }
        tmp = os.path.join(WORK, "trace.json.tmp")
        final = os.path.join(WORK, "trace.json")
        try:
            with open(tmp, "w") as f:
                json.dump(data, f, default=lambda o: str(o))
            os.replace(tmp, final)
        except OSError:
            pass


def main():
    tracer = Tracer()
    try:
        tracer.run()
    except Exception as exc:  # the tracer must never crash without a dump
        sys.stderr.write("tracer error: %r\n" % (exc,))
        tracer.truncate("tracer_error")
        tracer.finish_up()


main()
