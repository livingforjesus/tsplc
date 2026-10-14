# Mixing tank

Complete PLC-TS port of Toni Kucic's MIT-licensed [CODESYS mixing-tank application](https://github.com/tkucic/plc_hello_mixing_tank/tree/17e0213b1c7c46fd44ff7d9a52a6bb9e500d65de), pinned to `17e0213b1c7c46fd44ff7d9a52a6bb9e500d65de`.

The application retains manual operation, the full automatic drain–fill–mix cycle, command/feedback latches, four persistent delayed device models, tank-level simulation, both motor rotations, enum states and all IO/HMI fields. A single 20 ms, priority-1 task invokes the controller before the simulator, preserving the upstream call order.

Source is grouped under `src/` by controller, simulator, model and global images. `port.json` maps all seven authored PLCopen objects; [PORT.md](./PORT.md) documents scope and representation changes. All 18 pinned repository files remain unchanged in `upstream/`, with hashes in `upstream.json`, including the original native project and visualization assets. Copied source and the derived port retain the upstream [MIT license](./LICENSE).

From the repository root:

```sh
bun run vplc check --config examples/mixing-tank/vplc.config.ts
bun run vplc build --emit-only --config examples/mixing-tank/vplc.config.ts
bun test examples/mixing-tank/tests/mixing.test.ts --timeout 20000
bunx tsc -p examples/mixing-tank/tsconfig.json
bunx tsc -p examples/mixing-tank/tsconfig.host.json
```

Start Docker and prepare the compiler image as described in [examples/README.md](../README.md), then compile through the vendor toolchain:

```sh
bun run vplc build --config examples/mixing-tank/vplc.config.ts
```

`@vplc/build` compiles a private copy of the shared virtual engineering target with CODESYS inside Docker. Build receipts distinguish source emission from vendor compilation. Generated ST and copied build artifacts are under `.vplc/artifacts/`; the vendor build directory is `build/`. These commands compile without downloading or starting a PLC application.

The complete authored controller and simulator are ported. The original visualization is archived, rather than rebound to generated PLC-TS object names; its device/UI configuration is not recreated by the shared virtual template.
