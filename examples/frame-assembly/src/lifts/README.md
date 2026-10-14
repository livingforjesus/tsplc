# RT3 lift device boundary

## Installed RT3

Field observations supplied for this installation identify **Intelligrated / Honeywell ZoneMax 49340401**, hardware revision **8**, software revision **4.34**, EasyRoll+ Current Mode **PLC**. The **RIGHT MOTOR** drives the RT3 lift MDR; the left motor appears unused (connection error, zero current/operating time).

Production assumes **Full PLC Controlled / PLC I/O mode with no ConveyLogix program**. The manually uploaded `Transfer_REV` was a test artifact and will be removed. No program interface arrays or local controller application participate in lift sequencing.

Observed RIGHT MOTOR EasyRoll settings remain stored in ZoneMax:

| Setting              | Installed value   |
| -------------------- | ----------------- |
| Configured direction | Counter Clockwise |
| Brake method         | Servo Brake1      |
| Closed loop          | Enabled           |
| Speed                | 80%               |
| Acceleration         | 5 pulses          |
| Deceleration         | 80 pulses         |

CODESYS selects direction, commands Run, qualifies endpoints and owns position, timeout and fault state. ZoneMax owns BLDC commutation, configured direction, closed-loop operation, braking, protection and motor feedback. Normal scans command only Run/Reverse. Leave brake method, speed-control method and speed reference at **use configured value** in the production I/O assembly; do not overwrite the stored settings every scan.

**FIELD-CONFIRMED on the tested RT3:** physical **CW raises**, physical **CCW lowers**. Loading against either mechanical hard endpoint produces **Motor Overload**; releasing Run ends the drive command. This overload is installation-specific process feedback, not a generic motor safety limit switch. Machine safety, E-stop and guards remain separate safety functions.

## Shared production and simulation architecture

```text
FB_Diverter -> Lift.Command -> FB_LineLift -> MotorRun / MotorReverse
    -> ZoneMax RIGHT MOTOR -> RT3 lift
    -> actual rotation + overload + motor diagnostics -> Lift.Input -> FB_LineLift
```

`ST_LineDiverter.Lift : ST_LineLift` retains Input, Output, Status and Command. The virtual plant substitutes for ZoneMax/mechanics at exactly this boundary; the compiled PLC logic is identical. `FB_Diverter` knows no motor registers, bit positions or endpoint mechanics. It permits through drive only at Lowered, transfer drive only at Raised, with healthy lift status and actual stopped motor feedback. Unknown position inhibits both paths.

The direct Raise/Lower mapping assumes the installed configured CCW direction:

| Requested motion          | MotorRun | MotorReverse          | Physical rotation |
| ------------------------- | -------- | --------------------- | ----------------- |
| Raise                     | TRUE     | TRUE                  | CW                |
| Lower                     | TRUE     | FALSE                 | CCW               |
| Stop / qualified endpoint | FALSE    | Ignored while stopped | Stopped           |

Verify every RT3 card's configured direction before deploying across the line. Changing configured direction changes Reverse semantics; physical CW/CCW endpoint expectations stay the same.

## Direct RIGHT MOTOR PLC interface

