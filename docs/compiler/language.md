# tsPLC source language

For an introduction with complete examples, read the
[PLC TypeScript handbook](../language/README.md). This page describes the detailed
semantic rules and restrictions.

PLC source is ordinary TypeScript checked by the pinned TypeScript compiler and a separate PLC semantic checker. Host configuration executes on the build machine; PLC source never executes as JavaScript during compilation.

## Storage and scan entry

Top-level `let` creates persistent module state. Top-level scalar `const` creates a compile-time constant. Invocation locals initialize when their declaration executes. Every local needs an initializer. Numeric mutable storage needs an explicit PLC type.

```ts
let running: BOOL = false;
export function main(): void {
  if (Start && !Stop) running = true;
  Motor = running;
}
```

Program entries are selected explicitly in configuration. They take no parameters and return void. Functions may appear before constants they read; all module initializers resolve before function bodies. Initializer dependencies themselves must be available in declaration order.

Logical I/O uses an authored declaration file:

```ts
declare const Start: Input<BOOL>;
declare const Stop: Input<BOOL>;
declare let Motor: Output<BOOL>;
```

Inputs are readonly. The CODESYS backend snapshots inputs at program entry and commits the output image after the entry function returns, including early returns.

## Numeric domains

`SINT/INT/DINT/LINT` and `USINT/UINT/UDINT/ULINT` are signed and unsigned integers at 8/16/32/64 bits. The 64-bit source types use bigint literals. `BYTE/WORD/DWORD/LWORD` are bit strings, with explicit width semantics rather than JavaScript's 32-bit bitwise coercion. `REAL` and `LREAL` are 32- and 64-bit floating types.

The PLC checker resolves canonical SDK symbols and source annotations. TypeScript's numeric compatibility does not erase these PLC domains.

Ordinary integer arithmetic must prove its result fits. Contextual widening supports, for example, adding two UINT values in a UDINT result. Division uses `div<T>(a, b)` and truncates toward zero; remainder has the dividend's sign. The divisor must be proved nonzero, and signed minimum divided by minus one is rejected.

Explicit operations state a different policy:

```ts
import { wrapAdd, saturatingMultiply, exact, saturate, div } from "@tsplc/compiler/types";
let count: UINT = 65535;
export function main(): void {
  count = wrapAdd<UINT>(count, 1);
}
```

`wrap`, `saturate`, and `exact` convert between explicit numeric types. `exact` requires a lossless proof. For float-to-float conversion, `saturate<REAL>(value)` clips a finite LREAL value to the finite REAL endpoints before rounding to REAL; signed zero is preserved. Same-width and widening float saturation preserve the source value. Float wrapping and float/integer saturation remain unsupported. Dynamic narrowing emits guarded typed conversion; it does not relax the finite-state rule or authorize unproved floating arithmetic. Wrapping and saturation arithmetic have corresponding add/subtract/multiply functions. Constants retain exact integer values; conversion to a JavaScript number is never used for integer arithmetic.

REAL constants and folded operations round at each typed result. Nonfinite constants fail compilation. Current dynamic floating arithmetic accepts only operations whose finiteness is proved, including negation, identity arithmetic, and addition/subtraction with a typed constant when both rounded finite endpoints remain finite. The proof preserves operand order and signed-zero arithmetic; overflow ties are rejected. General floating algorithms and floating logical inputs require a defined runtime nonfinite policy before they can be admitted. Integer and BOOL inputs remain supported; finite floating state can feed floating outputs.

## Helpers and bounded control

Helpers need named, typed parameters and an explicit result type unless void. Parameters are readonly. Calls resolve to TypeScript implementation source; JavaScript dependencies and declaration-only value imports are rejected. Recursion, calls to program entries, closures, async execution and host APIs are rejected.

Evaluation order is preserved. Mutable reads and helper results are captured before later operands can change state. Logical operators and conditional expressions evaluate only the selected branch.

