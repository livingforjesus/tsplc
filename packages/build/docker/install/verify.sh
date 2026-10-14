#!/bin/sh
set -eu
# Verify with the AMD64 Wine/CLR used by the compiler, after setup's FEX stage.
export WINEDEBUG=-all,err+seh
# Require fresh artifacts from this invocation, including on reused prefixes.
rm -f "$WINEPREFIX/drive_c/codesys-verification.project" \
    "$WINEPREFIX/drive_c/codesys-verification.app" \
    "$WINEPREFIX/drive_c/codesys-verification.crc"
printf '%s\r\n' '@echo off' 'cd /d C:\CODESYS-3.5.22.30\CODESYS\Common' \
    'CODESYS.exe --profile="CODESYS V3.5 SP22 Patch 3" --noUI --textPrompts --runscript="C:\verify.py"' \
    'exit /b %errorlevel%' > "$WINEPREFIX/drive_c/verify.cmd"
transcript="$WINEPREFIX/drive_c/codesys-verification.log"
if timeout --foreground 15m script -q -e -c "wine cmd /d /c 'C:\\verify.cmd'" "$transcript"; then
    :
else
    status=$?
    echo "CODESYS verification exited with status $status; transcript: $transcript" >&2
    exit "$status"
fi
# A Wine helper can assert while the main compiler still returns zero.
python3 - "$transcript" <<'PY'
import pathlib, re, sys
path = pathlib.Path(sys.argv[1])
text = path.read_bytes().decode(errors='replace')
text = re.sub(r'\x1b\[[0-?]*[ -/]*[@-~]', '', text).replace('\r', '')
assertion = re.search(r'^assertion failed \[[^\n]+\]:[^\n]*\n[ \t]*\(ThreadContext[^\n]*\)', text, re.M)
if assertion:
    raise SystemExit('Wine translation aborted: ' + ' '.join(assertion.group().split()) + '. See ' + str(path))
PY
test -s "$WINEPREFIX/drive_c/codesys-verification.project"
test -s "$WINEPREFIX/drive_c/codesys-verification.app"
test -s "$WINEPREFIX/drive_c/codesys-verification.crc"
wineserver -k
wineserver -w
