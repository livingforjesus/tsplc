# Check and test PLC code

[Documentation home](../README.md) · [Validation record](../validation.md)

Use the verification level that answers your question. Passing a source check,
emitting ST, compiling with CODESYS and exercising a running PLC are different
results.

| Check                     | What it establishes                                                |
| ------------------------- | ------------------------------------------------------------------ |
| `tsplc check`             | Config, TypeScript/PLC semantics and supported source structure    |
| `tsplc build --emit-only` | Generated ST and ownership/publication behavior                    |
| `tsplc build`             | The vendor compiler accepts the application and produces artifacts |
| Logic tests               | The selected test executor/model behaves as asserted               |
| Runtime integration       | The compiled application behaves on the tested runtime/connection  |
| Physical commissioning    | The actual fieldbus/device/installation behaves as intended        |

## Workspace checks

From the tsPLC checkout:

```sh
bun run check
```

This runs TypeScript, ESLint, Prettier and the Bun regression suite. The test
script has a bounded 20-second per-test budget. Formatting uses Prettier through
`bun run format`; linting uses ESLint through `bun run lint`.

For a specific example:

```sh
bun run tsplc check --config examples/bottling-line/tsplc.config.ts
bun test examples/bottling-line/tests --timeout 20000
```

The [bottling-line tests](../../examples/bottling-line/tests/bottling.test.ts)
check the real config with `checkProject` and assert on the emitted ST, then
execute normalized compiler IR with the timer/edge models in
[`tests/support/machine.ts`](../../tests/support/machine.ts). These tests do not
run PLC source as JavaScript and do not prove native timer or physical IO
behavior. The test helpers are maintained test infrastructure, not a public
deployable JavaScript PLC runtime.

## Vendor compilation

```sh
bun run tsplc build --config examples/bottling-line/tsplc.config.ts
```

Inspect the `vendor-compiled` receipt and project/app/CRC files. Run heavy vendor
builds sequentially when validating one local Docker toolchain. A build does not
download to a PLC, so compilation can be checked separately from deployment.

## Compiled-runtime simulation

A compiled-runtime suite belongs to the consuming project. It loads the
application onto a virtual PLC, connects over authenticated, encrypted OPC UA,
writes modeled input feedback to published symbols and checks the controller's
real outputs. Such a suite needs an explicit virtual endpoint and its established
certificate directory; it is not part of the tsPLC repository's unit-test command.

Do not point simulation feedback writers at a physical controller merely to reuse
a test. See [deployment](deployment.md) for loading the virtual application.

Retained state, startup behavior, online changes, boot identity and connection
loss need runtime-specific checks. No passing unit model establishes those
properties for an untested controller or arbitrary data-layout change.
