# Packages and SDK entry points

[Documentation home](../README.md) · [Installation](../compiler/packaging.md)

The Bun monorepo shares one project config. Use the unified CLI for ordinary
project work; public package APIs are available for programmatic integration.

| Package                     | Public responsibility                                                     |
| --------------------------- | ------------------------------------------------------------------------- |
| `@tsplc/config`             | Typed root config, validation, path loading and task durations            |
| `@tsplc/compiler`           | TypeScript frontend, PLC checks and project orchestration                 |
| `@tsplc/build`              | CODESYS Docker compilation and engineering operations; usable with raw ST |
| `@tsplc/typegen`            | ST contracts, EDS layouts and hardware/config binding types               |
| `packages/vscode-extension` | Packaged editor extension/VSIX; not a published npm dependency            |

The current backend is CODESYS. Frontend/IR checking and backend emission are
separate, but another backend is not selectable until implemented.

## Config

Import `defineConfig`, `ms`, `seconds`, `ns` and `loadTsplcConfig` from
`@tsplc/config`. The normal authored interface is `TsplcConfig`.

The `@tsplc/config/build` subpath supplies the lower-level CODESYS build schema,
`defineBuildConfig` and `resolveConfig`. The package root also exports the
backend-independent `definePlcConfig` helper and compiler configuration types.
Ordinary applications should keep using the root `defineConfig` rather than
maintaining separate files.

## PLC source SDK

`@tsplc/compiler/globals` is the ambient declaration entry used in
`tsconfig.compilerOptions.types`. `@tsplc/compiler/types` contains canonical IEC
types and compiler-recognized operations. These are declarations for the PLC
compiler, not a JavaScript runtime implementation.

| Group                 | Names                                                                                                                                |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Scalars               | `BOOL`, signed/unsigned integer types, bit strings, `REAL`, `LREAL`                                                                  |
| Layouts               | `FixedArray`, `STRING`, `WSTRING`, `defaultValue`, `copy`                                                                            |
| IO and borrowing      | `Input`, `Output`, `InOut`, `ref`                                                                                                    |
| Blocks                | `FunctionBlock`, `TON`, `TOF`, `TP`, `R_TRIG`, `F_TRIG`, `BLINK`                                                                     |
| Retention             | `retain`                                                                                                                             |
| Time/calendar         | `TIME`, `DATE`, `TIME_OF_DAY`, `DATE_AND_TIME`, `ms`, `seconds`, `minutes`, `timeToMilliseconds`, `date`, `timeOfDay`, `dateAndTime` |
| Conversion            | `exact`, `wrap`, `saturate`                                                                                                          |
| Wrapping arithmetic   | `wrapAdd`, `wrapSubtract`, `wrapMultiply`                                                                                            |
| Saturating arithmetic | `saturatingAdd`, `saturatingSubtract`, `saturatingMultiply`                                                                          |
| Integer division      | `div`                                                                                                                                |

Ambient globals cover the common types/layouts, blocks, time helpers, copying,
borrowing and retention. Import arithmetic/conversion functions from
`@tsplc/compiler/types`. `@tsplc/compiler/math` exports PLC TypeScript implementations
of `min`, `max` and `clamp`.

See the [handbook](../language/README.md) for examples and
[canonical declarations](../../packages/compiler/types/index.d.ts) for signatures.
Do not execute these declaration-only intrinsics as ordinary JavaScript in tests.

## Project and engineering APIs

`@tsplc/compiler/project` exports `checkProject`, `buildProject` and `cleanProject`.
They take a config filename; `buildProject` can use `{ emitOnly: true }`. Results
contain diagnostics and, on successful builds, the publication directory/status.

`@tsplc/build` exports `buildProject`, `readBuild`, `configureDocker`, `runProject`,
`updateController` and `inspectController`. Build/run/controller operations use
resolved CODESYS settings. `readBuild(directory)` validates saved artifacts and
their receipt; `configureDocker(image?)` builds the selected/default image. Its
`defineConfig` is the builder configuration helper, distinct from the root shared
helper in `@tsplc/config`.

`@tsplc/build/libraries` exposes library resolution/validation APIs. The root build
package also exports `loadSources`, `parseSource`, syntax/compiler error types and
configuration types.

`@tsplc/typegen` exports `generateProject(configFile, options)` for the shared
workflow and `generateTypes({ types, globals })` for declaration directories.
`@tsplc/typegen/hardware` exposes descriptor loading, IO resolution and hardware
type generation.

Compiler internals have explicit `@tsplc/compiler/ir` and
`@tsplc/compiler/codesys` subpaths. Use them when implementing tooling/backends;
they are not required to author PLC programs. Their contracts and invariants are
described in the [compiler architecture](../compiler/architecture.md).
