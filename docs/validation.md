# Validation: 13 October 2026

The maintained vPLC toolchain and the migrated Frame application were tested
through installed package archives, the Docker CODESYS compiler and a running
virtual PLC. The target was CODESYS Virtual Control for Linux ARM64 4.22, using
CODESYS 3.5.22.30. This evidence does not establish support for every CODESYS target.

The subsequent [Docker reliability investigation](build-reliability.md) records
the new AMD64 compiler image, stricter shutdown/error handling, ten repeated
builds, another successful online-change/reboot cycle and the remaining
fresh-install, target and retention-layout validation limits. The
complete migration cycle below describes the earlier verified images.

| Check                                     | Result                                                                                            |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------- |
| vPLC TypeScript, ESLint and Prettier      | Pass                                                                                              |
| Bun tests                                 | 692 passed, 0 failed; 27,087 assertions across 60 files                                           |
| Python worker and installer tests         | 42 passed, 0 failed                                                                               |
| Fresh archive consumer                    | SDK resolution, source checks, typegen and ST emission passed                                     |
| Raw ST and actual EDS hardware profile    | Docker builds passed                                                                              |
| Packaged VSIX in a VS Code extension host | Activation and language features passed for both supported ST dialects                            |
| Packaged Hardware & IO page in VS Code    | Native GUI inspection, device/bit expansion, refresh, config navigation and canceled login passed |
| Bundled extension OPC UA monitor          | Encrypted connection and live values passed                                                       |
| Frame PLC and contract                    | Scoped source checks, typechecks, generated freshness and owned-file Biome checks passed          |
| Frame OPC UA and simulation services      | 387 OPC UA tests and 54 simulation tests passed; 43 scoped Turbo tasks passed                     |
| Final compiled PLC integration            | 28 passed, 0 failed, 151 assertions in 92.78 seconds; after online changes and restart            |

## Requested workflow

| Requirement                     | Maintained implementation and evidence                                                                                                                                  |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| One Bun repository              | Build, typegen, compiler and the private VS Code extension share the vPLC workspace; `@vplc/config` owns the common schema.                                             |
| Shared configuration            | Both build CLIs consume `vplc.config.ts`; raw ST uses the same exact task schedule without TypeScript sources. Configure uses the selected image.                       |
| TypeScript developer experience | Natural incrementing loops, persistent loop counters and source-shaped ST/CODESYS folders are covered by compiler regressions and the Frame migration.                  |
| EDS and typed IO                | The three supplied descriptors drive generated channel types, mapping validation, selected connection/assembly metadata and six published read-only aliases.            |
| CODESYS dependencies            | Exact archive library names/versions and local library files use the shared installer and lock/cache; extension validation/completion uses the same catalog.            |
| Extension                       | A separate VSIX contains ST language features, Hardware & IO views, task/connection/assembly details and encrypted live monitoring.                                     |
| Frame migration                 | Installed local packages build the migrated TypeScript source; ABI checks, online changes, reboot readbacks and compiled-PLC simulation cover the existing application. |
| Docker and future backends      | The public builder requires Docker; CODESYS emission and vendor integration remain behind the backend boundary. The experimental native compiler is not maintained.     |
| Readability and functionality   | Separate subagent fix/recheck loops finished clean; late installer diagnostics preserve failures even when logs are corrupt or unavailable.                             |

## Supplied EDS files

The Cognex DataMan, ConveyLinx and B&R EDS files are copied unchanged into the
Frame example and the actual migrated project. Parser, generated typing, mapping
validation and extension model/renderer tests cover these files. The hardware
profile also compiled with the vendor compiler. The installed VSIX was visually
checked in VS Code 1.141.0 using a separate `vPLC Verification` profile; all 14
installed extension files match the packaged VSIX, with installation metadata
excluded from the package manifest comparison.

The checks cover variable Cognex connection payloads and byte arrays, ConveyLinx
16-bit assembly instances, packed flags, and B&R input instance 124 / output
instance 112. B&R declares raw byte payloads; physical channel labels cannot be
inferred from that file. See [the EDS evidence](research/actual-eds-files.md).

