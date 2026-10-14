# vPLC

Write PLC programs in TypeScript, compile them to Structured Text, and build them
with CODESYS in Docker. Raw Structured Text projects use the same build tool.

Start with the [quickstart](docs/getting-started.md), then use the
[documentation](docs/README.md) for the TypeScript handbook, builds, hardware/IO,
libraries, deployment, VS Code and configuration reference.

This Bun monorepo contains:

| Package                     | Responsibility                                                                       |
| --------------------------- | ------------------------------------------------------------------------------------ |
| `@vplc/config`              | Shared `vplc.config.ts` schema and path resolution                                   |
| `@vplc/compiler`            | TypeScript analysis, PLC semantics, Structured Text emission and project CLI         |
| `@vplc/build`               | Docker CODESYS compilation, library installation, runtime loading and online changes |
| `@vplc/typegen`             | PLC contracts, EDS layouts and typed IO mappings                                     |
| `packages/vscode-extension` | VSIX with ST language support, hardware mapping, tasks and live OPC UA monitoring    |

Install Bun 1.4.3 or later, then run:

```sh
bun install
bun run check
bun run pack
```

The project configuration belongs beside its source and hardware descriptions.
Build, compiler, typegen and editor tooling read that same file:

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
  build: {
    template: "templates/local.project",
    docker: { image: "vplc-build:3.5.22.30" },
  },
  eds: "eds",
  dependencies: { Standard: "3.5.22.0" },
});
```

PLC source uses explicit IEC numeric types and fixed layouts. Ordinary `for`
updates work, including persistent instance counters; no post-loop assignment is
needed. Emitted folders follow source directories, and authored DUT names stay
readable in CODESYS.

```sh
bun run vplc install
bun run vplc typegen
bun run vplc check
bun run vplc build
bun run vplc run
```

`vplc build --emit-only` checks and emits ST without running Docker. A raw ST
project omits `compiler` and configures `build.sourceDir` and `build.entry`.
`download`, `online-change` and `inspect` use the configured gateway and controller;
online changes retain and verify their compiler baseline.

Put EDS files in `eds/`, select assembly instances and process-image addresses in
`devices`, then map named channels in `io`. `vplc typegen` generates
`HardwareIoMapping` for checked device/channel selections. The supplied Cognex,
ConveyLinx and B&R examples are exercised in
[`examples/frame-assembly/hardware-testing`](examples/frame-assembly/hardware-testing).
Device topology and fieldbus driver configuration belong in the CODESYS template;
EDS declarations describe hardware, while live values come from published OPC UA
symbols.

Libraries resolve exact names and four-part versions from the CODESYS archive.
Local `.library` and `.compiled-library` paths are supported too. Payload hashes
and exact dependencies are saved in `vplc.lock.json`; use `--frozen-lockfile` for a
reproducible build.

The extension uses encrypted OPC UA sessions by default, project-specific trusted
certificates, and environment or VS Code SecretStorage credentials. Its hardware
view shows mappings, connection state, sample quality and timestamps.

For integration and contributors, see [local package installation](docs/compiler/packaging.md),
[compiler architecture](docs/compiler/architecture.md),
[tested EDS layouts](docs/research/actual-eds-files.md) and
[validation results](docs/validation.md).

The maintained compiler backend is CODESYS. Backend emission and engineering are
separate modules so additional targets can reuse the frontend and checked PLC IR.
The Docker image runs the vendor compiler; experimental native compiler
reconstruction is outside this toolchain.
