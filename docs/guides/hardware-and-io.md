# Hardware descriptions and IO

[Documentation home](../README.md) · [Configuration reference](../reference/configuration.md)

Hardware integration connects three things: the EDS payload description, the
template's configured device/process image, and the logical names used by PLC
source. Keep those three identities aligned.

## Organize a project

```text
vplc.config.ts
tsconfig.json
src/
  io.d.ts
  main.ts
eds/
  reader.eds
generated/
  hardware.ts
  plc.ts
templates/
  controller.project
```

`eds` selects one directory or an array of directories. A `devices` entry selects
a descriptor, optional connection, input/output assembly instances and the base
addresses assigned in the template. Device file paths are relative to the config;
the `eds` setting does not change that path base.

## Select assemblies

The maintained hardware test uses the supplied Cognex descriptor as follows:

```ts
eds: "eds",
devices: {
  scanner: {
    file: "eds/0678077312900100.eds",
    connection: "Connection1",
    inputs: { assembly: 11, address: "%IB0" },
    outputs: { assembly: 21, address: "%QB0" },
  },
},
codesys: {
  profile: { directAddressing: "byte", numericAddressing: "byte" },
},
```

For the PLC scanner, data produced by the adapter is PLC input (T→O), and data
consumed by the adapter is PLC output (O→T). An assembly instance number alone
does not establish direction. The selected EDS connection and format references
must agree with these choices. `size` can select a supported payload size when
the EDS describes a variable-capacity assembly.

An EDS byte/bit offset is relative to its assembly. `%IB0`/`%QB0` above are base
process-image addresses, not inferred device addresses. vPLC resolves channels
from their widths and offsets, and diagnoses unsupported or ambiguous layouts
instead of guessing. Device creation, network addresses, RPI and driver settings
remain template/runtime configuration.

## Generate mapping types

```sh
bun run vplc typegen
```

This produces `generated/hardware.ts` with `HardwareIoBinding`,
`HardwareIoMapping` and hardware metadata. Use a type-only import in the config:

```ts
import type { HardwareIoMapping } from "./generated/hardware.ts";
```

Then select generated channels:

```ts
io: {
  ScannerReady: { device: "scanner", channel: "inputs.Trigger_Ready" },
  ScannerTrigger: { device: "scanner", channel: "outputs.Trigger" },
} satisfies HardwareIoMapping,
```

Channel names depend on the selected EDS. Use autocomplete or the generated
binding union rather than copying a name from another device. Raw assemblies
also expose byte and bit channels where the layout supports them.

For a new project, generate hardware types before adding logical IO declarations:
begin with `io: {}` and no generated-type import, run typegen, then add the
declarations below, the mappings and the type-only import. Existing PLC source
needs mappings for every declared logical input/output; keep those valid plain
mappings and omit only the generated-type import until the first typegen run.
The unified TS command writes hardware types first, emits ST and then generates
the PLC contract. That ordering supports later runs with the import present.

## Declare logical PLC IO

Hardware typegen checks mapping selections; it does not automatically declare
your PLC's logical variable names. Create `src/io.d.ts`:

```ts
declare const ScannerReady: Input<BOOL>;
declare let ScannerTrigger: Output<BOOL>;
```

PLC source can now use those names:

```ts
export function main(): void {
  ScannerTrigger = ScannerReady;
}
```

The compiler checks the declared direction/type against the resolved channel.
BOOL mappings use explicit bit addresses. Numeric mappings require
`codesys.profile.numericAddressing`: `"byte"` uses byte-based numeric address
indexes; `"element"` uses element-based indexes. Alignment, width and overlapping
bindings are checked under the selected profile.

For a direct logical mapping, use `{ address: "%IX0.0" }` instead of
`{ device, channel }`. Raw-ST mappings use qualified names such as
`"LineIO.Start"` and can include `type: "BOOL"` to check the authored declaration.
Raw mappings are applied in memory; source files remain unchanged.

## PLC contracts and editor metadata

`generated/plc.ts` contains TypeScript types and runtime field metadata derived
from ST declarations. It is intended for host-side clients that read/write PLC
values; it is different from the IEC-typed PLC source declarations above.
`typegen.types`, `typegen.globals`, `typegen.out` and `typegen.hardwareOut`
control the input directories and output paths. See the
[typegen guide](typegen.md) for host contract types, field metadata and standalone
generation from ST.

```sh
bun run vplc typegen --check
```

Check mode compares existing generated files without writing. Missing or stale
contracts fail. TypeScript projects need their emitted ST to exist first.

`.vplc/project.json` records resolved hardware/configuration and actual logical
IO symbol paths for the editor. The [hardware view](editor.md) uses that snapshot
for computed configs. Keep secrets in environment variables or SecretStorage;
snapshots contain configuration and password variable names, not passwords.

See the complete [Cognex, ConveyLinx and B&R test config](../../examples/frame-assembly/hardware-testing/vplc.config.ts)
and [measured EDS layouts](../research/actual-eds-files.md). Those fixtures validate
parsing, type generation and virtual-image builds. Physical EtherNet/IP
commissioning is a separate target/network check.