`if`, `switch`, early return, and static bounded `for` loops are supported. A loop counter may use an explicit PLC integer type or infer DINT from `let i = 0`. Bounds must be static; normal `i++`, `i--`, and positive constant `i += step` or `i -= step` header updates are supported. The compiler applies the header update, including when `continue` skips the remaining body. The maximum accepted bound is one million iterations. The body and called helpers cannot change an active counter.

A counter declared in the header remains scoped to the loop. A predeclared local, module variable or private block field can also be used, as in `for (index = 0; index < 4; index++)`. Its value remains observable after completion, `break`, `continue` and early return; the compiler rejects a final increment that would overflow its PLC integer type. Switch cases terminate with break or return; grouped empty labels are supported, including default labels. Conditional switch breaks inside a case are diagnosed rather than changing the enclosing loop's behavior.

TypeScript diagnostic suppression comments are prohibited in PLC source. Diagnostics distinguish TypeScript, PLC semantics, configuration, normalized IR, and backend failures.

## Fixed layouts and explicit copies

Interfaces and property-only type literals describe closed records. Fields require concrete PLC types; optional fields, methods, dynamic index signatures and recursive by-value layouts are rejected. Property-only interface inheritance flattens a fixed record layout. Interface declaration merging is unsupported.

`FixedArray<T, N, Lower = 0>` gives a fixed element type, positive length and optional lower bound. Array literals must provide every element. Indexes must be proved inside the declared bounds, including bounded loop counters. `.length` has a known DINT value while still evaluating receiver calls and index expressions.

`STRING<N>` bounds UTF8 bytes; `WSTRING<N>` bounds UTF16 code units. Embedded NUL and over-capacity constants are rejected. The current CODESYS profile accepts ASCII STRING literals and BMP WSTRING literals; non-ASCII STRING needs a verified project-wide UTF8 setting, and CODESYS UCS-2 rejects surrogate code units. Strings have value semantics; their comparisons require compatible bounded types.

Numeric enums preserve their identity, use distinct compile-time DINT member values, and permit equality, inequality and switch. Use named enum members rather than raw integers. Arithmetic and cross-enum conversions are rejected.

A const record or array fixes the binding while its non-readonly fields/elements remain mutable. Ambient inputs and helper value parameters are deeply readonly. Plain aggregate aliases are rejected; `copy(value)` requests a snapshot into separately allocated static storage. Complete literals and `defaultValue<T>()` initialize fresh storage.

```ts
interface State {
  Active: BOOL;
  Bytes: FixedArray<BYTE, 2>;
}
const state = defaultValue<State>();
let snapshot: State = defaultValue<State>();
export function main(): void {
  state.Active = true;
  snapshot = copy(state);
}
```

Generic functions, aliases and record interfaces specialize using explicit concrete type arguments (or concrete declared defaults). Specializations have separate parameters and locals. Unresolved widths, recursion, more than 256 concrete helpers, layouts deeper than 64 levels and layouts over one million scalar elements produce diagnostics. Generic helper bodies receive PLC semantic checking when instantiated; TypeScript checks all source templates.

`@tsplc/compiler/math` contains ordinary PLC TypeScript implementations of `min<T>`, `max<T>` and `clamp<T>`. User source libraries use the same module resolution and specialization path, with no JavaScript execution during compilation.

## Time and calendar values

`TIME` is an unsigned 32-bit millisecond duration. `ms(n)`, `seconds(n)` and `minutes(n)` construct compile-time values, preserving decimal spelling rather than multiplying rounded JavaScript numbers. Values must be nonnegative, exactly representable in milliseconds, and at most 4,294,967,295 milliseconds. Numeric literals and folded integer constants are accepted. Dynamic duration construction and implicit numeric arithmetic are rejected. Typed storage, helper arguments/results and same-domain comparisons are supported. `timeToMilliseconds(value: TIME): UDINT` returns the exact unsigned millisecond value, including the full 0 through 4,294,967,295 range; the CODESYS backend emits `TIME_TO_UDINT`.

