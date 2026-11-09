# CodeLens-C runner image: gcc/g++/gdb/python3 + libstdc++ pretty-printers,
# the GDB tracer, and the LD_PRELOAD allocation shim.
FROM debian:bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        gcc g++ gdb python3 libc6-dev \
    && rm -rf /var/lib/apt/lists/*

# Build the allocation shim.
COPY shim/alloc_shim.c /opt/alloc_shim.c
RUN gcc -shared -fPIC -O2 -Wall -o /opt/alloc_shim.so /opt/alloc_shim.c -ldl \
    && rm /opt/alloc_shim.c

# Build-time check: libstdc++ pretty-printers must work (std::vector prints
# as "std::vector of length N"). Fails the build loudly if they do not.
RUN set -e; \
    printf '%s\n' \
        '#include <vector>' \
        '#include <cstdio>' \
        'int main() {' \
        '    std::vector<int> v;' \
        '    v.push_back(1);' \
        '    v.push_back(2);' \
        '    std::printf("%d\n", (int)v.size());' \
        '    return 0;' \
        '}' > /tmp/ppcheck.cpp; \
    g++ -g -O0 /tmp/ppcheck.cpp -o /tmp/ppcheck; \
    gdb -q -batch \
        -ex 'set auto-load safe-path /' \
        -ex 'break ppcheck.cpp:7' \
        -ex run -ex 'print v' /tmp/ppcheck > /tmp/pp.out 2>&1; \
    grep -q 'std::vector of length 2' /tmp/pp.out \
        || { echo 'FATAL: libstdc++ GDB pretty-printers are not working:'; cat /tmp/pp.out; exit 1; }; \
    rm -f /tmp/ppcheck /tmp/ppcheck.cpp /tmp/pp.out

COPY tracer/gdb_tracer.py /opt/gdb_tracer.py
COPY tracer/run_in_container.py /opt/run_in_container.py

RUN useradd --uid 10001 --no-create-home --shell /usr/sbin/nologin runner \
    && mkdir -p /work && chown 10001:10001 /work

# /work is expected to be a tmpfs at runtime
# (--tmpfs /work:rw,exec,size=32m,mode=1777 — mode matters: the default tmpfs
# mount is root-owned 755 and we run as uid 10001).
ENV HOME=/work TMPDIR=/work PYTHONUNBUFFERED=1
WORKDIR /work
USER 10001:10001

CMD ["python3", "/opt/run_in_container.py"]
