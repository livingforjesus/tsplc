# vPLC examples

Each example contains maintained PLC TypeScript source, one `vplc.config.ts`, and an explicit cyclic task. The imported applications preserve their complete authored controller and simulator logic. Their original visualization and device setup remain archived; generated programs use the shared virtual engineering target.

| Example                                            | Scope                                                                             | Task              |
| -------------------------------------------------- | --------------------------------------------------------------------------------- | ----------------- |
| [Frame assembly](./frame-assembly/PORT.md)         | Full existing frame-assembly application port                                     | 20 ms, priority 1 |
| [Traffic control](./traffic-control/README.md)     | Two crossroads, twelve sprites, ordered collision checks and police/fault signals | 5 ms, priority 1  |
| [Mixing tank](./mixing-tank/README.md)             | Manual/automatic sequence and four persistent device models                       | 20 ms, priority 1 |
| [Garden controller](./garden-controller/README.md) | Four gardens with 25 flowers each, watering routes and humidity/color simulation  | 20 ms, priority 1 |

The three imported applications retain their MIT licenses, every pinned upstream file, and SHA-256 provenance. Each `port.json` maps the original PLCopen source objects to maintained source files. The [research record](../docs/compiler/research/open-source-examples.md) gives repository links, commit pins, measured source scope, dependencies and the reasons other candidates were not selected. Start with the [user documentation](../docs/README.md) for configuration and language guides.

## Check and build

Run from the repository root:

```sh
bun install
bun run vplc check --config examples/traffic-control/vplc.config.ts
bun run vplc build --config examples/traffic-control/vplc.config.ts --emit-only
bun test examples tests/upstream-examples.test.ts --timeout 20000
```

Replace `traffic-control` with another example directory to check or emit it. `check` validates the PLC program, and `build --emit-only` writes Structured Text without running Docker. Generated ST is under each example's `.vplc/artifacts/st/`.

For a complete CODESYS build, start Docker and run:

```sh
bun run vplc configure --config examples/traffic-control/vplc.config.ts
bun run vplc build --config examples/traffic-control/vplc.config.ts
```

`configure` creates the pinned compiler image; reuse it for subsequent builds. `@vplc/compiler` emits ST and `@vplc/build` compiles it with CODESYS inside Docker, producing a project, boot application and CRC. No host CODESYS or Wine installation is required. The project config selects `build.docker` options and `build.template`; see the [toolchain guide](../docs/compiler/toolchain.md).

A successful vendor build records `vendor-compiled` in `.vplc/artifacts/receipt.json`; emission records `emitted`. Vendor outputs also live in the configured `build.outDir`: `build/` for the three imported applications and `build/codesys/` for frame assembly. The checked-in templates remain unchanged; builds use private copies and replace their task plans.

The imported applications use [templates/virtual.project](./templates/README.md), prepared with Util 3.5.22.0 for `Util.BLINK`. Frame assembly retains its original local template. These build commands do not download or start a PLC. Behavior tests execute normalized compiler IR with timer/edge models. The BLINK model supports fixed positive durations sampled at exact phase boundaries; these tests do not establish hardware timing or rebind the archived HMI.
