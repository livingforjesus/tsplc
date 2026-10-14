# Authored PLC source

Edit `types/` and `globals/` directly. They own the interface types, constants, descriptions, and global variable inventory consumed by both the PLC and TypeScript applications.

From the repository root, regenerate the TypeScript contract after editing declarations:

```sh
bun turbo run typegen --filter=@bottling-line/contract
```

`codesys-typegen` reads these folders and writes `packages/bottling-line/contract/src/_generated/plc.ts`. It never writes to this source tree. Commit the generated contract together with the source change; tests reject stale output.

`Main.st` is the configured task entry. `transport/FB_ZoneConveyor/` contains authored conveyor behavior and its methods. Programs and function blocks stay outside `types/` and `globals/` because type generation reads interface declarations only. The `codesys-build` package imports the entire source tree and supports combined ST files and declaration/implementation pairs.

Changes to the PLC application still require rebuilding and downloading it. A copied PLC folder builds independently of the monorepo contract and type generator.
