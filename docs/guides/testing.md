# Check and test PLC code

[Documentation home](../README.md) · [Validation record](../validation.md)

Use the verification level that answers your question. Passing a source check,
emitting ST, compiling with CODESYS and exercising a running PLC are different
results.

| Check                    | What it establishes                                                |
| ------------------------ | ------------------------------------------------------------------ |
| `vplc check`             | Config, TypeScript/PLC semantics and supported source structure    |
| `vplc build --emit-only` | Generated ST and ownership/publication behavior                    |
| `vplc build`             | The vendor compiler accepts the application and produces artifacts |
| Logic tests              | The selected test executor/model behaves as asserted               |
| Runtime integration      | The compiled application behaves on the tested runtime/connection  |
| Physical commissioning   | The actual fieldbus/device/installation behaves as intended        |

## Workspace checks

From the vPLC checkout:

```sh
bun run check
```

This runs TypeScript, ESLint, Prettier and the Bun regression suite. The test
script has a bounded 20-second per-test budget. Formatting uses Prettier through
`bun run format`; linting uses ESLint through `bun run lint`.

For a specific example:

```sh
bun run vplc check --config examples/mixing-tank/vplc.config.ts
bun test examples/mixing-tank/tests --timeout 20000
```

The maintained examples test normalized compiler IR against device/timer models.
These tests do not run PLC source as JavaScript and do not prove native timer or
physical IO behavior. The test helpers are maintained test infrastructure, not a
public deployable JavaScript PLC runtime.

## Vendor compilation

```sh
bun run vplc build --config examples/mixing-tank/vplc.config.ts
```

Inspect the `vendor-compiled` receipt and project/app/CRC files. Run heavy vendor
builds sequentially when validating one local Docker toolchain. A build does not
download to a PLC, so compilation can be checked separately from deployment.

## Compiled-runtime simulation

The migrated Frame application has a separate integration suite in its consuming
repository. It connects to the compiled virtual PLC over authenticated, encrypted
OPC UA, applies modeled input feedback and checks real controller outputs.
That suite requires an explicit virtual endpoint and its established certificate
directory. It is not included in the vPLC repository's ordinary unit-test command.

Use the consuming project's documented task and endpoint settings. Do not point
simulation feedback writers at a physical controller merely to reuse a test.
See [deployment](deployment.md) for loading the virtual application and
[reliability evidence](../build-reliability.md) for the actual Frame results.

Retained state, startup behavior, online changes, boot identity and connection
loss need runtime-specific checks. No passing unit model establishes those
properties for an untested controller or arbitrary data-layout change.
