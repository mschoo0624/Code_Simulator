/*
 * alloc_shim.c — LD_PRELOAD interposer for malloc/calloc/realloc/free.
 *
 * Appends one text line per allocation event to the file named by $ALLOC_LOG,
 * using only write(2) (no stdio, which itself allocates). Format:
 *   m <addr> <size> <caller>
 *   c <addr> <total> <caller>
 *   r <old> <new> <size> <caller>
 *   f <addr>
 * Addresses are 0x-prefixed hex; sizes are decimal. <caller> is the return
 * address of the call site (__builtin_return_address(0)), used by the tracer
 * to attribute leaks to user code vs libc internals.
 *
 * dlsym(RTLD_NEXT, "calloc") may itself call calloc; those bootstrap requests
 * are served from a static buffer.
 */
#define _GNU_SOURCE
#include <dlfcn.h>
#include <fcntl.h>
#include <stddef.h>
#include <stdint.h>
#include <stdlib.h>
#include <unistd.h>

typedef void *(*malloc_fn)(size_t);
typedef void *(*calloc_fn)(size_t, size_t);
typedef void *(*realloc_fn)(void *, size_t);
typedef void (*free_fn)(void *);

static malloc_fn real_malloc;
static calloc_fn real_calloc;
static realloc_fn real_realloc;
static free_fn real_free;

static int initializing;
static char boot_buf[65536];
static size_t boot_off;

static void *boot_alloc(size_t n) {
    n = (n + 15u) & ~(size_t)15u;
    if (boot_off + n > sizeof boot_buf) return 0;
    void *p = boot_buf + boot_off;
    boot_off += n;
    return p;
}

static int from_boot(const void *p) {
    return (const char *)p >= boot_buf && (const char *)p < boot_buf + sizeof boot_buf;
}

static void shim_init(void) {
    if (real_malloc) return;
    initializing = 1;
    real_malloc = (malloc_fn)dlsym(RTLD_NEXT, "malloc");
    real_calloc = (calloc_fn)dlsym(RTLD_NEXT, "calloc");
    real_realloc = (realloc_fn)dlsym(RTLD_NEXT, "realloc");
    real_free = (free_fn)dlsym(RTLD_NEXT, "free");
    initializing = 0;
}

/* ---- logging ------------------------------------------------------------ */

static int log_fd = -2; /* -2 = not opened yet, -1 = disabled */
static __thread int busy;

static void open_log(void) {
    if (log_fd != -2) return;
    const char *path = getenv("ALLOC_LOG");
    if (!path || !*path) { log_fd = -1; return; }
    int fd = open(path, O_WRONLY | O_CREAT | O_APPEND, 0644);
    log_fd = fd >= 0 ? fd : -1;
}

static char *put_hex(char *p, uintptr_t v) {
    static const char d[] = "0123456789abcdef";
    char tmp[2 * sizeof(uintptr_t)];
    int n = 0;
    *p++ = '0';
    *p++ = 'x';
    do { tmp[n++] = d[v & 0xf]; v >>= 4; } while (v);
    while (n) *p++ = tmp[--n];
    return p;
}

static char *put_dec(char *p, uintptr_t v) {
    char tmp[24];
    int n = 0;
    do { tmp[n++] = (char)('0' + v % 10); v /= 10; } while (v);
    while (n) *p++ = tmp[--n];
    return p;
}

/* kinds of fields: 'h' hex, 'd' decimal, 0 = end */
static void log_event(char op, const char *kinds, const uintptr_t vals[4]) {
    if (busy) return;
    busy = 1;
    open_log();
    if (log_fd >= 0) {
        char buf[128];
        char *p = buf;
        *p++ = op;
        for (int i = 0; i < 4 && kinds[i]; i++) {
            *p++ = ' ';
            p = kinds[i] == 'h' ? put_hex(p, vals[i]) : put_dec(p, vals[i]);
        }
        *p++ = '\n';
        ssize_t ignored = write(log_fd, buf, (size_t)(p - buf));
        (void)ignored;
    }
    busy = 0;
}

/* ---- interposers -------------------------------------------------------- */

void *malloc(size_t size) {
    if (!real_malloc) {
        if (initializing) return boot_alloc(size);
        shim_init();
        if (!real_malloc) return 0;
    }
    void *p = real_malloc(size);
    if (p) {
        uintptr_t v[4] = {(uintptr_t)p, size, (uintptr_t)__builtin_return_address(0), 0};
        log_event('m', "hdh", v);
    }
    return p;
}

void *calloc(size_t nmemb, size_t size) {
    if (!real_calloc) {
        if (initializing) {
            /* boot_buf is static, already zeroed */
            return boot_alloc(nmemb * size);
        }
        shim_init();
        if (!real_calloc) return 0;
    }
    void *p = real_calloc(nmemb, size);
    if (p) {
        uintptr_t v[4] = {(uintptr_t)p, nmemb * size, (uintptr_t)__builtin_return_address(0), 0};
        log_event('c', "hdh", v);
    }
    return p;
}

void *realloc(void *old, size_t size) {
    if (!real_realloc) {
        shim_init();
        if (!real_realloc) return 0;
    }
    if (from_boot(old)) {
        /* cannot realloc a bootstrap chunk; hand out a fresh block */
        void *p = real_malloc ? real_malloc(size) : 0;
        if (p && old) __builtin_memcpy(p, old, size);
        if (p) {
            uintptr_t v[4] = {(uintptr_t)p, size, (uintptr_t)__builtin_return_address(0), 0};
            log_event('m', "hdh", v);
        }
        return p;
    }
    void *p = real_realloc(old, size);
    if (p) {
        uintptr_t v[4] = {(uintptr_t)old, (uintptr_t)p, size, (uintptr_t)__builtin_return_address(0)};
        log_event('r', "hhdh", v);
    }
    return p;
}

void free(void *p) {
    if (!p || from_boot(p)) return;
    if (!real_free) {
        shim_init();
        if (!real_free) return;
    }
    real_free(p);
    uintptr_t v[4] = {(uintptr_t)p, 0, 0, 0};
    log_event('f', "h", v);
}
