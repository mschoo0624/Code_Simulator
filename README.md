# CodeLens-C

A step-by-step **visual explainer for C and C++ code**. Write a function plus a
small `main()` driver, click **Illustrate**, and step through an interactive
visualization of the *real* program state at every line: arrays (stack, heap,
`std::vector`), indices and pointers, binary forms of ints, linked lists,
trees, and a stack/heap memory view — with plain-English captions.

Core principle: **the LLM never invents program state.** Every value shown
comes from a real GDB-driven execution trace. The LLM only chooses which
visualization fits and writes captions/insight/complexity notes from the trace
it is given. **Any code you type gets a visual** — even without an API key, a
heuristic chooser inspects the trace (arrays, heap blocks, linked structs,
index variables) and picks a fitting view with automatic captions; the LLM,
when configured, refines the choice and writes better captions.

## ⚠️ Security: running arbitrary C/C++ is dangerous

This project compiles and executes **untrusted native code**. The container
setup (`--network none --read-only --tmpfs /work --memory 256m --cpus 1
--pids-limit 128 --cap-drop ALL --security-opt no-new-privileges`, non-root
uid 10001, fresh container per run) is **defense in depth for local/dev use
only**. For public hosting use **gVisor (runsc)** or **Firecracker** as the
container runtime, and treat the host as hostile-adjacent. Additionally, the
compose setup mounts the Docker socket into the API container so it can spawn
runner containers — that mount is equivalent to root on the host and is
another reason this configuration must stay local.

## Setup

Requirements: **Docker** (Desktop or Engine), Node 20+ (for local dev).

```bash
cp .env.example .env          # optionally add ANTHROPIC_API_KEY
docker compose up --build     # web on http://localhost:5173, api on :3001
```

Local development without compose:

```bash
npm install
npm run build:runner          # build the sandbox image (required once)
npm run dev:api               # api on :3001
npm run dev:web               # vite dev server on :5173 (proxies /api)
```

Tests (Docker-dependent tests skip automatically when Docker is unavailable):

```bash
npm test
```

## Architecture

```
Monaco: [solution pane] [driver pane] [language C|C++]
        |
        v  POST /api/trace
API: validate sizes, rate-limit, cache by SHA-256, start sandbox container
        |
        v
Container: compile (one TU: #include "solution.c" + #include "driver.c")
           -> run under GDB with gdb_tracer.py + LD_PRELOAD alloc shim
           -> Trace JSON on stdout
        |
        v  POST /api/annotate (compressed trace)
Claude -> Annotation JSON (viz choice, captions, insight, complexity)
        |
        v
Player state machine -> renderer registry -> SVG visual + captions
                                           + highlighted solution line
```

- **Trace**: `runner/tracer/gdb_tracer.py` steps the inferior and records a
  step only when the current frame is in the solution file. Values are
  serialized into a tagged `Value` model (see `api/src/schema/trace.ts`).
- **Allocation shim**: `runner/shim/alloc_shim.c` interposes
  `malloc/calloc/realloc/free` via `LD_PRELOAD` and appends one line per event
  to `ALLOC_LOG` using only `write(2)`. The tracer tails this log to maintain
  a `{addr: {size, live}}` table, which is how an `int*` becomes a drawable
  heap array with exact length, how freed blocks are grayed out, and how leaks
  are listed at exit.
- **Annotation**: the backend compresses the trace (changed/call/return/
  exception steps, cap 120, arrays sampled around changed indices), sends it
  to Claude with a strict system prompt, Zod-validates the reply (one retry),
  and falls back to `viz:"variables"` with auto captions on any failure.
- **Renderers**: `web/src/viz/registry.ts` maps viz names to React SVG
  components: `variables`, `array`, `bits_array`, `grid`, `linked_list`,
  `tree` (beta), `graph` (beta), `memory`.

## How to add a renderer

1. Create `web/src/viz/MyView.tsx` with the shared props
   `{ step, prevStep?, annotation, trace, solution }` (`VizProps.ts`).
2. Register it in `web/src/viz/registry.ts` under a new key and add the key to
   `VIZ_KINDS` in `web/src/types.ts` *and* `api/src/schema/annotation.ts`.
3. If the LLM should be able to pick it, extend rule 3 of the system prompt in
   `api/src/annotate.ts`.
4. Design rules: flat (no gradients/shadows), CSS variables for light/dark,
   min font 12px, never rely on color alone, keep it keyboard accessible.

## Known limitations

- **No `-O2` traces.** Optimized code inlines functions and eliminates
  variables, which makes line-by-line stepping meaningless; compilation is
  locked to `-g -O0`.
- **No multithreading**; only the main thread is traced.
- **Single-file solutions** (one solution pane + one driver pane).
- **stdout is shown at the end**, not incrementally per step (the program's
  output is redirected to a file and read after the run).
- **C++ template/STL support depends on the libstdc++ pretty-printers**
  shipped in the runner image (verified at image build time). Exotic STL
  types may fall back to a generic rendering.
- Leak detection only attributes `malloc`-family calls made directly from
  user code; leaks created inside libstdc++ (`operator new`) are not listed.
- The bits-array "source cell" heuristic only evaluates simple index
  expressions (`i`, `i/2`, `i>>1`, `i-1`, `i+1`, `i&1`, constants); anything
  more complex simply skips the source highlight.
- Trace limits: 600 recorded steps, 8 s wall time, call depth 40, 50 array
  elements, 40 pointer-followed nodes, 64-char strings, 4 KB stdout/stderr.

## Project structure

```
codelens-c/
  web/        React 18 + TS + Vite + Tailwind + Monaco; SVG renderers
  api/        Node 20 + TS + Express; Zod schemas; sandbox orchestration
  runner/     Docker image: gcc/g++/gdb + GDB tracer + LD_PRELOAD shim
  DECISIONS.md    implementation decisions and deviations
  docker-compose.yml
```
