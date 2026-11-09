# DECISIONS

Running log of implementation decisions where the spec left room (or reality disagreed).

## Milestone 1 — runner and tracer

1. **Single translation unit via two `#include`s.** `main_tu.c`/`main_tu.cpp` contains
   `#include "solution.c"` followed by `#include "driver.c"` (not the driver text pasted
   inline). This way *both* panes keep their real filenames and line numbers in debug
   info and in compiler diagnostics.

2. **Sources enter the container via stdin JSON, trace leaves via stdout JSON.**
   The container entrypoint (`/opt/run_in_container.py`) reads
   `{language, solution, driver}` from stdin and prints a `Trace` JSON object to
   stdout. No bind mounts are needed, which keeps the sandbox flags simple
   (`--read-only --tmpfs /work`) and works identically on Windows/macOS/Linux hosts.

3. **Seccomp.** Docker's default seccomp profile (post-19.03) allows `ptrace`, so GDB
   works without a custom profile. The `personality` syscall used for ASLR-off is
   avoided with `set disable-randomization off`, as specified. No `--privileged`,
   no custom profile needed so far.

4. **Visibility heuristic for locals** (uninitialized locals contain garbage): a local
   is shown only when it is an argument, OR its declaration line is strictly before the
   current line, OR it was already shown earlier in the same frame instance (sticky).
   A frame instance is identified by `(function name, frame stack pointer)`.

4a. **Struct nesting depth vs node count.** The struct-nesting cap (3) applies to
   structs *embedded inside* structs. Following a pointer resets the nesting budget:
   pointer chains are bounded by the per-value node cap (40) and cycle detection
   (`visited` → `ref`), otherwise a 4-node linked list could never show its cycle.

5. **Pointer-to-struct vs heap array.** If a pointer targets the *start* of a live heap
   block and the pointee is a scalar type, the block is rendered as a heap `array`
   (`len = blockSize / sizeof(elem)`). If the pointee is a struct/union, the pointer is
   *followed* as a node graph (linked lists/trees) even when the block size equals one
   element; a malloc'd single node is more useful as a node than as a 1-element array.

6. **`base`/`offset` encoding.** For a pointer into a *heap* block, `base` is the hex
   address of the block start. For a pointer into a *stack array in the same frame*,
   `base` is the array's variable name (more useful to renderers). `offset` is always
   in elements, not bytes.

7. **Leak detection scope.** The LD_PRELOAD shim logs the direct caller
   (`__builtin_return_address(0)`) of every allocation. `trace.leaks` only counts live
   blocks whose allocation call site lies inside the user executable (`a.out` text
   range). This excludes glibc-internal allocations (e.g. stdio buffers, which glibc
   never frees) that would otherwise produce false leaks in every run. Consequence:
   leaks made through `operator new` (which lives in libstdc++) are *not* reported in
   v1; documented as a known limitation.

8. **`changedIndices` vs zeroed heap memory.** Fresh heap pages are usually zeroed, so
   writing `0` to a freshly malloc'd cell (e.g. `dp[0] = 0`) produces no observable
   diff and that index may be missing from `changedIndices`. Tests therefore require
   indices 1..n to be marked exactly once and tolerate a missing index 0.

9. **Return values.** `gdb.FinishBreakpoint` is installed (best effort, `internal=True`,
   `stop()` returns `False`) when a recorded step enters a solution function. The
   captured value is attached to the next recorded step classified `return`. If the
   function returns straight into the driver, no `return` step is recorded in the
   solution file and the value is dropped — acceptable per spec ("omit if unreliable").

10. **First recorded step of a frame instance** has `changed: []` (there is no previous
    step in that frame to differ from). On later steps, a variable *appearing* for the
    first time (e.g. `dp` after `malloc`) is reported in `changed`.

