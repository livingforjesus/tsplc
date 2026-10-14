# vPLC toolchain

For step-by-step use, start with the [quickstart](../getting-started.md) and
[user documentation](../README.md). This page summarizes the toolchain boundaries.

A project uses one `vplc.config.ts` for compilation, Docker builds, libraries, type generation, hardware and monitoring. Run the workspace CLI with `bun run vplc`. A local archive installation exposes the `vplc` executable; see [packaging.md](packaging.md).

## TypeScript project

```ts
import { defineConfig, ms } from "@vplc/config";

export default defineConfig({
  name: "Example",
  backend: "codesys",
  compiler: {
    tsconfig: "tsconfig.json",
    programs: { main: { module: "src/main.ts", export: "scan" } },
  },
  tasks: [
    {
      name: "MainTask",
      schedule: { kind: "cyclic", interval: ms(10) },
      priority: 10,
      programs: ["main"],
    },
  ],
  io: { Motor: { address: "%QX0.0" } },
});
```

The PLC source can be ordinary control flow:

```ts
let running: BOOL = false;

export function scan(): void {
  running = !running;
  Motor = running;
}
```

Declare the logical output in `src/io.d.ts`:

```ts
declare let Motor: Output<BOOL>;
```

Use SDK globals in the PLC TypeScript configuration:

```json
{
  "compilerOptions": {
    "strict": true,
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "types": ["@vplc/compiler/globals"],
    "noEmit": true
  },
  "include": ["src/**/*.ts"]
}
```

Paths are relative to the root config, except paths inside `tsconfig.json`, which follow TypeScript resolution. Config is trusted host code; PLC source is inspected and never executed as JavaScript. The supported PLC subset is described in [language.md](language.md).

Each program belongs to exactly one cyclic task. Task order is call order. Shared mutable storage cannot be owned by different cyclic tasks. BOOL bindings use explicit bit addresses; numeric physical IO also requires `codesys.profile.numericAddressing` to select byte or element addressing. The compiler checks direction, width, alignment and overlap.

## Docker build

Add build settings to the same config:

```ts
build: {
  template: "templates/controller.project",
  outDir: "build/codesys",
  docker: { image: "vplc-build:3.5.22.30", cpuSet: "0-1" },
  symbols: true,
  removeObjects: ["PLC_PRG"],
}
```

The template supplies the target and topology. `removeObjects` removes named template objects before authored/generated objects are imported. The Frame example uses the explicit CPU set above because that vendor-compiler profile was validated with it.

Docker is the public build path. Host executable, Wine and command-processor settings are private to the pinned image and cannot be selected in project configuration.

```sh
bun run vplc configure
bun run vplc check --config vplc.config.ts
bun run vplc build --config vplc.config.ts --emit-only
bun run vplc build --config vplc.config.ts
```

`check` validates source and deployment settings without emitting ST. `build --emit-only` publishes ST with an `emitted` receipt. `build` invokes the Docker compiler and publishes a `vendor-compiled` receipt after the project, application and checksum have been verified. Building does not download or start the PLC.

Generated ST follows source folders under `.vplc/artifacts/st`. The vendor project and runtime application also live in `build.outDir`. Keep manual edits outside owned compiler output; the compiler refuses to overwrite modified generated files. `vplc clean` removes owned compiler artifacts and preserves the engineering cache.

Use `--format json` for a machine-readable result; build progress goes to stderr.

## Raw Structured Text

Omit `compiler` and configure authored ST directly:

```ts
import { defineConfig } from "@vplc/config";

export default defineConfig({
  backend: "codesys",
  build: {
    template: "templates/controller.project",
    sourceDir: "src",
    entry: "src/Main.st",
    outDir: "build/codesys",
  },
  io: { "LineIO.Start": { address: "%IX0.0", type: "BOOL" } },
});
```

`vplc build` or `vplc-build build` compiles this project without a TypeScript PLC compiler. Shared IO mappings are applied to scalar ST declarations in memory; authored files stay unchanged. Qualify a binding with `Object.Variable` to identify the intended declaration. Direct mappings must match its scalar type and address width.

Raw ST uses the same top-level `tasks` as TypeScript, with `programs` containing declared IEC PROGRAM names. Those tasks set their exact cyclic intervals, priorities and call order during build and deployment. If `tasks` is omitted, `build.task` selects a template task and the parsed entry PROGRAM becomes its call; the template supplies that task's timing and priority. Configure either top-level `tasks` or legacy `build.tasks`, rather than both.

The unified `vplc build` command also refreshes hardware binding types and the editor project snapshot. It generates PLC contracts during build only when `typegen` is explicitly configured; a raw-ST project can build without adopting generated TypeScript contracts. Use `vplc typegen` to refresh those files when building with the standalone `vplc-build` command.

