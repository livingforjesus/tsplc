# PLC TypeScript handbook

[Documentation home](../README.md) · [Detailed semantics](../compiler/language.md)

tsPLC uses TypeScript syntax with PLC storage, numeric widths and scan semantics.
It typechecks source, lowers supported constructs to Structured Text and lets the
CODESYS compiler build the application. PLC source does not execute in Bun or
Node.js.

Enable `@tsplc/compiler/globals` in `tsconfig.json`, as shown in the
[quickstart](../getting-started.md). This supplies `BOOL`, `UINT`, timers and other
SDK names. The separate `tsplc.config.ts` is trusted host TypeScript and can load
configuration; the restrictions below apply to PLC source.

## Programs and state

A configured program entry is an exported function with no parameters and a void
result:

```ts
let running: BOOL = false;

export function main(): void {
  running = !running;
}
```

Top-level mutable variables persist between scans. Initialized locals inside the
function are created for each invocation. Persistence between scans does not
automatically mean retention across a controller restart.

Every local needs an initializer. Use explicit IEC types for mutable numeric
storage; `let count: UINT = 0` preserves an unsigned 16-bit domain. A scalar `const`
can be a compile-time constant. A const record fixes its binding while allowing
its writable fields to change.

## Scalar types

| Type                                   | Meaning                            | Source value                                      |
| -------------------------------------- | ---------------------------------- | ------------------------------------------------- |
| `BOOL`                                 | Boolean                            | `true`, `false`                                   |
| `SINT`, `INT`, `DINT`, `LINT`          | Signed 8, 16, 32, 64-bit integer   | `number`; `bigint` for `LINT`                     |
| `USINT`, `UINT`, `UDINT`, `ULINT`      | Unsigned 8, 16, 32, 64-bit integer | `number`; `bigint` for `ULINT`                    |
| `BYTE`, `WORD`, `DWORD`, `LWORD`       | 8, 16, 32, 64-bit bit string       | `number`; `bigint` for `LWORD`                    |
| `REAL`, `LREAL`                        | 32, 64-bit floating point          | Finite `number`                                   |
| `TIME`                                 | Unsigned millisecond duration      | `ms(20)`, `seconds(1)`                            |
| `DATE`, `TIME_OF_DAY`, `DATE_AND_TIME` | Distinct calendar domains          | `date(...)`, `timeOfDay(...)`, `dateAndTime(...)` |
| `STRING<N>`, `WSTRING<N>`              | Fixed-capacity string              | String literal within its capacity                |

The ordinary TypeScript checker represents several IEC types as `number`; tsPLC's
PLC checker keeps their domains distinct. Integer constants must fit their width.
Use bigint literals such as `0n` for 64-bit integer storage.

### Arithmetic and overflow

An ordinary operation must have a provably valid result. For deliberately wrapping
or saturating arithmetic, import the corresponding SDK intrinsic:

```ts
import { wrapAdd } from "@tsplc/compiler/types";

let scans: UINT = 0;

export function main(): void {
  scans = wrapAdd<UINT>(scans, 1);
}
```

`wrap<UINT>(value)` deliberately converts with wrapping; `saturate<UINT>(value)`
clips to the target range; `exact<UINT>(value)` requires a lossless conversion.
`div<T>(left, right)` performs integer division toward zero with a proved nonzero
divisor. `@tsplc/compiler/math` provides PLC source implementations of `min`, `max`
and `clamp` with explicit numeric type arguments.

