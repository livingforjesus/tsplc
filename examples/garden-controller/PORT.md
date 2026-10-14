# Garden-controller port scope

Source: [tkucic/plc_garden_controller](https://github.com/tkucic/plc_garden_controller/tree/ef3e937c8ead73a7078925b0da32fca59c85379b), commit `ef3e937c8ead73a7078925b0da32fca59c85379b`, MIT, copyright Toni Kucic. All 27 repository files remain unchanged in `upstream/`; `upstream.json` lists their SHA-256 hashes. The authoritative declarations, initializers and ST bodies are in `upstream/plc_garden_controller.xml`. Upstream generated source documentation, native project and visualization assets remain available for comparison.

## Complete authored application

All six POUs, eight actions, three DUTs and one GVL are ported: 18 objects mapped in `port.json`. The 14 ST bodies contain 528 lines including comments and blank lines, excluding declarations, initializers and visualization data.

| Original object                        | Maintained source                                                      |
| -------------------------------------- | ---------------------------------------------------------------------- |
| Flower_typ, Platform_typ, HMI_Cmds_typ | `src/types.ts`                                                         |
| gIO                                    | `src/gIO.ts`                                                           |
| BYTES_TO_DWORD                         | `src/color.ts`                                                         |
| checkOverlapRectangle                  | `src/geometry.ts`                                                      |
| ClockPulse                             | `src/clock.ts`                                                         |
| AutomaticFlowerWatering                | `src/watering.ts`                                                      |
| main and four CONTROL_GARDEN actions   | `src/controller.ts`, `src/main.ts`, `src/routes.ts`                    |
| simu and four SIMULATE_GARDEN actions  | `src/simulator.ts`, `src/flower.ts`, `src/platform.ts`, `src/gardens/` |

All 32 gIO fields keep their names and PLC types. Each HMI record initially has CtrlOn TRUE and all other commands FALSE. All four platforms initially have zero position and a closed valve. Each of the 100 flowers retains its original x/y coordinate and DUT defaults: alpha=255, red=2, green=253, blue=0, packed color=0, REAL humidity=100 and alive=TRUE. Packed color is deliberately zero before the first simulator invocation, despite the nonzero channel defaults. All four 25-by-2 INT route tables retain their 200 coordinates and traversal order.

## Preserved control and simulator behavior

- The wrapper calls all four controller actions, then the native clock and all four simulator actions, at 20 ms, priority 1. Manual mode starts enabled. Each garden preserves its physical X/Y direction orientation, all cardinal and diagonal commands, and direct manual water-valve control. Automatic control supplies its own route and absolute platform feedback to one of four independent persistent watering blocks.
- Automatic watering reads the current target before updating its index. At that target it calls TON with one second and opens the valve. Completion resets TON, closes the valve and advances the UINT index, wrapping step 25 to zero. The completion scan still computes motor outputs from the old target; the new target takes effect on the next invocation.
- Away from a target, the watering block holds its valve state and does not update TON. Manual mode does not call the automatic block at all. Neither case introduces a reset that the original code did not perform.
- The simulator decreases humidity and clamps to zero before its separate watering addition. Rectangle overlap and the platform's previous stored valve state control watering. Flowers run before platform movement, offset feedback and copying the current valve command; newly commanded movement/valve state affects flower watering on the next scan.
- Flower liveness is sampled before channel updates or clamps. Dry or excessive humidity raises red, then conditionally lowers green using the updated red. Otherwise a living flower raises green, then conditionally lowers red using the updated green. Each channel wraps at its BYTE assignment before LIMIT 1..254. The alive count uses that earlier liveness result, not a newly inferred color state.
- DWORD packing preserves B0 in bits 0..7 through B3 in bits 24..31; the caller passes blue, green, red, alpha. Platform CCW takes priority over CW, arithmetic stores to INT before its original bounds clamp, and absolute offsets follow movement.

## Representation and numeric contracts

PLC-TS uses one main wrapper for the original main/simu task calls. Related platform and alive-count variables are grouped into persistent records; garden arrays, gIO and route tables remain separate. Shared flower and axis helpers centralize identical authored simulator policy; they operate on explicit copied records or scalar values. Geometry and byte packing remain pure functions. The three target/at-target private watering scratch variables become invocation locals: each was overwritten before every read, so their prior values were unobservable. The original private i, valve latch and TON remain persistent. No control state, public output or initialized flower data is omitted.

Fixed-array access requires a static index proof. A bounded 0..24 lookup selects the route pair matching private i into invocation locals. Valid execution always keeps i within that range; a pre-lookup guard resets an impossible corrupted index >=25 to zero. This guard changes only externally corrupted state that the authored transitions cannot reach; it does not change the valid route sequence or advance timing. Route shape is represented as nested fixed arrays instead of a multidimensional native array.

Function blocks require complete input updates. ClockPulse's upstream f input initializes to 500 ms; generated input storage initially defaults to zero, but the simulator immediately supplies the original 20 ms value on every invocation. Its pre-invocation input default is a representation difference that the authored application never reads. Pulse initially defaults FALSE. Native Util.BLINK executes before R_TRIG on every clock call. Watering TON resets explicitly supply PT=1s: the previous active call has already supplied that same preset, and IN=FALSE resets Q/ET independently of PT.

[CODESYS untyped floating constants use LREAL](https://content.helpme-codesys.com/en/CODESYS%20Development%20System/_cds_operands_constant_typedliterals.html). The humidity subtraction uses the original decimal 0.07 in a transient LREAL local, widened losslessly from the stored REAL. The lower clamp executes before one `saturate<REAL>` store. The separate watering expression retains its separate REAL assignment. Boolean multiplication is expressed by branches choosing the original coefficient or positive zero; false paths still perform subtraction/addition with zero. There is no persistent wide humidity state or extra intermediate REAL store.

Float saturation clips finite values before rounding, but the clipping cannot trigger here: subtracting 0.07 or zero leaves the positive REAL endpoint unchanged at LREAL precision, and the lower clamp makes the result nonnegative. The authored finite REAL / 64-bit LREAL target contract is preserved; no policy for externally injected NaN or infinities is asserted.

Native integer temporary values stay wide until an authored storage or function-input assignment. Rectangle edge sums and ABS negation use DINT, which contains every possible INT sum and negation. Simulator nozzle coordinates are calculated in DINT and explicitly wrap to INT at the original geometry function's INT input boundary. Platform movement wraps at its INT assignment before LIMIT; absolute feedback wraps at the original INT assignment. Color arithmetic widens BYTE values to DINT, then wraps to BYTE at each original store before LIMIT. DWORD shifts use explicit BYTE-to-DWORD widening.

The authored initialized/transition flow cannot produce negative-zero humidity: it starts at positive 100, subtracts a positive decimal or zero, clamps negative values to positive zero, and adds a nonnegative coefficient. The port preserves the original lower-bound comparison for that reachable flow. [CODESYS MAX documentation](https://content.helpme-codesys.com/en/CODESYS%20Development%20System/_cds_operator_max.html) does not specify which equal signed-zero input wins. Bit parity for an externally injected negative-zero humidity at this MAX tie is outside the verified scope; a JavaScript Math.max tie rule is not used as a vendor oracle.

The original visualization, visualization task, device configuration and assets remain archived. The generated application replaces the original control task with a 20 ms priority-1 MainTask in the shared virtual template. It does not recreate or rebind the original UI or assert commissioning behavior.

## Verification

Tests compile the maintained source and execute normalized PLC IR through the test-only executor, never importing PLC TypeScript as JavaScript. They verify upstream hashes and all object mappings; every route and initialized flower coordinate; wide geometry/strict edge behavior, INT extrema and assignment wrapping; BYTE overflow, clamp/order, liveness and DWORD packing; promoted humidity arithmetic including zero inputs; every route's full one-second dwell and wrap; manual orientation and prior-valve feedback; all 100 flower updates and native clock scan order; and full controller/platform arrival and automatic progression.

The BLINK test model covers continuous fixed positive phases with every boundary sampled by the full 20 ms simulator scan. It is not a general vendor timing oracle. Isolated watering tests omit the simulator clock so they can jump directly across TON dwell boundaries.

Source/config TypeScript checks, PLC source/target admission, normalized-IR behavior and CODESYS compilation through `@vplc/build` are separate gates. The current build runs in Docker; see [README.md](README.md) for commands. Generated ST and copied build artifacts are under `.vplc/artifacts/`, with vendor outputs in `build/`. No deployment, physical runtime execution or commissioning is part of this port.
