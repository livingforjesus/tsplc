# Garden controller

Complete PLC-TS port of Toni Kucic's MIT-licensed [CODESYS garden-controller application](https://github.com/tkucic/plc_garden_controller/tree/ef3e937c8ead73a7078925b0da32fca59c85379b), pinned to `ef3e937c8ead73a7078925b0da32fca59c85379b`.

Four gardens each contain 25 simulated flowers and a persistent automatic watering controller. The application retains every route coordinate, manual and diagonal movement commands, automatic target/dwell progression, platform feedback, humidity, flower color/liveness, native clock pulse and DWORD color packing. A 20 ms priority-1 task runs control before simulation, in the original order.

Source is grouped by controller, watering block, simulator, geometry, colors and explicit initialized garden data. `port.json` maps all 18 original PLCopen objects. [PORT.md](./PORT.md) explains preserved behavior and representation changes. All 27 upstream files, including the original project and visualization, remain unchanged in `upstream/`; `upstream.json` records their hashes. The source and derived port retain the upstream [MIT license](./LICENSE).

From the repository root:

```sh
bun run vplc check --config examples/garden-controller/vplc.config.ts
bun run vplc build --emit-only --config examples/garden-controller/vplc.config.ts
bun test examples/garden-controller/tests/garden.test.ts --timeout 20000
bunx tsc -p examples/garden-controller/tsconfig.json
bunx tsc -p examples/garden-controller/tsconfig.host.json
```

Start Docker and prepare the compiler image as described in [examples/README.md](../README.md), then compile through the CODESYS toolchain:

```sh
bun run vplc build --config examples/garden-controller/vplc.config.ts
```

`@vplc/build` compiles a private copy of the shared virtual engineering template with CODESYS inside Docker. Build receipts distinguish source admission/emission from vendor compilation. Generated ST and copied build artifacts are under `.vplc/artifacts/`; the vendor build directory is `build/`. These commands compile without downloading or starting a PLC application. The archived visualization has not been rebound to generated object names.
