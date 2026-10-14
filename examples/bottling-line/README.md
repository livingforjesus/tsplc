# Bottling line example

A small filling line written in PLC TypeScript. It is the reference example for
tsPLC: every language, configuration, hardware and build feature appears here, in
a program small enough to read in one sitting.

## The machine

Bottles arrive on an infeed conveyor. A barcode reader reads each bottle's label;
a bottle without a usable code is pushed off the line by a reject gate. A stop gate
holds four bottles under a four-head filler, the valves open for the recipe's fill
time, and the gate releases the filled bottles. The operator has Start and Stop
buttons, a recipe selector, an emergency-stop chain and a stack light: green while
running, red flashing after an emergency stop.

| Device                                 | Descriptor                                                             | Used for                                        |
| -------------------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------- |
| Cognex DataMan 300 barcode reader      | [`eds/0678077312900100.eds`](eds/0678077312900100.eds)                 | Label results and the result handshake          |
| ConveyLinx-430/510 conveyor controller | [`eds/ConveyLinx_V5_10_CODESYS.eds`](eds/ConveyLinx_V5_10_CODESYS.eds) | Infeed zone status and speed                    |
| B&R X67BCD321.L12 bus controller       | [`eds/EthernetIP_CPU1_IF1__ST1.eds`](eds/EthernetIP_CPU1_IF1__ST1.eds) | Buttons, selector, bottle sensor, valves, gates |
| Local IO (direct addresses)            | none                                                                   | Emergency-stop feedback and stack-light lamps   |

The Cognex and ConveyLinx files are the vendor-supplied descriptors, unchanged.
The B&R file is generated per project by B&R's FieldbusDESIGNER; only its comment
header and file dates were made generic. The process-image addresses target the
virtual controller template. Physical commissioning still needs the real device
tree, network settings and wiring.

## Run it

From the repository root:

```sh
bun install
bun run tsplc typegen --config examples/bottling-line/tsplc.config.ts
bun run tsplc check --config examples/bottling-line/tsplc.config.ts
bun run tsplc build --emit-only --config examples/bottling-line/tsplc.config.ts
bun test examples/bottling-line --timeout 20000
```

Run `typegen` first on a fresh checkout. It writes `generated/hardware.ts` (the typed channel list the config's
`satisfies HardwareIoMapping` checks against) and `generated/plc.ts` (the host
contract). Both are regenerated, not committed: the hardware file records absolute
descriptor paths. Emitted Structured Text is under `.tsplc/artifacts/st/`.

A full vendor build needs Docker and the compiler image:

```sh
bun run tsplc install --config examples/bottling-line/tsplc.config.ts
bun run tsplc configure --config examples/bottling-line/tsplc.config.ts
bun run tsplc build --config examples/bottling-line/tsplc.config.ts
```

`install` fetches the locked Util library, `configure` builds the
`tsplc-build:3.5.22.30` image once, and `build` produces the CODESYS project,
application and CRC under `build/codesys/`. None of these commands transfers anything to a
controller.

## Where each feature lives

### Language

| Feature                                    | Where                                                                                                                                     |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Program entry points                       | [`src/main.ts`](src/main.ts) `main`, [`src/heartbeat.ts`](src/heartbeat.ts) `heartbeat`                                                   |
| Module globals published as global lists   | [`src/Line.ts`](src/Line.ts), [`src/Production.ts`](src/Production.ts), [`src/Diagnostics.ts`](src/Diagnostics.ts)                        |
| Constant global list                       | [`src/Settings.ts`](src/Settings.ts)                                                                                                      |
| Records (interfaces) and nested records    | [`src/types/`](src/types), e.g. [`ST_Reader.ts`](src/types/ST_Reader.ts)                                                                  |
| Enums in comparisons and `switch`          | [`E_LineState`](src/types/E_LineState.ts), [`E_FillerStep`](src/types/E_FillerStep.ts), [`E_Product`](src/types/E_Product.ts)             |
| `FixedArray` with a lower bound of 1       | `Valves: FixedArray<ST_Valve, 4, 1>` in [`ST_Filler.ts`](src/types/ST_Filler.ts)                                                          |
| `FixedArray` byte buffer                   | `ResultData: FixedArray<BYTE, 480>` in [`ST_Reader.ts`](src/types/ST_Reader.ts)                                                           |
| `STRING<N>`                                | `Name: STRING<24>` in [`ST_Recipe.ts`](src/types/ST_Recipe.ts), `Message: STRING<40>` in [`ST_LineStatus.ts`](src/types/ST_LineStatus.ts) |
| Functions, including a record return value | [`selectRecipe`](src/recipes.ts), [`checksum`](src/reader/checksum.ts)                                                                    |
| `switch` with grouped labels and `default` | [`src/recipes.ts`](src/recipes.ts)                                                                                                        |
| `for` loops with `break`                   | [`checksum.ts`](src/reader/checksum.ts) and the valve loop in [`FillerControl.ts`](src/filler/FillerControl.ts)                           |
| Function blocks (`extends FunctionBlock`)  | [`FillerControl`](src/filler/FillerControl.ts), [`ReaderHandshake`](src/reader/ReaderHandshake.ts), [`StackLight`](src/StackLight.ts)     |
| `TON`, `TP` and `R_TRIG`                   | Fill timer in `FillerControl`, reject pulse and Start edge in `main.ts`, result edge in `ReaderHandshake`                                 |
| `Util.BLINK` from a library dependency     | [`StackLight.ts`](src/StackLight.ts)                                                                                                      |
| `InOut<T>` and `ref()` borrows             | `FillerControl` and `ReaderHandshake` inputs, `ref(Line.Filler)` in `main.ts`                                                             |
| `copy()` snapshot of an array              | `LastCode = copy(...)` in [`ReaderHandshake.ts`](src/reader/ReaderHandshake.ts)                                                           |
| `exact`, `wrap`, `saturate`, `wrapAdd`     | `exact<UDINT>` and `saturate<UINT>` in `main.ts`; `wrap<BYTE>` in `checksum.ts`; `wrapAdd` for counters                                   |
| `retain()`                                 | [`src/Production.ts`](src/Production.ts)                                                                                                  |
| Logical IO declarations                    | [`src/io.d.ts`](src/io.d.ts)                                                                                                              |

