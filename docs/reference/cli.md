# CLI reference

[Documentation home](../README.md)

The unified executable is `tsplc`. In this checkout, run `bun run tsplc`; in an
external project, install the archives and add a `"tsplc": "tsplc"` package script
for that same spelling. Config defaults to `tsplc.config.ts` in the current
directory.

```sh
bun run tsplc --help
bun run tsplc check --config path/to/tsplc.config.ts --format json
```

## Commands

| Command         | Result and effects                                                                         |
| --------------- | ------------------------------------------------------------------------------------------ |
| `configure`     | Build the pinned Docker compiler image; no project compilation/download                    |
| `install`       | Resolve vendor dependencies, cache payloads and write/check the lockfile                   |
| `typegen`       | Generate hardware types, PLC contracts and editor project snapshot                         |
| `check`         | Check TS/config/PLC semantics, or raw ST source structure; no vendor compilation           |
| `build`         | Emit/check current TS source and invoke the vendor compiler; raw ST goes directly to build |
| `run`           | Build, install into the configured Compose service and start it                            |
| `download`      | Compile/transfer to the configured controller and establish its baseline/boot application  |
| `online-change` | Validate the saved baseline, apply a supported update and refresh boot/baseline            |
| `inspect`       | Read the saved controller connection/state and requested symbols without re-emission       |
| `clean`         | Remove owned TS compiler artifacts; retain the separate engineering/controller cache       |

`configure` can run without a config when building the default image. A custom
image name comes from `build.docker.image`. `inspect` deliberately remains usable
when local source, EDS or library caches are unavailable.

## Flags

| Flag                    | Use                                                                                                   |
| ----------------------- | ----------------------------------------------------------------------------------------------------- |
| `--config PATH`         | Select the root config; supported by project commands                                                 |
| `--help`, `-h`          | Display usage                                                                                         |
| `--format text`         | Human-readable output; default                                                                        |
| `--format json`         | Machine-readable command result; progress goes to stderr                                              |
| `--emit-only`           | `build` with TypeScript: publish ST without Docker; rejected for raw ST                               |
| `--frozen-lockfile`     | `install`, `build`, `run`, `download`, `online-change`: require locked dependency selections/payloads |
| `--check`               | `typegen`: compare outputs without writing them                                                       |
| `--read IEC_EXPRESSION` | `inspect`/`download`/`online-change`: read a qualified symbol; repeat for several                     |
| `--initialize-user`     | Explicit controller user initialization during download where supported                               |

For example:

```sh
bun run tsplc build --emit-only --format json
bun run tsplc install --frozen-lockfile
bun run tsplc typegen --check
bun run tsplc inspect --read Line.Infeed.Speed --read Line.Status.State --format json
```

A failed operation exits nonzero. JSON diagnostics preserve their origin,
severity, message and available source span. An `emitted` result proves emission;
only `vendor-compiled` proves a successful vendor build. A controller operation
returns its own receipt with application/code/data identities.

## Standalone raw-ST builder

`tsplc-build` belongs to `@tsplc/build`. It supports `configure`, `install`, `check`,
`build`, `run`, `download`, `online-change` and `inspect`. It uses the shared config
but rejects TypeScript projects for build/deployment; use `tsplc` for those.

```sh
bunx --no-install tsplc-build check --config tsplc.config.ts
bunx --no-install tsplc-build build --config tsplc.config.ts
```

These commands assume the local package is already installed. The builder does
not expose the unified CLI's `--emit-only`, `--format` or `clean` flags/command.

## Standalone typegen

`tsplc-typegen` belongs to `@tsplc/typegen`. It can use the shared config or read ST
declaration directories directly:

```sh
bunx --no-install tsplc-typegen --config tsplc.config.ts
bunx --no-install tsplc-typegen --types src/types --globals src/globals --out generated/plc.ts
bunx --no-install tsplc-typegen --types src/types --globals src/globals --out generated/plc.ts --check
```

The direct-directory form requires `--types` and `--out`; the output must be a
`.ts` file rather than `.d.ts` because it contains runtime metadata. For TypeScript
projects, the unified `tsplc typegen` command additionally performs the hardware
bootstrap and ST emission before generating contracts.