11. **Infinite-loop budget.** Tracer enforces 600 recorded steps, 8 s wall time, and a
    50 000 total `step`-operation budget (protects against infinite loops in *driver*
    code, which records nothing). Additionally, a single GDB `step` command can block
    forever: `step` only returns when the PC reaches a *different* source line, so a
    one-line loop like `while (1) { x = x + 1; }` never completes a step. A watchdog
    thread therefore SIGINTs the inferior when the wall budget expires; the tracer
    recognizes its own watchdog SIGINT and reports `truncated: wall_time` instead of
    an exception step. (Side effect: a program that handles/raises SIGINT itself at
    exactly the deadline would be mis-reported as truncated — acceptable for v1.)
    The orchestrator additionally kills GDB after 11 s and salvages the incrementally
    dumped `trace.json` (written every 25 steps). End-to-end time for the
    infinite-loop fixture is typically under 12 s; the test asserts < 15 s to absorb
    Docker Desktop (Windows) startup variance.

12. **Pretty-printers.** The Dockerfile verifies at build time that
    `print v` on a `std::vector` yields `std::vector of length …` under GDB (via the
    distro's auto-load scripts). The tracer additionally tries an explicit
    `register_libstdcxx_printers(None)` from a globbed `/usr/share/gcc*/python` path,
    wrapped in try/except.

13. **Recursion fixture language.** The M1 recursion acceptance test uses C fibonacci
    (the C++ preset arrives with the UI milestone); what is being tested is
    `stackDepth` bookkeeping, which is language independent.

## Milestone 2–6 — API, annotation, UI, hardening

14. **Sandbox hard-kill budget is 25 s, not 12 s.** The in-container pipeline can
    legitimately take compile (≤10 s) + GDB (≤11 s) ≈ 21 s in the worst case while
    still producing a graceful, structured result. A 12 s hard kill would destroy
    that result and return a raw timeout instead. Typical runs finish in 1–12 s;
    the 25 s ceiling only matters for pathological inputs, which still end cleanly.

15. **`/api/annotate` prefers the server-side cached trace.** The endpoint accepts
    `{language, solution, driver, trace?}`; if the trace for that exact input is in
    the server cache (it always is right after `/api/trace`), the inline `trace` is
    unnecessary. This keeps request bodies within the 200 KB cap even for large
    traces. An inline trace is honored when the cache has evicted the entry.

16. **Compose mounts the Docker socket into the API container** so the API can spawn
    sibling runner containers. This is root-equivalent on the host and is called out
    in the README; acceptable for the local/dev scope of this project, unacceptable
    for public hosting (use gVisor/Firecracker and an isolated runner host).

17. **Renderer props include `solution`.** The spec's renderer props are
    `{step, prevStep?, annotation, trace}`; BitsArrayView additionally needs the
    current source line text for the source-cell heuristic, so the registry passes
    `solution` to all renderers as a fifth prop.

18. **Driver edits during playback reset the player.** Editing either pane while a
    trace is loaded returns the player to `idle` (editors become writable again);
    this avoids showing decorations against lines that no longer match the trace.

19. **Heuristic visualization chooser (works for ANY code, no LLM needed).**
    `api/src/heuristicViz.ts` (mirrored in `web/src/heuristicViz.ts`) scans the
    trace for drawable structures: arrays (stack/heap/STL) → `array`/`grid`,
    `ptr→struct` with `next` → `linked_list`, with `left`+`right` → `tree`, bare
    heap pointers → `memory`, else `variables`. `bits_array` is chosen when the
    primary is an array of small non-negative ints AND the solution text contains
    bitwise operators. "Pointer" companions are ints that change at least once and
    stay within `[-1, len]` (excludes constants like `n`), plus pointers carrying a
    `base/offset`. The client uses it instantly on trace arrival; the server uses
    it as the annotate fallback; the LLM (when configured) overrides both.

20. **BitsArrayView parses the *previous* step's line for the source cell.** GDB
    stops *before* executing a line, so a write observed in `changedIndices` at
    step N was produced by the line of step N-1. Index expressions are evaluated
    against the current locals first, then the previous step's locals (the index
    variable may have left scope, e.g. after the final loop iteration).
