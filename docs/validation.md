# Validation scope

[Documentation home](README.md) · [Docker reliability](build-reliability.md) · [Testing guide](guides/testing.md)

The tsPLC toolchain has been exercised end to end on one target: CODESYS Virtual
Control for Linux ARM64 4.22, compiled with CODESYS 3.5.22.30 in the pinned Docker
image. These results do not establish support for every CODESYS target.

## What has been verified

| Area                        | Evidence                                                                                                              |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Repository checks           | `bun run check`: TypeScript, ESLint, Prettier and the Bun suite; Python worker and installer tests                    |
| Packaged consumer           | Installed local archives in a fresh project: SDK resolution, source checks, typegen and ST emission                   |
| Vendor compilation          | TypeScript and raw-ST projects, including an EDS hardware profile, compiled to project, application and CRC in Docker |
| EDS and typed IO            | Generated channel types, mapping validation, connection/assembly metadata and emitted IO for the example descriptors  |
| VS Code extension           | Packaged VSIX activation and language features for both supported ST dialects                                         |
| Hardware & IO view          | Native interaction with the packaged extension: device/bit expansion, refresh, config navigation and a canceled login |
| Monitoring                  | Encrypted OPC UA connection and live values from the bundled monitor                                                  |
| Deployment on a virtual PLC | Download, body-only online changes, boot application creation and identity checks after a runtime restart             |

Run the repository checks with `bun run check`. The
[testing guide](guides/testing.md) describes what each verification level
establishes.

## EDS descriptors

The Cognex DataMan, ConveyLinx and B&R descriptors in the
[bottling-line example](../examples/bottling-line/README.md) are covered by parser,
generated-typing, mapping-validation and extension model/renderer tests. The
checks cover variable Cognex connection payloads and byte arrays, ConveyLinx
16-bit assembly instances, packed flags, and B&R input instance 124 / output
instance 112. B&R declares raw byte payloads; physical channel labels cannot be
inferred from that file. See [EDS layouts](research/eds-layouts.md).

The example's addresses are virtual process-image addresses. No physical
EtherNet/IP device was commissioned. Fieldbus topology and driver configuration
remain in the CODESYS template.

## Online changes and restart

Each verified body-only online change changed the code ID while preserving the
application and data IDs, and the controller kept running. After a runtime
restart, a fresh engineering inspection confirmed the updated boot application's
identity and values. This does not establish every retention or layout-change
scenario.

Installer verification reproduced missing transitive libraries after reopening a
successfully compiled project in an older prefix. Installing the pinned official
library and profile components fixed that failure. The corrected prefix passes
compilation, symbol publishing, nonempty boot artifact checks and saved-project
reopening.

## Known limits

- Earlier Wine/FEX/CODESYS runs showed intermittent failures: one installer attempt
  reported `COR_E_STACKOVERFLOW`, vendor workers exited unexpectedly, and a
  downloaded application once failed boot-project creation with an invalid-path
  exception that did not recur. Diagnostics preserve raw status and CLR exception
  details; the [reliability report](build-reliability.md) describes the
  maintained runtime and its remaining limits.
- Physical EtherNet/IP commissioning and an exhaustive retention/layout-change
  matrix were not performed.
- There is no maintained experimental native compiler backend.
- Packages are local archives rather than a published npm release. See
  [packaging](compiler/packaging.md) for installation, archive refresh and
  portability.