The [original ERSC v4.7 developer guide](https://www.indsoft.bg/downloads/CL/ConveyLinx_Developers_Guide_v4_7.pdf), pp. 53–60, documents Full PLC I/O assemblies. These are intended device-boundary mappings, **not CODESYS physical addresses**. The checked-in project is a virtual PLC without the installed fieldbus/device tree; confirm the exact assembly/device mapping for firmware 4.34 during commissioning.

| Direction | Module register                | Assembly / word | EtherNet/IP representation | Decode                                                                     |
| --------- | ------------------------------ | --------------- | -------------------------- | -------------------------------------------------------------------------- |
| Output    | 4:0270 RIGHT Motor Run/Reverse | #8 / 7          | `O.Data[7]`                | bit 0 = MotorRun; bit 8 = MotorReverse                                     |
| Input     | 4:0082 RIGHT Motor Status      | #7 / 11         | `I.Data[11]`               | bits 0–1 jointly: 00 stopped/braking; 01 CCW; 10 CW; 11 stopped/free coast |

Decode rotation as a two-bit state; `11` must never publish both running BOOLs. `MotorRunning` is their OR, never a command echo. Diagnostic normalization belongs at the I/O boundary:

| Status bit | Normalized input  | ERSC description    |
| ---------- | ----------------- | ------------------- |
| 6          | MotorOverVoltage  | Over-voltage        |
| 7          | MotorLowVoltage   | Low voltage         |
| 8          | MotorOverheated   | Overheated          |
| 9          | MotorOverCurrent  | Over current        |
| 10         | MotorShortCircuit | Short circuit       |
| 11         | MotorNotConnected | Motor not connected |
| 12         | MotorOverloaded   | Overloaded          |
| 13         | MotorStalled      | Motor stalled       |
| 15         | MotorUnavailable  | Motor not used      |

EasyRoll+ v4.34 labels include Voltage Drop, Max Torque, Motor Stalled, Overheated, Short Circuit, Overload, Motor Sensor Error and Overvoltage. **Verify bit 9 / Max Torque on the installed firmware.** This contract follows ERSC Over Current semantics and faults that input; it does not silently substitute Ai2 maximum-torque semantics. The contract uses the motor diagnostics listed above. `MotorUnavailable` also covers unavailable/stale feedback at the I/O boundary; the production mapping must assert it on lost status. There is no separate lift `Valid` flag. Configure and verify the controller's own communication-loss stop behavior.

## Direct lift control

`FB_LineLift` keeps the Raise/Lower `CASE` and one request lifecycle. Private memory is PreviousCommand, Moving and WaitingForOverloadClear. A request is pending while position is Unknown and no fault has ended it; completion is derived from the PLC-owned Status record.

- Raise requests CW / Reverse TRUE; Lower requests CCW / Reverse FALSE. Every fresh Raise/Lower request verifies its endpoint again, even when the remembered position already matches. Position becomes Unknown while that request is pending.
- A held command gets one attempt. Endpoint completion or failure finishes that request; the command remaining asserted cannot restart it when overload or a fault clears.
- A move begins only with stopped feedback and overload FALSE. New overload during the move removes Run in that scan and establishes the requested endpoint. No motor-running sample is required when already at the hard stop.
- Endpoint completion waits for overload to clear before another move. Stall accompanying that expected overload is tolerated; ordinary stall, pre-existing overload, wrong direction and native motor faults end the request with Faulted TRUE.
- Stop removes Run immediately and preserves an already-confirmed endpoint. An interrupted move remains Unknown. A changed direction waits for actual stopped feedback and overload clearance before running.
- A fresh command resets the request's completion, fault and timeout result. The existing System Stop/Start sequence explicitly retries without restarting the PLC. Raw controller faults must clear first; this rearms software and does not send a controller reset command.

Overload qualification cannot distinguish a mechanical obstruction that produces exactly the same feedback as an endpoint. This remains the supplied installation's process assumption. Machine safety remains separate. The existing operator Start sequence requests Lower; application initialization does not add physical homing.

## Request time budget

MotionTimeout defaults to **3 s** for one Raise/Lower request, including waiting for the motor to stop or previous endpoint overload to clear, startup and travel. Expiry removes Run, sets MotionTimedOut/Faulted, and finishes only that request. A held command stays stopped; a fresh command rearms it. There is no separate timer after a completed request.

**TODO / FIELD MEASUREMENT REQUIRED:** measure motor start, both strokes, endpoint-contact-to-overload and Run-release-to-overload-clear; replace this development budget with measured margins. Overload-clear behavior after Run removal is still unconfirmed in the field.

## Simulation

`LiftSimulation` keeps private height 0…1, consumes only MotorRun/MotorReverse and publishes normalized Input; it never assigns Status.Position. The installed CCW configuration gives Reverse TRUE → physical CW → rising height, Reverse FALSE → CCW → falling height. Before an endpoint it reports expected actual rotation without overload. At the requested hard endpoint height clamps, rotation stops and overload asserts while Run remains requested. Removing Run stops motor feedback immediately; overload clears after configurable `overloadClearMs`.

**SIMULATION ASSUMPTIONS:** immediate drive response, 500 ms stroke, initial height 0 and 100 ms overload-clear delay. The PLC still starts Unknown. Timings, inertia and exact contact dynamics need measurement. Actual rotation feedback is independent of command and can be wrong or absent.

Fault injection supports motorRemainsStopped, motorStalled, motorNotConnected, jammedHalfway (stall, no endpoint overload), neverReachesEndpoint (expected rotation without overload), wrongDirection, overloadAlreadyActive, overloadNeverClears and communicationLoss/MotorUnavailable TRUE. External OPC UA device diagnostics are preserved; simulator-generated endpoint overload clears through its own physical lifecycle. Clear injected/raw causes before an explicit Stop/Start retry.

`BinPresent` coverage across the entire lateral transfer remains **uncommissioned**. Keep that existing warning; occupancy is not independent transfer-complete feedback.

## Sources

- [Controller compliance declaration / ZoneMax JST-family relationship](https://pulseroller.com/files/NA/Controllers/EZ-QUBE%20Family/Certifications/Composite%20CoC%20for%20Controller%20Products.pdf).
- [Full PLC Controlled Mode](https://www.manula.com/manuals/pulseroller/conveylinx-ai2-user-s-guide/2.1/en/topic/modes-of-operation): mode context only; do not import Ai2 diagnostics into the installed ERSC contract.
- [PLC Run/Reverse outputs](https://www.manula.com/manuals/pulseroller/conveylinx-ersc/2/en/topic/plc-i-o-mode-assembly-outputs).
- [ConveyLinx developer guide v4.7](https://www.indsoft.bg/downloads/CL/ConveyLinx_Developers_Guide_v4_7.pdf): accessible documentation for assemblies #7/#8 and ERSC motor feedback. The two Manula pages were unavailable to automated retrieval during this change.
- [RT3 controller part 49340401](https://www.radwell.com/Buy/INTELLIGRATED%20SYSTEM/INTELLIGRATED%20SYSTEM/49340401): supplied public part corroboration; automated retrieval unavailable. Installed revision/settings/direction/endpoint behavior above are supplied **field observations**, not inferred from this listing.
- [Transfer conveyor patent US9290333B2](https://patents.google.com/patent/US9290333B2/en): mechanical family context, not proof of the installed electronic mapping.
- [Historical MDR 710 Electric RAT manual](https://www.scribd.com/document/823553754/MDR-710-With-WWL-Installation-and-Maintenance-Manual): **this is an older Electric RAT architecture and is not used as the active RT3 endpoint model**. Its fork-sensor architecture is historical family context only; no external upper/lower sensors have been identified on this installed RT3.

## Remaining commissioning items

- Exact CODESYS fieldbus/device-tree mapping and diagnostic normalization for ZoneMax firmware 4.34, especially bit 9 / Max Torque.
- Whether every RT3 RIGHT motor has the same configured CCW direction.
- Measured motor-start, raise, lower, endpoint-to-overload and overload-clear times.
- Whether normal endpoint overload also asserts Stalled / Max Torque.
- Exact controller fault reset/recovery behavior.
- Communication-loss device settings, actual Run-removal behavior and freshness/restart detection.
