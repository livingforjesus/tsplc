#!/bin/sh
set -eu
# Keep fatal Windows exceptions visible without enabling routine Wine traces.
export WINEDEBUG=-all,err+seh
work=/tmp/codesys-setup
msi="$work/CODESYS 64 3.5.22.30.msi"
test -f "$msi"
# Use the same CLR configuration for installation and the verified compiler.
python3 - "$WINEPREFIX/drive_c/CODESYS-3.5.22.30/CODESYS/Common" <<'PY'
import pathlib, sys
for name in ("CODESYS.exe", "PackageManagerCLI.exe", "CoreInstallerSupport2.exe"):
    path = pathlib.Path(sys.argv[1]) / (name + ".config")
    text = path.read_text(encoding="utf-8-sig")
    if "<runtime>" not in text:
        raise ValueError("Missing CLR runtime configuration: " + name)
    path.write_text(text.replace("<runtime>", '<runtime><gcConcurrent enabled="false" />', 1))
PY
mkdir "$work/streams"
(cd "$work/streams" && msiinfo export "$msi" ISSetupFile > "$work/setup-files.tsv")
python3 - "$msi" "$work/setup-files.tsv" "$WINEPREFIX/drive_c" <<'PY'
import csv, pathlib, subprocess, sys, zipfile
msi, table, output = sys.argv[1:]
packages = {
    r"Packages\CODESYS Scripting 4.2.0.0.package": "scripting.package",
    r"Packages\CODESYS RISC Front End 4.0.2.0.package": "risc.package",
    r"Packages\CODESYS Code Generator ARM64 4.0.1.0.package": "arm64.package",
    r"Packages\CODESYS Library Dependency Inspection 1.1.0.0.package": "library-inspection.package",
    r"Packages\CODESYS Base Libraries 4.0.1.0.package": "base-libraries.package",
    r"Packages\CODESYS Visualization Support 4.7.0.0.package": "visualization-support.package",
    r"Packages\CODESYS Math Libraries 4.0.0.0.package": "math-libraries.package",
    r"Packages\CODESYS Recipes 4.7.0.0.package": "recipes.package",
    r"Packages\CODESYS Trace 4.4.0.0.package": "trace.package",
    r"Packages\CODESYS Visualization 4.10.0.0.package": "visualization.package",
    r"Packages\CODESYS Communication 4.8.0.0.package": "communication.package",
}
with open(table, newline="") as source:
    for row in csv.DictReader(source, delimiter="\t"):
        name = row["FileName"]
        if name in packages:
            target = pathlib.Path(output) / packages.pop(name)
            with target.open("wb") as destination:
                subprocess.run(["msiinfo", "extract", msi, row["Stream"]], stdout=destination, check=True)
            with zipfile.ZipFile(target) as package:
                if package.testzip() is not None:
                    raise ValueError("Corrupt package: " + name)
            print("Extracted " + name, flush=True)
if packages:
    raise ValueError("Missing bundled packages: " + ", ".join(packages))
PY
printf '%s\r\n' '@echo off' 'cd /d C:\CODESYS-3.5.22.30\CODESYS\Common' \
    'set "packageComponents="' \
    'if "%~1"=="visualization" set "packageComponents=--components=2;3;4"' \
    'PackageManagerCLI.exe --profile="CODESYS V3.5 SP22 Patch 3" --install="C:\%~1.package" %packageComponents% --noConsole --verbose --cancelOnException --logFile="C:\package-install.log"' \
    'set "packageStatus=%errorlevel%"' \
    'if not "%packageStatus%"=="0" echo PackageManagerCLI Windows exit status: %packageStatus%' \
    'exit /b %packageStatus%' > "$WINEPREFIX/drive_c/install-package.cmd"
# Symbol publishing also resolves AlarmManager and VisuShared. Visualization
# supplies those libraries and requires Communication to be installed first.
# Its official component IDs select Libraries, Visualization Profiles and License;
# the PlugIns component creates Windows shortcuts unsupported by Wine.
for package in scripting risc arm64 library-inspection base-libraries visualization-support math-libraries recipes trace communication visualization; do
    if timeout --foreground 15m script -q -e -c "wine cmd /d /c 'C:\\install-package.cmd' '$package'" /dev/null; then
        echo "Installed $package package"
    else
        status=$?
        echo "Package $package installer exited with status $status"
        python3 - "$WINEPREFIX/drive_c/package-install.log" <<'PY' || true
import pathlib, sys
path = pathlib.Path(sys.argv[1])
try:
    if path.exists():
        data = path.read_bytes()
        text = data.decode('utf-16', errors='replace') if data.startswith(b'\xff\xfe') else data.decode(errors='replace')
        print(text[-24000:])
except OSError as error:
    print('Could not read package install log: ' + str(error), file=sys.stderr)
PY
        exit "$status"
    fi
done
cp /opt/codesys-install/verify.py "$WINEPREFIX/drive_c/verify.py"
cp -R /opt/codesys-install/device "$WINEPREFIX/drive_c/codesys-device"
wineserver -k
wineserver -w
rm -rf "$work" "$WINEPREFIX/drive_c/scripting.package" "$WINEPREFIX/drive_c/users/builder/Temp/"*
chmod -R a+rX "$WINEPREFIX"
