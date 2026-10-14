# Shared project template

`local.project` is the minimal, versioned engineering scaffold. It contains the
runtime device, Application, Library Manager, and a cyclic task calling an empty
ST program named `PLC_PRG`. Machine declarations and control logic are compiled from
`../src/` to the emitted ST bundle during builds; they are not maintained in this template.

The target is CODESYS Virtual Control for Linux ARM64, version `4.22.0.0`
(device ID `4096 / 0000 1008`), saved with CODESYS V3.5 SP22 Patch 3.
`MainTask` runs every 20 ms and calls `PLC_PRG` in the unmodified template.
The build replaces that call with the configured `Main` entry in its private copy. Library references are
Standard plus the device-provided IoStandard, 3SLicense, CAA Device Diagnosis,
and BreakpointLogging placeholders. No runtime address or gateway is selected.

Open the template to change shared library references or target configuration,
save it, and include the binary change in your commit. The Docker compiler image
supplies the bundled libraries and ARM64 device description. Add other required
libraries through `dependencies` in `vplc.config.ts`.

Keep credentials, runtime user management, and machine-specific connection
settings out of the shared project. Configure `build.online` in `vplc.config.ts`
for CLI downloads, or select the connection when opening a generated build project
in CODESYS. If you need a private template, save it as
`private.project` in this directory and select it with `build.template` in
`vplc.config.ts`. Other project files, backups, and editor sidecars remain ignored.
