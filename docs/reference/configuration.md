# Configuration reference

[Documentation home](../README.md) · [Quickstart](../getting-started.md)

Export one config from `vplc.config.ts`:

```ts
import { defineConfig, ms } from "@vplc/config";

export default defineConfig({
  backend: "codesys",
  compiler: {
    programs: { main: { module: "src/main.ts", export: "main" } },
  },
  tasks: [
    {
      name: "MainTask",
      schedule: { kind: "cyclic", interval: ms(20) },
      priority: 1,
      programs: ["main"],
    },
  ],
});
```

`defineConfig` preserves the authored TypeScript type; loading performs schema
validation. Unknown fields are rejected. The CLI executes this trusted host
config, while PLC source is analyzed without JavaScript execution. The editor
reads literals/snapshots instead of executing arbitrary config on workspace open.

## Paths and sections

Paths in the root config resolve relative to that file. Paths inside a referenced
`tsconfig.json` follow TypeScript's normal rules. Device files and local libraries
use the config's directory too, not the `eds` directory or shell working directory.

| Field          | Default / requirement                      | Purpose                                           |
| -------------- | ------------------------------------------ | ------------------------------------------------- |
| `backend`      | Required; `"codesys"`                      | The only currently supported backend              |
| `name`         | `"Application"`                            | Application/compiler project name                 |
| `compiler`     | Omitted for raw ST                         | TS configuration and named program entries        |
| `tasks`        | Required with `compiler`                   | Shared cyclic schedule                            |
| `build`        | Required for vendor compilation/deployment | Template, output, Docker and connection settings  |
| `codesys`      | Optional                                   | Backend address interpretation and IEC naming     |
| `eds`          | `"eds"`                                    | Descriptor directory or directory array           |
| `devices`      | `{}`                                       | Selected descriptors/connections/assemblies       |
| `io`           | `{}`                                       | Logical direct-address or device/channel mappings |
| `dependencies` | `{}`                                       | Exact vendor library versions or local files      |
| `typegen`      | Optional                                   | PLC contract and hardware output settings         |
| `monitor`      | Optional                                   | Editor's read-only OPC UA connection              |

## Compiler and tasks

`compiler.tsconfig` defaults to `tsconfig.json`. Each `compiler.programs` value
has `{ module, export }`; the export is a no-argument void function. Keys select
programs in a task's ordered `programs` array.

Tasks have:

| Field               | Constraint                                                 |
| ------------------- | ---------------------------------------------------------- |
| `name`              | IEC identifier; unique task name                           |
| `schedule.kind`     | `"cyclic"`                                                 |
| `schedule.interval` | Use `ms(...)` or `seconds(...)` from `@vplc/config`        |
| `priority`          | Integer 0–31                                               |
| `programs`          | Nonempty ordered list; each program scheduled exactly once |

CODESYS currently requires a positive interval expressed in exact whole
milliseconds within TIME range. `@vplc/config` also exports `ns`, but a sub-ms
period is rejected by this backend. Mutable state/block ownership cannot span
different cyclic tasks.

For raw ST, task program names are declared IEC PROGRAM names. If shared tasks
are omitted, `build.task` selects a template task. Legacy `build.tasks` uses the
lower-level nanosecond-string representation; do not configure it alongside
shared `tasks`.

## Build

| Field                 | Default                      | Meaning                                                            |
| --------------------- | ---------------------------- | ------------------------------------------------------------------ |
| `template`            | Required                     | CODESYS `.project` with the intended target/topology               |
| `outDir`              | `"build"`                    | Engineering artifacts and controller baseline directory            |
| `sourceDir`           | `"src"`                      | Authored ST source root; compiler resolves generated source for TS |
| `entry`               | `"src/Main.st"`              | Raw ST entry; compiler resolves generated entry for TS             |
| `task`                | Template `MainTask` fallback | Legacy raw-ST template task selection                              |
| `removeObjects`       | `[]`                         | Named template objects to remove before import                     |
| `symbols`             | `false`                      | Request symbol generation                                          |
| `docker.image`        | `"vplc-build:3.5.22.30"`     | Compiler image                                                     |
| `docker.cpuSet`       | Omitted                      | Optional Docker CPU selection such as `"0-1"`                      |
| `runtime.composeFile` | Required if `runtime` is set | Existing Compose definition                                        |
| `runtime.service`     | `"plc"`                      | Service installed/started by `run`                                 |
| `online.network`      | `"bridge"`                   | Docker network used by engineering operations                      |
| `online.gateway.host` | Required if `online` is set  | Gateway address reachable from that network                        |
| `online.gateway.port` | `1217`                       | Gateway port                                                       |
| `online.device.host`  | Required if `online` is set  | Controller address reachable from that network                     |
| `online.device.port`  | `11740`                      | Controller port                                                    |
| `online.credentials`  | Omitted                      | `{ usernameEnv, passwordEnv }` environment variable names          |

