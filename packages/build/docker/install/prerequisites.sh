#!/bin/sh
set -eu
timeout --foreground 3m env WINEDLLOVERRIDES='mscoree,mshtml=' wine wineboot -u
timeout --foreground 40m winetricks -q dotnet48 vcrun2022 msxml6 win10
for exe in CODESYS.exe PackageManagerCLI.exe IPMCLI.exe PackageManager.exe \
    LACUtil.exe ImportLibraryProfile.exe CoreInstallerSupport.exe CoreInstallerSupport2.exe \
    DeletePlugInCache.exe RepairMenuConfig.exe Dependencies.exe PackageManagerSelfUpdater.exe \
    VisualStylesEditor.exe Html5ControlEditor.exe; do
    wine reg add "HKCU\\Software\\Wine\\AppDefaults\\$exe\\DllOverrides" /v '*security' /t REG_SZ /d native /f
done
wine regsvr32 /s oleaut32.dll
wine 'C:\windows\syswow64\regsvr32.exe' /s oleaut32.dll
wine reg add 'HKCU\Software\Microsoft\Avalon.Graphics' /v DisableHWAcceleration /t REG_DWORD /d 1 /f
wineserver -k
wineserver -w