## Hardware and generated types

Put descriptors beside source, for example in `eds/`. Select a device and its assemblies in the config; do not infer direction from an assembly number alone. A real example with scanner, conveyor and remote IO descriptors is in `examples/frame-assembly/hardware-testing`.

Run `vplc typegen` explicitly to generate both hardware bindings and PLC types from the selected sources. Defaults are `generated/hardware.ts` and `generated/plc.ts`; override them in `typegen`. Explicit `typegen.types` and `typegen.globals` directories can select declarations for a raw-ST project. `vplc typegen --check` checks committed generated files for staleness.

Import the generated hardware mapping type when authoring IO:

```ts
import type { HardwareIoMapping } from "./generated/hardware.ts";

io: {
  Start: { device: "adapter", channel: "inputs.Byte0.Bit0" },
} satisfies HardwareIoMapping
```

Typegen also writes `.vplc/project.json`. TypeScript projects publish actual emitted IO symbol paths; raw-ST projects retain explicitly qualified authored symbol paths. The VS Code Hardware & IO view uses it for dynamic configs, shows input/output channels with expandable byte bits, and displays configured driver status symbols. The view reads config literals safely and never imports the config when opening a workspace.

The hardware view also shows the selected EDS connection and EPATH, input/output assembly instances, configured addresses, effective payload lengths and declared capacities. Logical TypeScript IO aliases are published as read-only CODESYS symbols when symbol generation is enabled.

`vplc typegen --check` reads and compares outputs without writing project files. For PLC contract generation, missing or empty configured ST sources fail the check; a valid program-only source produces an empty PLC contract, so removed declarations cannot leave stale exports passing validation.

## CODESYS libraries

Dependencies use exact versions or local files:

```ts
dependencies: {
  Standard: "3.5.22.0",
  Util: { version: "3.5.22.0", company: "System" },
  Machine: { path: "libs/Machine.library", namespace: "Machine" },
}
```

Run `vplc install`. Archive payloads are discovered from their version index, stored under `.vplc/libraries`, and pinned by hash in `vplc.lock.json`. Keep the lockfile in source control. Use `--frozen-lockfile` during installation or build to reject changes to the pinned dependencies. These are vendor libraries, not PLC TypeScript npm source libraries.

## Runtime and online changes

Set `build.runtime` for a Compose runtime and `build.online` for the gateway/device connection. Credentials are named environment variables. Connection details belong in project config, not in PLC source.

```sh
vplc run --config vplc.config.ts
vplc download --config vplc.config.ts
vplc online-change --config vplc.config.ts
vplc inspect --config vplc.config.ts --read LineIO.Speed
```

`run` builds and loads the configured Compose runtime. `download` performs a full application transfer. `online-change` preserves and checks its online compiler baseline and applies a supported incremental update. `inspect` reads controller state without regenerating source.

Configure `monitor.endpoint`, optional `monitor.namespaceUri` and explicit `monitor.symbols` for the editor's read-only OPC-UA connection:

```ts
monitor: {
  endpoint: "opc.tcp://127.0.0.1:4840",
  securityMode: "SignAndEncrypt",
  securityPolicy: "Basic256Sha256",
  certificateDirectory: ".vplc/opcua-pki",
  username: "monitor-user",
  // passwordEnv: "PLC_MONITOR_PASSWORD", // optional alternative to SecretStorage
}
```

Encrypted `SignAndEncrypt` / `Basic256Sha256` sessions are the default. With a username, the extension reads the configured environment variable or asks for a masked password and saves it in VS Code SecretStorage for that endpoint/user. **Forget Monitor Password** removes the saved password. Passwords never belong in project config or the generated snapshot. An explicit `None` session supports anonymous access only.

The certificate directory is relative to the project. Unknown PLC certificates are rejected; the extension never automatically trusts them. Review the server certificate under `rejected/`, compare its fingerprint with the certificate exported from the intended PLC, then deliberately move the verified certificate into `trusted/certs/` before reconnecting. These paths are under `certificateDirectory`. The PLC must also trust the client certificate generated under `own/certs/` in that directory. Use the runtime's certificate manager to install that verified client certificate.

A successful engineering connection does not imply that OPC-UA symbols are published: configure the template's server and enable the relevant symbols. Values display server quality and timestamps; absent symbols remain unavailable and old values become stale after a connection loss.

For existing external interfaces, `codesys.globalListNames`, `codesys.programNames` and `codesys.publishGlobalLists` preserve selected IEC names and publication. The Frame example preserves its four application GVLs so existing simulation and OPC-UA clients can continue to use their paths.
