#!/bin/sh
set -eu
work=/tmp/codesys-setup
common="$WINEPREFIX/drive_c/CODESYS-3.5.22.30/CODESYS/Common"
python3 /opt/codesys-install/extract.py "$1" "$work"
msi="$work/CODESYS 64 3.5.22.30.msi"
test -f "$msi"
set +e
timeout --foreground 20m wine msiexec /i "$msi" /qn /norestart \
    'INSTALLDIR=C:\CODESYS-3.5.22.30' \
    'ADDLOCAL=Basic,CODESYS,CDS_Exe_x64,Compatibility,OEMCustomization_CDS,Only_x64,SubFeature' \
    CDS_INSTALL_SERVICES=0 CDS_INSTALL_NOPACK=1 AgreeToLicense=Yes CDSAgreeToReadMe=Yes \
    '/L*v' 'C:\codesys-core-install.log'
status=$?
set -e
if [ "$status" -ne 0 ]; then
    echo "CODESYS MSI exited with status $status"
    python3 - "$WINEPREFIX/drive_c/codesys-core-install.log" <<'PY'
import pathlib, sys
data = pathlib.Path(sys.argv[1]).read_bytes()
text = data.decode('utf-16') if data.startswith(b'\xff\xfe') else data.decode(errors='replace')
lines = text.splitlines()
print('\n'.join(lines[:25]))
for index, line in enumerate(lines):
    if 'Return value 3' in line or 'Return value 0' in line or 'Error ' in line:
        print('\n'.join(lines[max(0, index - 20):index + 2]))
PY
    exit 1
fi
test -f "$common/CODESYS.exe"
mv "$common/CoreInstallerSupport.exe" "$common/CoreInstallerSupport.exe.wine-original"
mv "$common/CoreInstallerSupport.exe.config" "$common/CoreInstallerSupport.exe.config.wine-original"
cp /opt/codesys-install/CoreInstallerSupport.exe "$common/CoreInstallerSupport.exe"
cp "$common/CoreInstallerSupport2.exe.config" "$common/CoreInstallerSupport.exe.config"
wineserver -k
wineserver -w