### Configuration and hardware

All of these are in [`tsplc.config.ts`](tsplc.config.ts):

| Feature                                                 | Setting                                                                         |
| ------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `defineConfig`, two programs                            | `compiler.programs`                                                             |
| Two cyclic tasks with their own state                   | `tasks`: `MainTask` 10 ms and `HeartbeatTask` 100 ms                            |
| CODESYS template, output directory and Docker image     | `build`                                                                         |
| Numeric physical IO                                     | `codesys.profile.numericAddressing: "byte"`                                     |
| Readable IEC names and OPC UA publication               | `codesys.programNames`, `codesys.globalListNames`, `codesys.publishGlobalLists` |
| Archive library dependency, locked in `tsplc.lock.json` | `dependencies.Util`                                                             |
| EDS devices, connections, assemblies and base addresses | `eds`, `devices`                                                                |
| Storage-path binding to a field                         | `"Line.Filler.BottlesInPlace"`, `"Line.Infeed.Speed"`                           |
| Storage path with an array index                        | `"Line.Filler.Valves[1].Open"` … `[4]`                                          |
| Whole EDS byte span into a `FixedArray` field           | `"Line.Reader.Input.ResultData"` ← `inputs.Result_Data`                         |
| Equal-width `UINT` channel into a `WORD` field          | `"Line.Reader.Input.ResultCode"`, `"Line.Infeed.Status"`                        |
| Logical `Input<T>`/`Output<T>` bound to device channels | `StartButton`, `StopButton`, `RecipeSelector` (a whole byte), `RejectGate`      |
| Logical names bound to direct addresses                 | `EStopHealthy: { address: "%IX700.0" }`, `RunLamp`, `FaultLamp`                 |
| Type-checked mappings                                   | `satisfies HardwareIoMapping`, type-only import from `./generated/hardware.ts`  |
| Host contract output                                    | `typegen`                                                                       |
| Editor monitoring endpoint                              | `monitor`                                                                       |

### Tests

[`tests/bottling.test.ts`](tests/bottling.test.ts) checks the real config with
`checkProject`, then asserts on the emitted Structured Text: published and
retained lists, `Util.BLINK`, both tasks, and the physical variable and address
of each IO binding. Behavior tests run the normalized compiler IR in the
repository's test executor ([`tests/support/machine.ts`](../../tests/support/machine.ts)),
which models `TON`, `TP`, `R_TRIG` and `BLINK`. They cover start/stop and
emergency-stop latching, recipe latching, fill timing, the reader handshake and
480-byte capture, reject pulses, counter wrap/saturation and the heartbeat. The
model samples `BLINK` only at its exact phase boundaries; these tests do not
establish native timer accuracy or physical IO behavior.

## Raw Structured Text variant

[`raw-st/`](raw-st) is the same kind of project written directly in Structured
Text. Its [`tsplc.config.ts`](raw-st/tsplc.config.ts) omits `compiler`, points
`build.sourceDir` and `build.entry` at authored ST, schedules the IEC program
`Main`, and binds qualified names such as `"IO.StartButton"` to direct addresses
and to a ConveyLinx channel. Bindings are applied to the declarations in memory;
the `.st` files stay unchanged. The sources show complete and split
declaration/implementation layouts, methods, properties with get/set, actions,
an interface, inheritance, a union, an alias and an enumeration.

```sh
bun run tsplc check --config examples/bottling-line/raw-st/tsplc.config.ts
bun run tsplc build --config examples/bottling-line/raw-st/tsplc.config.ts
```

Raw ST is already Structured Text, so it has no `--emit-only` step; `build` needs
Docker.
