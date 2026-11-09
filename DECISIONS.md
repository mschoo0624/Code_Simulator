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