`date("YYYY-MM-DD")` creates DATE values from 1970-01-01 through 2106-02-07. `timeOfDay("HH:mm:ss[.SSS]")` creates TIME_OF_DAY within a day. `dateAndTime("YYYY-MM-DDTHH:mm:ss")` creates DATE_AND_TIME through 2106-02-07T06:28:15, with whole-second precision. Calendar validation uses civil dates and does not depend on the host timezone. These domains remain distinct from strings, durations and each other.

## Static function blocks and borrows

Allocate native `TON`, `TOF`, `TP`, `R_TRIG` and `F_TRIG` blocks in module-level const bindings or private initialized fields of another block. Every `update({ ... })` binds every input: timers require IN and PT, triggers require CLK. Read outputs through readonly `.out.Q` and timer `.out.ET`. Updates retain instance state between invocations; their inputs are supplied anew at each update.

`BLINK` is a native CODESYS `Util.BLINK` instance with `ENABLE: BOOL`, `TIMELOW: TIME` and `TIMEHIGH: TIME` inputs and readonly `OUT: BOOL` output, initially false. Supply all three inputs at every update. The engineering template must contain the CODESYS Util library under its `Util` namespace. [The native contract](https://content.helpme-codesys.com/de/libs/Util/Current/Signals/BLINK.html) specifies that disabling blinking holds OUT. tsPLC delegates timing to the native block; partial-phase restart and zero-time behavior are not specified here. The test executor models continuous unchanged positive-duration phases only when each phase boundary is sampled, plus held output on disable. It rejects skipped boundaries, duration changes, restart and zero-time execution instead of inventing vendor behavior.

User blocks extend the canonical `FunctionBlock<Inputs, Outputs>` marker and implement one protected `execute(input: Inputs): Outputs` method. Omit Outputs and return void for a block with no outputs. Empty input schemas can use `{}`. Private initialized instance fields provide persistent state. Invocation locals and compiler temporaries use VAR_TEMP in generated ST. Classes cannot have constructors, static fields, inheritance beyond the marker, generic parameters, decorators, additional methods or dynamic allocation. Private state access uses `this.field` only.

```ts
interface State {
  Running: BOOL;
}
interface Inputs {
  Enabled: BOOL;
  State: InOut<State>;
}
interface Outputs {
  Ready: BOOL;
}
class Controller extends FunctionBlock<Inputs, Outputs> {
  private timer = new TON();
  protected execute(input: Inputs): Outputs {
    this.timer.update({ IN: input.Enabled, PT: seconds(1) });
    input.State.Running = this.timer.out.Q;
    return { Ready: input.State.Running };
  }
}
const controller = new Controller();
let state: State = defaultValue<State>();
export function main(): void {
  controller.update({ Enabled: true, State: ref(state) });
}
```

Value inputs are deeply readonly snapshots. `InOut<T>` is allowed directly on a block input field; update it with `ref(place)` to borrow writable storage of exactly the same PLC type. Mutable field and proved array-element references are supported. References cannot be stored, returned, put into nested value layouts or passed to ordinary helpers. A call cannot bind overlapping mutable places. Distinct fields and proved distinct array indexes are accepted; uncertain overlap is rejected. Whole const record/array bindings cannot be borrowed for replacement, while their writable subfields/elements can be borrowed.

Input evaluation follows source property order. Reference indexes are captured once; by-value inputs are captured before subsequent input expressions can change them. Block instances cannot be copied, rebound or returned. `copy(instance.out)` captures the complete output record into independent value storage. A typed block returns every output field on every returning path; outputs are always readonly to source code, including inside execute. Block update recursion and recursive static instance layouts are rejected.

`retain(initializer)` marks mutable persistent storage or a static instance for CODESYS retention. Private retained state conservatively promotes retention to the enclosing static instance, including its children. A retained block containing direct or nested InOut references is rejected because pointer rebinding across restart has not been verified. Retention declarations have been vendor-compiled; warm restart, cold reset, power-loss retention and commissioning behavior still depend on the selected CODESYS device and have not been exercised by compiler tests.