The hardware-testing addresses are virtual process-image addresses. No physical
EtherNet/IP device was commissioned. Fieldbus topology and driver configuration
remain in the CODESYS template. The hardware webview was verified through its
model, controller and renderer tests, and through native interaction with the
packaged extension. The page displayed the three supplied device descriptions,
selected connection paths, assembly capacities and addresses, six named mappings,
and MainTask at 20 ms with priority 1. Expanding B&R input byte 0 exposed eight BOOL
channels at `%IX576.0` through `%IX576.7`; refresh preserved that expansion. The
Config button opened the exact hardware test config. Connect displayed the
expected password prompt; canceling left the view disconnected. No credentials
were entered or saved. Live encrypted values were verified separately; this GUI
session did not connect or change the production PLC application.

## Live online change and reboot

The actual Frame project was downloaded using its installed vPLC CLI. Its inbound
conveyor count was changed from 113 to 112, then restored to 113 through a second
online change. Live controller readbacks confirmed all three values. Each update
changed the code ID while preserving the application and data IDs; the controller
remained running. The original TypeScript source was restored byte for byte.

After a Compose restart, a fresh engineering inspection confirmed the restored
code/data IDs and the value 113. The 28 integration cases then passed against that
boot application. This verifies the tested body-only online changes and updated
boot application; it does not establish every retention or layout-change scenario.

The Docker installer verification also reproduced the old prefix's missing
transitive libraries after reopening a successfully compiled project. Installing
the pinned official library/profile components fixed that failure. The corrected
prefix passed compilation, symbol publishing, nonempty boot artifact checks and
saved-project reopening. Vendor archives and assemblies were preserved.

The earlier validated runtime image is
`sha256:3a2ddf627d7905ba2a9bee884459b8f63ef4dab3486e7918061c611d1daed4f6`.
It contained the then-current worker and host sources over the successfully verified
installer image
`sha256:8587d433f719920a9724eb91a9cea24f267ffd7af5cc3c6e2f9ae03b18f1715a`.
That earlier download, both online changes, restart inspection and 28 integration
tests used the 3a2ddf runtime image. Raw ST and the six live hardware aliases were
verified using the installer image; both image receipts are retained separately.

## Review and remaining limits

Separate readability and functionality reviews ran through fix/recheck loops and
finished without actionable findings in the maintained scope.

The earlier archive review removed Python bytecode caches from packaging and
verified 168 installed files and 164 payload files. The subsequent reliability
update reinstalled and verified 171 installed files and 167 current source/dist
payload files, with no unexpected files or Python caches. A fresh isolated
consumer passed after that update; its receipts are recorded in the reliability
report.

The earlier workflow exposed intermittent Wine/FEX/CODESYS failures. One installer
attempt reported `COR_E_STACKOVERFLOW` (Windows status -2147023895, Unix status
233). Earlier vendor workers also exited unexpectedly. A downloaded application
once failed boot-project creation with an invalid-path exception; the same API
completed successfully on the next verified run. Added diagnostics preserve raw
status and CLR exception details; they do not establish a fix for these sporadic
failures. The later reliability investigation replaces the FEX compiler runtime
and reproduces the false-success bug, while fresh installation remains unresolved.
Neither successful run establishes installation or compilation on every attempt.

The earlier computer-use access blocker cleared after restarting the desktop app.
The cause of the missing approval prompt was not established. Native Hardware & IO
interaction is now verified alongside the automated tests, packaged language host
and separate encrypted live monitoring check.

The Frame repository-wide Biome task still fails on two pre-existing restricted
imports in `packages/frame-assembly/trpc/src/handler.ts` and
`packages/frame-assembly/trpc/src/trpc/trpc.ts`. Those files were not changed. The
scoped PLC/contract checks and checks of owned files passed.

Automatic approval review rejected deletion of retained legacy files. The unused
copies remain; their obsolete runtime exports were removed where applicable.
There is no maintained experimental native compiler backend.

Packages are local archives rather than a published npm release. See
[packaging](compiler/packaging.md) for installation, archive refresh and portability.

Detailed command logs and controller receipts remain under `.work/` in the vPLC
checkout. Key records are `completion-root-check-runtime.log`,
`completion-python-boot-diagnostic.log`, `completion-package-proof.json`,
`completion-hardware-ui-proof.json`,
`frame-completion-online-proof.json`, `frame-completion-after-restart.log`, and
`frame-completion-plc-integration.log`. The exported `validation-evidence.json`
includes package identities, image lineage, EDS checks and live controller receipts.
