# Traffic control

Complete PLC-TS port of Toni Kucic's MIT-licensed [CODESYS traffic-control project](https://github.com/tkucic/plc_traffic_control/tree/49c9de4e8ce588de3fd7f831e5f78ce6e303c1d9), pinned to `49c9de4e8ce588de3fd7f831e5f78ce6e303c1d9`.

The port includes the controller, full simulator, twelve persistent sprites, all eight simulator actions, all three record types, the global I/O image, all 51 ordered collision checks, fault handling and police blinking. Its single 5 ms, priority-1 task calls the controller before the simulator, preserving the upstream program-call order.

The maintained source is grouped by responsibility under `src/`. `port.json` maps every PLCopen source object to its implementation. [PORT.md](./PORT.md) explains the preserved behavior and representation changes. `upstream/` preserves every file of the pinned repository, including the original CODESYS project, readable export, documentation and visualization assets; `upstream.json` records their hashes. Both the copied source and this derived port retain the upstream [MIT license](./LICENSE).

From the repository root:

```sh
bun run vplc check --config examples/traffic-control/vplc.config.ts
bun run vplc build --emit-only --config examples/traffic-control/vplc.config.ts
bun test examples/traffic-control/tests/traffic.test.ts --timeout 20000
bunx tsc -p examples/traffic-control/tsconfig.json
bunx tsc -p examples/traffic-control/tsconfig.host.json
```

For actual CODESYS compilation, start Docker and prepare the compiler image as described in [examples/README.md](../README.md), then run:

```sh
bun run vplc build --config examples/traffic-control/vplc.config.ts
```

That build uses `@vplc/build` and CODESYS inside Docker with a private copy of the shared engineering template and its Util library. Build receipts distinguish source emission from vendor compilation. Generated ST and copied build artifacts are under `.vplc/artifacts/`; the vendor build directory is `build/`. These commands compile without downloading or starting a PLC application.

The original visualization remains archived in `upstream/`; it has not been rebound to the generated PLC-TS object names. The generated example compiles the full authored control and simulator logic against the shared virtual target rather than recreating the original device and UI configuration.