Floating-point arithmetic has stricter finite-result checks than ordinary
JavaScript. General dynamic floating algorithms and floating logical inputs are
currently restricted. See [numeric domains](../compiler/language.md#numeric-domains)
for the exact policies before porting numerical code.

## IO

Declare the logical IO used by your PLC program in a `.d.ts` file:

```ts
declare const Sensor: Input<BOOL>;
declare let Motor: Output<BOOL>;
```

Bind these names in `tsplc.config.ts`. Hardware type generation checks the device
and channel names in those config bindings; it does not create these logical IO
declarations. Inputs are readonly. The CODESYS backend
snapshots logical inputs when a program starts and commits logical outputs when
it returns, including early returns. Hardware descriptors and mappings are
explained in [Hardware and IO](../guides/hardware-and-io.md).

## Functions and modules

Helpers use named typed parameters and an explicit return type, including `void`
for procedures:

```ts
function canRun(start: BOOL, stop: BOOL): BOOL {
  return start && !stop;
}

let running: BOOL = false;

export function main(): void {
  running = canRun(true, false);
}
```

Split a larger application into TypeScript modules using imports and exports.
Value imports must resolve to supported TypeScript implementation source; a
JavaScript npm dependency or a declaration-only value import is not PLC code.
Generic helpers need concrete type arguments or concrete declared defaults.
Parameters passed by value are deeply readonly. For mutation of a record owned
by a caller, use a function block with an explicit `InOut` input.

## Conditions and loops

Use ordinary `if`, `switch`, `return`, `break` and `continue`. Switch cases must
terminate; grouped empty labels are supported. Loops have statically known bounds:

```ts
let lastIndex: UINT = 0;

export function main(): void {
  for (let index: UINT = 0; index < 4; index++) {
    lastIndex = index;
  }
}
```

Normal `++`, `--`, `+= step` and `-= step` header updates are compiled, including
on `continue`. You do not add a body increment or a correction after the loop.
A predeclared counter or private block field can appear directly in the header;
its value after completion, break or return follows the source loop semantics.
The compiler rejects a terminal update that would overflow its PLC type.

Bounds and step must be static. The loop body and its helpers cannot change an
active counter. `while`, dynamic bounds and recursion are outside the supported
subset. See the [bounded-control reference](../compiler/language.md#helpers-and-bounded-control).

## Records, arrays and enums

Interfaces define closed PLC records. Use `defaultValue<T>()` for complete fresh
initialization:

```ts
interface MachineState {
  Enabled: BOOL;
  Samples: FixedArray<UINT, 4>;
}

const state = defaultValue<MachineState>();

export function main(): void {
  state.Enabled = true;
  for (let index: UINT = 0; index < 4; index++) {
    state.Samples[index] = index;
  }
}
```

`FixedArray<T, N, Lower>` has a fixed length and optional lower bound. For example,
`FixedArray<BOOL, 4, 1>` has indexes 1 through 4. An index must be proved in bounds;
there is no dynamic resizing. Array literals must supply every element.

Records and arrays use explicit value semantics. `copy(state)` creates a snapshot;
a plain assignment that would make an implicit mutable alias is rejected.
Optional properties, dynamic index signatures and recursive by-value layouts are
not supported.

Numeric enums have distinct DINT member values and preserve enum identity. Use
named members in equality and switches; enum arithmetic and conversion to an
unrelated enum are rejected.

## Timers and triggers

Allocate a native block once at module scope, then update all its inputs each scan:

```ts
const delay = new TON();
let ready: BOOL = false;

export function main(): void {
  delay.update({ IN: true, PT: seconds(1) });
  ready = delay.out.Q;
}
```

`TON`, `TOF` and `TP` expose readonly `out.Q` and `out.ET`. `R_TRIG` and `F_TRIG`
take `{ CLK }` and expose `out.Q`. The native instances keep state between calls.
`BLINK` uses the CODESYS Util library and exposes `out.OUT`; its template/library
requirements and tested timing model are in the [block reference](../compiler/language.md#static-function-blocks-and-borrows).

Task periods use `ms` from `@tsplc/config`; PLC timers use the SDK's ambient `ms` or
the import from `@tsplc/compiler/types`. These are different types with different
jobs, even though their names are similar.

## User function blocks

A block has a fixed input/output schema and private initialized state:

```ts
interface DelayInputs {
  Enabled: BOOL;
}
interface DelayOutputs {
  Ready: BOOL;
}

class DelayedStart extends FunctionBlock<DelayInputs, DelayOutputs> {
  private timer = new TON();

  protected execute(input: DelayInputs): DelayOutputs {
    this.timer.update({ IN: input.Enabled, PT: seconds(1) });
    return { Ready: this.timer.out.Q };
  }
}

const controller = new DelayedStart();
let ready: BOOL = false;

export function main(): void {
  controller.update({ Enabled: true });
  ready = controller.out.Ready;
}
```

Allocate instances at module scope or in initialized private block fields.
Invocation locals become temporary ST storage. A block implements one protected
`execute`; constructors, additional methods, dynamic allocation and inheritance
beyond the SDK marker are not supported. All output fields must be returned, and
`out` is readonly to the caller.

For a caller-owned record, declare an input field as `InOut<State>` and pass
`ref(state)` to `update`:

```ts
interface State {
  Enabled: BOOL;
}
interface WriterInputs {
  State: InOut<State>;
  Enabled: BOOL;
}

class StateWriter extends FunctionBlock<WriterInputs> {
  protected execute(input: WriterInputs): void {
    input.State.Enabled = input.Enabled;
  }
}

let state: State = defaultValue<State>();
const writer = new StateWriter();

export function main(): void {
  writer.update({ State: ref(state), Enabled: true });
}
```

This is an explicit writable borrow: references cannot escape the call, and
overlapping mutable inputs are rejected. The
[full borrowing rules](../compiler/language.md#static-function-blocks-and-borrows)
cover field and array-element references.

## Retained state

`retain(initializer)` requests CODESYS retention for mutable state or a static
block. Ordinary module state only persists between scans. Retained private block
state promotes retention to its owning instance. Retained blocks cannot contain
`InOut` references.

```ts
let latched: BOOL = retain(false);

export function main(): void {
  latched = true;
}
```

Retention behavior across warm reset, cold reset, power loss and a download belongs
to the selected CODESYS target. The compiler emits retention declarations; it
does not define a portable persistence policy. Raw ST can use the target's native
`RETAIN`/`PERSISTENT` declarations through the [raw-ST build](../guides/building.md#build-raw-structured-text).

## Unsupported JavaScript features

PLC source cannot use async/await, promises, closures, recursion, host filesystem
or network APIs, dynamic object/array layouts, or arbitrary JavaScript libraries.
Type assertions and diagnostic suppression do not authorize an unsupported PLC
operation. Keep host configuration and test orchestration outside PLC source.

When a construct is rejected, read the diagnostic origin and source span. Use the
[semantic reference](../compiler/language.md) for details, or the
[bottling-line example](../../examples/bottling-line/README.md) for a complete application.