`sourceDir`/`entry` in a TS project are generated by the compiler plan, rather
than pointing the vendor compiler at `.ts` files. Use top-level `io` and
`dependencies`; the builder's resolved IO/library forms are for its lower-level
SDK boundary.

Optional `build.timeouts` values are positive integer milliseconds:

| Field         | Default                |
| ------------- | ---------------------- |
| `startup`     | `1200000` (20 minutes) |
| `build`       | `1200000` (20 minutes) |
| `stop`        | `10000`                |
| `terminate`   | `5000`                 |
| `hostCommand` | `15000`                |
| `runtime`     | `60000`                |

These are process/operation timeouts, separate from the PLC task interval.
Host IDE executable, installation profile and Wine paths are private image
settings and are not selectable here.

## CODESYS options

`codesys.profile` describes direct-address interpretation, not an IDE installation
profile. `directAddressing` is `"byte"`; `numericAddressing` can be `"byte"` or
`"element"` and is required for numeric physical IO bindings.

`programNames` maps logical program keys to selected IEC program names.
`globalListNames` preserves selected authored GVL names. `publishGlobalLists`
selects authored lists to publish for external clients. See the
[Frame config](../../examples/frame-assembly/vplc.config.ts) for a tested use that
preserves `Main` and existing application GVLs.

## Hardware and IO

A device entry has `file`, optional `connection`, optional `inputs`/`outputs`,
and optional `statusSymbols`. Each assembly selection has:

```ts
inputs: { assembly: 11, address: "%IB0", size: 32 },
```

`assembly` is a nonnegative instance number, `address` is an input/output byte
base, and optional `size` is a positive selected payload length. It must agree
with the descriptor's actual connection/layout. `statusSymbols` maps display
labels to existing qualified driver symbols; it does not create a driver block.

An IO binding is either:

```ts
Start: { address: "%IX0.0" },
Ready: { device: "scanner", channel: "inputs.Trigger_Ready" },
```

Direct addresses support input/output `Xbyte.bit`, `B`, `W` and `D` forms. Bit
numbers are 0–7. A direct binding can include `type` for raw ST declaration
checking. EDS channel IDs are descriptor-specific; use generated
`HardwareIoMapping` as explained in the [hardware guide](../guides/hardware-and-io.md).

## Dependencies and typegen

Each dependency value is an exact four-part version, `{ version, company?,
namespace? }`, or `{ path, namespace? }`. See [libraries](../guides/libraries.md).

| Typegen field | Default / meaning                                    |
| ------------- | ---------------------------------------------------- |
| `types`       | Optional ST type directory or array of directories   |
| `globals`     | Optional ST global directory or array of directories |
| `out`         | `"generated/plc.ts"`                                 |
| `hardwareOut` | `"generated/hardware.ts"`                            |

Without explicit directories, typegen infers declarations from emitted ST in a
TS project or `build.sourceDir` in a raw-ST project. Unified raw-ST builds only
generate the PLC contract when `typegen` is explicitly configured.

## Monitor

| Field                  | Default / meaning                                      |
| ---------------------- | ------------------------------------------------------ |
| `endpoint`             | Required if `monitor` is set; OPC UA endpoint URL      |
| `namespaceUri`         | Optional namespace selection by URI                    |
| `symbols`              | Optional qualified symbol list                         |
| `securityMode`         | `"SignAndEncrypt"`; also `"Sign"` or explicit `"None"` |
| `securityPolicy`       | `"Basic256Sha256"` for secure modes; `"None"` for None |
| `certificateDirectory` | `".vplc/opcua-pki"`, relative to the config            |
| `username`             | Optional; omission uses anonymous authentication       |
| `passwordEnv`          | Optional environment variable name; requires username  |

None mode and None policy must match. Username authentication requires a secure
mode. Without `passwordEnv`, a configured username uses the extension's masked
prompt/SecretStorage. Certificate trust and publishing are described in
[VS Code](../guides/editor.md).

The authored public schema is [packages/config/src/schema.ts](../../packages/config/src/schema.ts).
Lower-level build defaults are defined in [build.ts](../../packages/config/src/build.ts).
