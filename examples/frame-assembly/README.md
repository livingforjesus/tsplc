# Frame-assembly PLC port

This example ports every authored PLC source file from the supplied frame-assembly project. The scan calls conveyor setup, scanner handshakes, then diverter sequencing. `@vplc/compiler` transpiles the TypeScript to Structured Text, and `@vplc/build` compiles it with CODESYS in Docker. PLC TypeScript is compiler input: do not import or execute `src/` in JavaScript.

Run these commands from the repository root:

```sh
bun install
bun run vplc configure
bun run vplc check --config examples/frame-assembly/vplc.config.ts
bun run vplc build --config examples/frame-assembly/vplc.config.ts --emit-only
bun run vplc build --config examples/frame-assembly/vplc.config.ts
```

`vplc.config.ts` selects the source, cyclic task, template, Docker image and symbol publication. `check` validates the complete program without executing it. `build --emit-only` produces Structured Text without running Docker. `build` imports that output into a private copy of the template, verifies the single MainTask at 20 ms/priority 1, then compiles a project and boot application. These commands do not download or start the PLC. Generated ST belongs to `.vplc/artifacts/st`; vendor outputs belong to `build/codesys`.

The copied template targets CODESYS Virtual Control for Linux ARM64 and was saved with CODESYS V3.5 SP22 Patch 3. `vplc configure` builds the pinned compiler image, including the ARM64 device description and required libraries. The example selects `vplc-build:3.5.22.30` and CPU set `0-1`. See the shared [toolchain documentation](../../docs/compiler/toolchain.md) for Docker setup, library dependencies, runtime connections and encrypted monitoring.

The five original GVL names and their exported variable/record field names are preserved for the existing OPC UA bridge. `publishGlobalLists` selects LineIO, LineStations, LineCollections, and LineScannerRequests: generated GVLs retain unused device roots and publish each root with read/write symbol access. LineConstants stays an internal constant list. The copied template and `symbols: true` provide the classic Symbol Configuration. Cards remain indexed 1..256; scanner results and request barcodes remain 484 bytes, and scanner user data remains 492 bytes. Numeric enums retain every original DINT value. Collection Full defaults to true and station Capacity to 2 at every authored storage declaration. The lift's default three-second request budget is supplied explicitly at its sole call site.

See [PORT.md](PORT.md) for the complete source/hash manifest and [src/README.md](src/README.md) for control and wiring notes. The source notes also describe the original application's bridge and simulation; those companion systems are outside this port. Commissioning assumptions and unresolved installation questions are preserved, including lift overload qualification and diverter occupancy coverage. The virtual template has no commissioned electrical/fieldbus mapping.
