#!/bin/sh
set -eu
sources=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
output=${1:?Usage: build.sh OUTPUT_DIRECTORY}
mkdir -p "$output/lib/x86_64-linux-gnu" "$output/lib/i386-linux-gnu"
gcc -shared -fPIC -Wall -Wextra -Werror -O2 -fno-tree-vectorize \
    "$sources/signal-state.c" -ldl -o "$output/lib/x86_64-linux-gnu/signal-state.so"
# No 32-bit libc or headers are needed for this empty shared object.
gcc -m32 -shared -fPIC -nostdlib -Wall -Wextra -Werror -O2 \
    "$sources/noop-i386.c" -o "$output/lib/i386-linux-gnu/signal-state.so"
