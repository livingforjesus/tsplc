#!/bin/sh
set -eu
mkdir -p "$HOME"
if [ "$#" -eq 0 ] || [ "$1" = '--help' ] || [ "$1" = '-h' ]; then
    exec bun /opt/codesys-build/docker/runner.ts "$@"
fi
# Every job gets its own writable prefix. The installed image is immutable and
# arbitrary host UIDs can write their build artifacts without root-owned files.
cp -R --no-preserve=ownership /opt/wine-template "$WINEPREFIX"
exec xvfb-run -a bun /opt/codesys-build/docker/runner.ts "$@"
