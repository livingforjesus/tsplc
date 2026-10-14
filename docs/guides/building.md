# Build a project

[Documentation home](../README.md) · [CLI reference](../reference/cli.md)

vPLC has three distinct operations: checking source, compiling an application,
and loading it onto a runtime. A successful build does not start a PLC.

## Choose a template

`build.template` points to an existing CODESYS `.project`. It supplies the device,
runtime version, fieldbus topology and target-specific settings. Use a template
for the intended controller, or the supplied `examples/templates/virtual.project`
for the example virtual target. EDS files describe IO layouts; they do not create
the template's scanner or physical device tree.

Add build settings to the same config that selects your TypeScript programs:

```ts
build: {
  template: "templates/controller.project",
  outDir: "build/codesys",
  docker: { image: "vplc-build:3.5.22.30" },
  removeObjects: ["PLC_PRG"],
  symbols: true,
},
```

`removeObjects` removes the named template objects before source import. Use it
for a template's placeholder program or other objects you deliberately replace.
`symbols` requests symbol generation for clients such as the OPC UA monitor.

## Prepare Docker

Install and start Docker with a Linux server. The public toolchain compiles in
Docker; project config does not select a host IDE executable or Wine installation.

```sh
bun run vplc configure
```

This builds `vplc-build:3.5.22.30` using the pinned official CODESYS installer.
ARM hosts use FEX for installation and AMD64 Wine for the compiler runtime. The
image build performs an offline compilation and saved-project reopen check.

For an already downloaded official installer, the maintained shell entry point
accepts its path and verifies its checksum:

```sh
packages/build/docker/build-image /path/to/CODESYS-64-3.5.22.30.exe
```

The path in this command is an example placeholder. See
[Docker reliability](../build-reliability.md) for the pinned image's measured
behavior and retained limits.

## Check, emit and compile

```sh
bun run vplc check
bun run vplc build --emit-only
bun run vplc build --frozen-lockfile
```

`check` validates configuration, TypeScript and PLC semantics. It does not emit
source or invoke the vendor compiler. `build --emit-only` creates ST and an
`emitted` receipt. A full `build` additionally invokes CODESYS and creates a
`vendor-compiled` receipt after verifying artifacts and clean worker shutdown.
Use `--frozen-lockfile` after [installing and locking libraries](libraries.md).

For TypeScript, generated output is organized as follows:

```text
.vplc/
  artifacts/
    st/                 # Source-shaped ST, mappings and IO symbol metadata
    vendor/             # Application.project/.app/.crc after a full build
    manifest.json       # Owned files and their hashes
    receipt.json        # emitted or vendor-compiled
  project.json          # Editor/hardware project snapshot
build/codesys/          # build.outDir: reusable engineering/controller cache
  Application.project
  runtime/
    Application.app
    Application.crc
  build.json
```

Names and folders in generated ST follow the source modules; support objects are
also generated for state, IO and lowered operations. `codesys.programNames` and
`codesys.globalListNames` can preserve selected existing IEC names.

Keep authored edits in source and config. If generated files have been edited or
unrelated files are present, the compiler stops rather than replacing them.
`vplc clean` removes owned TypeScript artifacts while preserving the separate
engineering cache and controller baseline. An engineering directory belongs to
one config; use a new `build.outDir` when creating a different project.

## Build raw Structured Text

Omit `compiler`. Point `build.sourceDir` at the source tree and `build.entry` at
its entry program:

```ts
import { defineConfig, ms } from "@vplc/config";

export default defineConfig({
  backend: "codesys",
  tasks: [
    {
      name: "MainTask",
      schedule: { kind: "cyclic", interval: ms(20) },
      priority: 1,
      programs: ["Main"],
    },
  ],
  build: {
    template: "templates/controller.project",
    sourceDir: "src",
    entry: "src/Main.st",
    outDir: "build/codesys",
    removeObjects: ["PLC_PRG"],
  },
});
```

Task program names are declared IEC PROGRAM names in a raw-ST project. Without
top-level `tasks`, `build.task` selects an existing template task and retains its
timing/priority. Do not configure both scheduling mechanisms.

```sh
bun run vplc check
bun run vplc build
```

Raw ST is already emitted, so `--emit-only` is not supported for it. The standalone
`vplc-build` executable supports this same raw-ST build path without the
TypeScript compiler package. Unified `vplc build` also refreshes hardware/editor
metadata; raw-ST PLC contract generation is opt-in through `typegen`.

Complete `.st` files and split declaration/implementation layouts are supported.
See the [ST extension guide](../../packages/vscode-extension/README.md#source-layouts)
for representative folders. Raw ST can use native CODESYS language features and
libraries appropriate to the template; the PLC TypeScript subset does not limit
the raw source sent to the vendor compiler.

Continue with [deployment](deployment.md) to load the built application, or
[testing](testing.md) to choose the right verification level.
