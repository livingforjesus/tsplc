#!/bin/sh
set -eu
sources=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
work=$(mktemp -d /tmp/vplc-wine-signal.XXXXXX)
echo "Native check artifacts: $work"
"$sources/build.sh" "$work/compat"
gcc -Wall -Wextra -Werror -O2 -fno-tree-vectorize \
    "$sources/tests/frame-and-handler.c" -ldl -o "$work/frame-and-handler"
gcc -Wall -Wextra -Werror -O2 -mavx \
    "$sources/tests/avx-registers.c" -o "$work/avx-registers"
gcc -Wall -Wextra -Werror -O2 \
    "$sources/tests/signal-return.c" -o "$work/signal-return"
gcc -m32 -nostdlib -Wall -Wextra -Werror -O2 -Wl,-e,_start \
    -Wl,--dynamic-linker=/lib/ld-linux.so.2 \
    "$sources/tests/loader-i386.c" -o "$work/loader-i386"
"$work/frame-and-handler"
# Leave the calling shell's environment untouched, just as the Wine launcher does.
preload="$work/compat/\$LIB/signal-state.so"
LD_PRELOAD="$preload" "$work/signal-return"
LD_PRELOAD="$preload" "$work/avx-registers"
LD_PRELOAD="$preload" "$work/avx-registers" nonzero
LD_DEBUG=libs,files LD_PRELOAD="$preload" "$work/signal-return" > "$work/amd64.log" 2>&1
LD_DEBUG=libs,files LD_PRELOAD="$preload" "$work/loader-i386" > "$work/i386.log" 2>&1
python3 - "$work" <<'PY_CHECK'
import pathlib, sys
work = pathlib.Path(sys.argv[1])
for architecture, library in [('amd64', 'x86_64-linux-gnu'), ('i386', 'i386-linux-gnu')]:
    log = (work / (architecture + '.log')).read_text()
    expected = str(work / 'compat' / 'lib' / library / 'signal-state.so')
    if 'calling init: ' + expected not in log or any(message in log for message in
            ['ERROR:', 'wrong ELF class', 'cannot be preloaded']):
        raise SystemExit(log)
    print(architecture + ' loader: ' + expected + ' PASS (no preload warnings)')
PY_CHECK
