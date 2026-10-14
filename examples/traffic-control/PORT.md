# Traffic-control port scope

Source: [tkucic/plc_traffic_control](https://github.com/tkucic/plc_traffic_control/tree/49c9de4e8ce588de3fd7f831e5f78ce6e303c1d9), commit `49c9de4e8ce588de3fd7f831e5f78ce6e303c1d9`, MIT, copyright Toni Kucic. All 22 repository files are preserved unchanged under `upstream/` and hashed in `upstream.json`. The authoritative logic and initial values are in `upstream/plc_traffic_control.xml`; generated ST documentation is retained for readability.

## Complete authored logic

The PLCopen application contains four POUs, eight actions, three DUTs and one GVL. All 16 objects are mapped in `port.json`. The source has 12 ST bodies totaling 815 lines including comments and blank lines; declarations and visualization XML are excluded from that measure.

| Upstream object               | Maintained source                                    |
| ----------------------------- | ---------------------------------------------------- |
| SpriteDef_typ                 | `src/types.ts`                                       |
| trafficLightCars              | `src/types.ts`                                       |
| trafficLightPed               | `src/types.ts`                                       |
| isSpriteColliding             | `src/geometry.ts`                                    |
| Sprite                        | `src/sprite.ts`                                      |
| simulator                     | `src/simulator.ts`, `src/sprites.ts`, `src/state.ts` |
| simulator.CHECK_COLLISSIONS   | `src/collisions.ts`                                  |
| simulator.MOVE_CARS           | `src/movement.ts`                                    |
| simulator.MOVE_PEDESTRIANS    | `src/movement.ts`                                    |
| simulator.UPDATE_OBJECTS      | `src/simulator.ts`                                   |
| simulator.CONTROL_LIGHTS      | `src/lights.ts`                                      |
| simulator.FAULT_MONITOR       | `src/faults.ts`                                      |
| simulator.BLINK_DANGER_SIGNAL | `src/lights.ts`                                      |
| simulator.BLINK_YELLOW_SIGNAL | `src/lights.ts`                                      |
| main                          | `src/controller.ts`, `src/main.ts`                   |
| gIO                           | `src/gIO.ts`                                         |

## Preserved behavior

- Controller timer preset is 62 seconds. Elapsed time is captured before resetting TON; inclusive phase boundaries and unsigned integer countdown truncation are unchanged. Same-scan mirror assignments are explicit value copies.
- All twelve sprite initializers retain every field, including default `speed = 0`. Position initializes on the first update. INT movement and relative-coordinate arithmetic explicitly wrap. Screen exits use strict `>` and `<`; equality with a screen edge or negated sprite size does not wrap. Lower-bound comparisons negate dimensions in DINT temporaries, including INT minimum, while the assignment of a negated dimension back to INT still wraps.
- All twelve movement paths, stopping coordinates, exact light predicates and sprite-update order are retained. Decisions read the simulator's previous lamp image before copying the current controller image.
- All 51 collision checks execute in their original order. The last matching check sets the message and crash coordinates, including authored message spelling. Rectangle edge touching does not count as a collision. INT coordinates and dimensions widen to DINT for edge sums in comparisons; those temporary sums do not wrap at the INT boundary.
- Police mode takes precedence over the collision/danger freeze. Fault monitoring runs after the selected branch. Collision messages can overwrite dangerous-light messages; only the normal branch clears the message. Crash flags hide at `-200` when no collision remains.
- One native Util.BLINK uses one-second low/high times. Lamp actions read its previous output, then the block updates at the end of the scan. Public `goTo` inputs remain present and receive their unused zero default; the never-assigned `atDestination` output retains FALSE.

## Representation changes and exclusions

Static PLC-TS blocks require complete input updates, so each Sprite update supplies the preserved definition, zero `goTo`, and current movement fields. Native timer resets explicitly resupply their unchanged PT. The original collision function accepts two FB values; its port receives their readonly output snapshots and definitions because PLC-TS forbids copying or aliasing FB instances. A single collision-reporting helper centralizes the identical state writes without changing check order.

Related simulator storage is grouped into records; `state.vPoliceControl` retains the original program's operator-controlled mode flag, while `gIO.PoliceModeActivated` is still its reported state. The unused private Sprite variables `vActualX` and `vActualY` are omitted: neither appears in any authored statement. Public unused fields remain. These source grouping choices change engineering object paths; the original visualization has not been rebound to those paths.

The original project, visualization, SVG/images, device setup and documentation are preserved as upstream assets. They are not generated by PLC-TS. The port's host configuration uses the shared virtual engineering target with Standard/Util libraries and a replacement 5 ms priority-1 task; it does not claim to recreate the original hardware or visualization task.

## Verification

`tests/traffic.test.ts` compiles the actual port into normalized PLC IR and executes that IR in the test-only executor. It never imports or executes PLC TypeScript as JavaScript. Tests check all upstream hashes/object mappings, all twelve initializer records, controller boundaries/countdown/reset, full 5 ms simulator scans, held decision points, BLINK phase delay, freeze/police priority, ordered fault detection and clearing, strict collision geometry, both screen axes/edges and INT storage wrap versus wide collision sums. BLINK tests use unchanged positive durations and sample every phase boundary; they make no claim about skipped boundaries, restarts or zero-time native behavior.

Source/config TypeScript checks, PLC semantic checks, full ST emission and focused behavior tests are separate from a `vendor-compiled` receipt produced by CODESYS through `@vplc/build`. Vendor compilation was previously exercised for this port. The current build runs in Docker; see [README.md](README.md) for commands. Generated ST and copied build artifacts are under `.vplc/artifacts/`, with vendor outputs in `build/`. No deployment, physical runtime execution or commissioning has been performed for this port.
