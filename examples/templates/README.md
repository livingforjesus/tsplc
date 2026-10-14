# Virtual CODESYS template

`virtual.project` is a minimal engineering scaffold for **CODESYS Virtual Control
for Linux ARM64, version 4.22.0.0** (device ID `4096 / 0000 1008`), saved with
CODESYS V3.5 SP22 Patch 3. It contains the runtime device, an Application, its
Library Manager and a 20 ms `MainTask` that calls an empty ST program named
`PLC_PRG`. Library references are Standard, **Util, 3.5.22.0 (System)** and the
device-provided IoStandard, 3SLicense, CAA Device Diagnosis and BreakpointLogging
placeholders. No runtime address or gateway is selected. `provenance.json` pins
its SHA-256.

The Util reference supplies the native `Util.BLINK` used by the
[bottling-line example](../bottling-line/README.md). The pinned Docker compiler
image supplies the matching libraries and ARM64 device description; no library
binary is vendored here.

Builds never modify this file. `@tsplc/build` copies it, removes the objects named
in `build.removeObjects` (for example `PLC_PRG`), imports the emitted sources and
replaces the task plan in the private copy. To change the target or library
references, save a separate copy in CODESYS and select it with `build.template`.
For a physical controller, use a template with that controller's device tree and
process-image addresses.

The [CODESYS Library Manager scripting API](https://content.helpme-codesys.com/en/ScriptingEngine/ScriptLibManObject.html)
documents `get_library_manager` and `add_library`. The
[BLINK documentation](https://content.helpme-codesys.com/de/libs/Util/Current/Signals/BLINK.html)
specifies the native block contract.
