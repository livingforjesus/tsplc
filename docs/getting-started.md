# Getting started

[Documentation home](README.md)

This tutorial creates a Start/Stop latch, checks its PLC types and emits
Structured Text. Docker and a controller are only needed for the later build and
deployment steps.

## Install the workspace

From the tsPLC checkout, use Bun 1.4.3 or later:

```sh
bun install
```

There is no published tsPLC npm release yet. To use it in another repository, build
and install the [local archives](compiler/packaging.md). Do not substitute an
unpublished registry package for those archives.

## Create the project

From the checkout root:

```sh
mkdir -p examples/quickstart/src
```

Create these four files:

```text
examples/quickstart/
  tsplc.config.ts
  tsconfig.json
  src/
    io.d.ts
    main.ts
```

`examples/quickstart/tsconfig.json` enables the PLC SDK's ambient types and
intrinsics:

```json
{
  "compilerOptions": {
    "strict": true,
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "types": ["@tsplc/compiler/globals"],
    "noEmit": true
  },
  "include": ["src/**/*.ts"]
}
```

`examples/quickstart/src/io.d.ts` declares logical inputs and an output. Inputs
are readonly to PLC code:

```ts
declare const Start: Input<BOOL>;
declare const Stop: Input<BOOL>;
declare let Motor: Output<BOOL>;
```

`examples/quickstart/src/main.ts` is called on every configured scan. The module
variable keeps its value between calls, and Stop wins if both inputs are true:

```ts
let running: BOOL = false;

export function main(): void {
  if (Stop) {
    running = false;
  } else if (Start) {
    running = true;
  }
  Motor = running;
}
```

`examples/quickstart/tsplc.config.ts` selects the program, its task and the logical
IO addresses. These addresses illustrate a small process image; use the addresses
assigned by your real target and topology when adapting it:

```ts
import { defineConfig, ms } from "@tsplc/config";

export default defineConfig({
  name: "Quickstart",
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
  io: {
    Start: { address: "%IX0.0" },
    Stop: { address: "%IX0.1" },
    Motor: { address: "%QX0.0" },
  },
});
```

Paths in this config are relative to `examples/quickstart`, even though the
following commands run from the checkout root. Task program names refer to the
keys in `compiler.programs`, not to filenames.

## Check and emit

```sh
bun run tsplc check --config examples/quickstart/tsplc.config.ts
bun run tsplc build --config examples/quickstart/tsplc.config.ts --emit-only
```

The first command checks TypeScript and PLC semantics. The second writes ST and a
receipt with status `emitted` under `examples/quickstart/.tsplc/artifacts/`. Neither
command transfers anything to a PLC. Source files are analyzed, not run as JavaScript.

Open `.tsplc/artifacts/st/` to inspect the result. Its directories follow the source
modules. Leave edits in `src/`; generated files are owned by the compiler and a
later build refuses to overwrite files you changed manually.

## Build with CODESYS

A template `.project` supplies the device, runtime version, libraries and
fieldbus topology. For this checkout's virtual target, copy the supplied template:

```sh
cp examples/templates/virtual.project examples/quickstart/template.project
```

Add this section to `defineConfig({ ... })`:

```ts
build: {
  template: "template.project",
  outDir: "build/codesys",
  docker: { image: "tsplc-build:3.5.22.30" },
  removeObjects: ["PLC_PRG"],
  symbols: true,
},
```

Start Docker, then build the compiler image if it is not already installed:

```sh
bun run tsplc configure --config examples/quickstart/tsplc.config.ts
bun run tsplc build --config examples/quickstart/tsplc.config.ts
```

`configure` installs the vendor toolchain into an image and can take substantially
longer than a project build. A successful project build produces the CODESYS
project, application and checksum and records `vendor-compiled`. This command
compiles the program; it does not download it or start a controller.

Use a template for your actual target before deployment. Continue with the
[build guide](guides/building.md), [TypeScript handbook](language/README.md) or
[deployment guide](guides/deployment.md).
