# Mixing-tank port scope

Source: [tkucic/plc_hello_mixing_tank](https://github.com/tkucic/plc_hello_mixing_tank/tree/17e0213b1c7c46fd44ff7d9a52a6bb9e500d65de), commit `17e0213b1c7c46fd44ff7d9a52a6bb9e500d65de`, MIT, copyright Toni Kucic. All 18 repository files remain unchanged in `upstream/`; `upstream.json` records their SHA-256 hashes. Logic, declarations and initializers come from `upstream/plc_hello_mixing_tank.xml`, with its generated source documentation retained for readability.

## Complete authored application

The application contains three POUs, two enum DUTs and two GVLs: seven objects mapped in `port.json`. The three ST bodies contain 216 lines including comments and blank lines, excluding declarations and visualization data.

| Upstream object            | Maintained source                  |
| -------------------------- | ---------------------------------- |
| MODES                      | `src/types.ts`                     |
| AUTO_SEQUENCE              | `src/types.ts`                     |
| GenericBistableDeviceModel | `src/device-model.ts`              |
| simulator                  | `src/simulator.ts`                 |
| main                       | `src/controller.ts`, `src/main.ts` |
| IO                         | `src/IO.ts`                        |
| HMI                        | `src/HMI.ts`                       |

All ten IO fields and fourteen HMI fields retain their names, PLC types and zero defaults. `MODES` preserves MANUAL=0 and AUTO=1; `AUTO_SEQUENCE` preserves DRAINING=0, FILLING=1 and MIXING=2. Initial mode and previous mode are MANUAL, automatic state is DRAINING, tank level is REAL 25, and rotation values are REAL zero.

## Preserved control and simulation

- Mode selection consumes the request for leaving the current mode. Both mode entries reset the automatic sequence to DRAINING. Manual control latches through device feedback, with stop/close taking precedence; the original manual mode has no overfill protection.
- Automatic draining waits for the low-level switch and the drain valve's closed feedback before entering filling. Both fill valves close at the high-level switch; mixing starts only after both report closed. The motor starts, then mixing timing uses running feedback for ten seconds. A timer completion stops the motor and changes to draining. The mixing timer is called only in the MIXING branch, as upstream.
- The cycle counter increments after every completed drain, including the initial drain on entering automatic operation. Its UINT addition wraps explicitly. It is not redefined as counting only fully filled/mixed batches.
- HMI open/run requests clear after matching feedback; close/stop requests clear after the device is no longer active. Controller execution precedes simulation, so newly simulated feedback reaches control logic on the next scan.
- All four GenericBistableDeviceModel instances retain their USINT state=0 and previous-state=3 initialization. Their outputs initially default to FALSE/FALSE; after execution they reflect active/inactive state. Activation/deactivation failures inhibit the corresponding TON input. State entry resets the transition timer.
- Mixer activation takes two seconds and deactivation zero seconds. Each valve uses one second for activation and deactivation. Public model inputs `cfgActTime`/`cfgDeactTime` have one-second upstream defaults, and failure inputs default FALSE; the static application's complete updates explicitly supply the original configured values and FALSE failure inputs.
- Tank arithmetic retains the order `level + medium1 contribution + medium2 contribution - drain contribution`, with LREAL intermediates and one final REAL assignment. Untyped decimal coefficients are LREAL 0.1, 0.1 and 0.2; level clamps to 0..100, full feedback is `>=85`, and empty feedback is `<=5`. Simulator motor rotation increments by REAL 1 and HMI rotation by REAL 2 while feedback is true; both reset at `>=360`.

## Representation changes

PLC-TS uses a single entry wrapper for the two original task program calls. Related persistent controller and simulator scalars are grouped into records. All original state and public fields are retained; no authored model/control behavior or private state was omitted. Those groupings change engineering object paths, and the original visualization has not been rebound to them.

Function blocks require complete updates. Each model call explicitly supplies all six inputs. Unlike the upstream one-second VAR_INPUT preset initializers, newly allocated generated model input storage is zero before its first invocation. Complete updates immediately supply motor 2s/0s or valve 1s/1s at every authored call; the application never observes pre-invocation input storage. Pre-invocation configurable input defaults are therefore a representation difference, while the public FALSE/FALSE output defaults match. The authored `TransitionDelay(IN:=FALSE)` reset supplies the current phase's PT in PLC-TS: IN=FALSE clears TON Q/ET independently of PT, and the next call in that same scan supplies the complete current phase inputs. Keeping a separate previous-preset field would not change observable outputs or later timer state, so the port does not add it.

[CODESYS untyped floating literals use LREAL](https://content.helpme-codesys.com/en/CODESYS%20Development%20System/_cds_operands_constant_typedliterals.html), so the original tank expression promotes its decimal arithmetic before assignment to REAL. The port widens the stored level losslessly with `exact<LREAL>`, uses a transient local LREAL for the three ordered operations, then performs one `saturate<REAL>` conversion at the original store. There is no persistent wide state and no intermediate REAL store.

Dynamic multiplication by a Boolean-converted value is outside the current language proof. Each coefficient times BOOL_TO_REAL is represented by a branch choosing the original LREAL decimal coefficient or positive zero. False paths still perform `+0.0`/`-0.0`; they are not skipped. This preserves LREAL rounding and signed-zero behavior in source order, followed by the original REAL rounding. The integer-coefficient motor rotations use exact 1/2/0 contributions, so their single REAL assignments remain equivalent.

Float saturation clips finite LREAL values before rounding, but clipping cannot occur here: REAL endpoints are unchanged by these tiny offsets at LREAL precision, and the ordered additions/subtraction are monotone. Thus every finite REAL starting level remains within the REAL endpoints before conversion; the authored 0..100 level clamp still executes afterward. This rationale applies to the selected finite 32-bit REAL / 64-bit LREAL CODESYS target, not an unspecified external nonfinite input policy.

The original CODESYS project, exported visualization/device data, documentation and images remain upstream assets. The generated application uses a shared virtual engineering template and a replacement 20 ms priority-1 task. Source emission does not recreate the upstream device/UI setup or assert hardware behavior.

## Verification

`tests/mixing.test.ts` analyzes the real PLC-TS source and executes normalized PLC IR through the test-only executor. PLC TypeScript is not imported or run as JavaScript. Tests verify all 18 upstream hashes, all seven source-object mappings, initial values, enum members, globals and native TON emission; a full automatic drain–fill–mix–drain cycle; manual command/feedback reset and stop priority; model activation/deactivation delays and failures; all eight valve contribution combinations with original promoted-expression rounding, cancellation and signed-zero cases, clamps and rotations; mode entry and UINT cycle wrap; and an interrupted mixing timer's held outputs and authored resumption.

Source and config TypeScript checks, PLC semantic admission, complete ST emission and behavior tests are separate gates from CODESYS compilation through `@vplc/build`. The current build runs in Docker; see [README.md](README.md) for commands. Generated ST and copied build artifacts are under `.vplc/artifacts/`, with vendor outputs in `build/`. No deployment, physical runtime execution or commissioning is part of this port.
