# Troubleshooting

[Documentation home](README.md) · [CLI reference](reference/cli.md)

Start with the failed command and its diagnostic origin. `--format json` on the
unified CLI keeps results machine-readable while sending progress to stderr.
Preserve the error and its worker log before changing a template or cache.

## PLC types are unknown

Add `"types": ["@tsplc/compiler/globals"]` to the PLC `tsconfig.json`, include
the actual `.ts`/`.d.ts` source roots, and ensure the compiler package is installed
where TypeScript can resolve it. An external project must install the local
archives with the root overrides described in [packaging](compiler/packaging.md).

## TypeScript accepts it but tsPLC rejects it

The TypeScript checker and PLC checker have different jobs. tsPLC additionally
checks IEC widths, overflow, finite floats, fixed layouts, borrows, static bounds
and task ownership. A cast or `@ts-ignore` does not remove those requirements.
Read the [handbook](language/README.md) and [semantic reference](compiler/language.md).

## An IO mapping fails

Check its direction, declared IEC type, address width/alignment and overlaps.
For EDS bindings, verify the selected connection, assembly instance, payload size
and generated channel ID. Numeric bindings need an explicit
`codesys.profile.numericAddressing`. Refresh generated types after changing the
descriptor or selections. EDS offsets do not establish a device's actual
process-image address; that must match the template.

## Generated types are missing or stale

For a new EDS project, generate hardware types before declaring logical IO in PLC
source, then add declarations, mappings and the type-only `HardwareIoMapping`
import. Existing source needs its valid plain IO mappings during this bootstrap;
omit the generated-type import until the file exists. Rerun typegen after
source/hardware changes and use `typegen --check` to verify committed outputs.
A TS contract check needs emitted ST first. A raw-ST contract check needs its
actual declaration sources; old generated files cannot validate missing/empty
source.

## A build refuses to replace files

Generated files are tracked by ownership/hashes. Move your authored edits out of
the generated directory and restore/remove deliberately edited outputs before
rebuilding. `clean` preserves modified/unrelated files rather than treating them
as disposable source. For an unrelated engineering cache, select a fresh
`build.outDir`; do not borrow another config's ownership marker.

## Docker or compiler startup fails

Confirm the Docker server is running and the selected image exists:

```sh
docker info
docker image inspect tsplc-build:3.5.22.30
```

Use `tsplc configure` to build a missing image. Startup can take several minutes,
especially during first installation. The build's default startup/build timeouts
are 20 minutes, not the PLC scan period.

Inspect the worker path printed by the command. A native assertion, signal,
nonzero/missing exit record or failed shutdown rejects publication, even when
some files exist. Do not treat an app file alone as a successful build. See the
[Docker reliability report](build-reliability.md) for the current Wine/Rosetta
fix, tested image and unresolved historical observations.

## A vendor library cannot be found or loaded

Check exact archive spelling/four-part version, namespaces and template/runtime
compatibility. A changed payload hash or dependency selection cannot be accepted
in frozen mode. Update it deliberately through `install` and review the lockfile.
A library can have transitive dependencies that are only diagnosed when CODESYS
compiles or reopens the project.

## An online change rejects the baseline

The saved baseline is tied to the compiler image, template, target and controller
identities. If one changed, perform an explicit `download` to establish a new
baseline. Use `inspect` to distinguish a missing local baseline from a controller
identity mismatch. It can run without source/EDS/library caches. Preserve a
baseline accepted by the controller even if later worker shutdown failed.

## The hardware view is empty or outdated

Confirm the workspace contains the intended `tsplc.config.ts`. Run `typegen` or
`build`, then **Refresh Hardware**. Computed config uses `.tsplc/project.json`;
the extension will not execute arbitrary config just to render the view.

## Monitor connection or values fail

Confirm the actual OPC UA endpoint and that the server publishes the selected
symbols. Engineering gateway ports are not OPC UA endpoints. Compare the server
certificate with the intended device before trusting it, and establish client
certificate trust on the PLC. Check username, environment variable availability
or saved SecretStorage credentials; use **Forget Monitor Password** when needed.

Unavailable symbols, bad sample quality and stale values are distinct from a
connected server. EDS parsing does not prove a physical adapter connection.
See [monitor setup](guides/editor.md) for the exact security defaults and paths.
