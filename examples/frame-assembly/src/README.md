# Authored PLC source

`Main.ts` calls conveyor control, reader handshakes, then diverter sequencing. `types/` and `globals/` own the shared interface. Check and emit this port from the example directory:

```sh
bun run check-sources
bun run emit
bun run build
```

The following wiring, bridge and simulation notes are preserved from the source application. This example contains PLC source and its virtual engineering template; it does not include or run the companion bridge, simulation, contract generator, or physical deployment workflow. The source application's hardware review remains outside this PLC-only port.

Rebuild and download the matching application before running the bridge. The checked-in template is a **virtual PLC**, without the installed machine's EtherNet/IP device tree or electrical I/O mapping. Consult the source application’s hardware review and assembly inputs before physical commissioning.

## Transport and stop requests

`FB_LineConveyor` receives its conveyor, card count, and enable request in one call. There is no retained pointer or separate initialization/motion lifecycle. Unassigned slots remain held. The card array bound comes from `LineConstants.ConveyorCardCapacity`.

The transport path assumes native CS1001 ZPA with SW2-6 OFF: asserting CN2-1 holds occupied zones; clearing it resumes automatic accumulation. This is **not an immediate motor stop or an emergency-stop circuit**. The mapping must handle electrical polarity. Local card settings own speed until roller models and analog I/O are commissioned; the program no longer calculates a voltage from an assumed roller speed curve. `SpeedVolts` remains a raw auxiliary interface field, not a speed regulator.

Invalid supervisory stop feedback inhibits start. Clearing a stop requires releasing and pressing Start again. `EmergencyStop*` are supervisory inputs; the simulation adapter supplies their validity in virtual runs. They are not safety-rated devices or substitutes for a wired safety chain.

## Diverters

`FB_Diverter` is the single transfer sequencer. `PRG_Diverters` supplies static station/branch mappings, a requested route, and admission permissions. `F_DiverterRoute` selects a logical side from left/right matches, preferring left when both match and through when neither matches. Station and carrier enum comparisons stay typed at the call sites; absent ports never match. `F_StationAvailable` admits an already-reserved bin only when the station is enabled, configured with nonzero capacity, and not physically full. The bridge reserves capacity before publishing the scanner reply.

`ThroughDrive` and `TransferDrive` are the two `ST_LineCS1001` cards. The sequencer writes their `Output.MotionAsserted` fields directly and sets `TransferDrive.Output.DirectionOrSlaveErrorAsserted` for a right transfer; the through card keeps its base direction. Both cards' `Input.Error` feedback inhibits the sequence. The simulator reads these same card outputs. The installed RT3 lift uses the ZoneMax RIGHT motor in Full PLC I/O mode. `FB_LineLift` commands Run/Reverse, establishes position from qualified endpoint overload, and ends failed requests on motor faults or timeout. A fresh command rearms the request after raw faults clear. See [lift control and register mapping](lifts/README.md).

The diverter outputs assume forced-run CN2-1 (SW2-6 ON) and ZPA direction control on CN2-2. This differs from the main conveyors' accumulation-hold setting. Removing force-run returns control to the card's configured behavior: assembly must verify the motor assignments, mode, polarity, left/right rotation, and actual stopping behavior, then map the fields to electrical I/O. Speed stays locally configured on the cards.

The scanner writes the lookup result directly into `Route` and sets `RouteReady`. That same record stays unchanged before arrival and throughout transfer. The next barcode remains buffered until the payload leaves; departure clears the route and its ready flag. There is no pending-to-active copy or separate current-payload barcode.

`BinPresent` is the single normalized occupancy input. Physical sensor count and coverage still need field confirmation. There is no separate busy field. The private `BinWasPresent` bit detects departure without clearing a route that arrived before its payload.

`RequestedDirection` maps `Route` to the configured through/left/right port. `Status.SelectedDirection` is through while empty and hold on arrival until a route is ready and motion is enabled. The sequencer then chooses once: use the requested side if available, otherwise continue through. That direction stays unchanged until departure, so a skipped bin cannot turn sideways if availability improves and an admitted transfer cannot be stranded if the destination becomes full. No separate transfer-permission bit is needed. An early lookup cannot raise the lift before arrival, and a late lookup holds the arrived payload. Each scan starts with both conveyor motor outputs clear. The selected direction writes `Lift.Command` (Stop/Raise/Lower). `FB_LineLift` always runs; disabling motion requests Stop immediately. Through motion requires derived Lowered position, lateral motion requires Raised position, and both require healthy lift status and actual stopped motor feedback. `FB_Diverter` contains no endpoint state machine or controller register details. See [device control, request retry policy and commissioning mapping](lifts/README.md).

Bypassing a destination does not guarantee another suitable station downstream. Later scanner lookups reconsider the bin's reservation; a bin that passes the last applicable diverter needs an end-of-line handling and reservation-reconciliation policy.

**UNVERIFIED INSTALLATION DETAIL:** the model assumes `BinPresent` covers the entire transfer; occupancy is not independent transfer-complete feedback. When it clears, the sequencer resets and lowers the lift. A single point sensor may not provide this signal: sensor positions, transfer-complete feedback, timeouts, and recovery must be established during assembly.

`Diverter_ShrinkWrapLoadBalancer` is controlled by the PLC through `FB_Diverter`. It alternates once per photoeye arrival: through to finishing lane 1, then left to lane 2. The simulation supplies photoeye/lift inputs and follows the commanded motors, keeping the photoeye occupied until the payload clears the shared entrance. The separately declared shrink-wrap diverter still lacks commissioned control logic.

## Carrier sorting

Each carrier diverter has its own reader and uses `FB_LineScannerForDivert` and `FB_Diverter`. `E_LineCarrier` is the shared destination contract, generated into TypeScript: 1 USPS, 2 DHL domestic, 3 DHL international, 4 UPS, 5 FedEx, 6 Passport, 7 Amazon logistics. Diverter 1 sends USPS right; diverters 2–4 send the remaining pairs left/right. Unknown destinations pass through to the end. Carrier exits feed gravity conveyors and are always available to routing; they have no collection-full input. `ST_LineCollection.Full` applies only to empty-bin and QC collection sensors.

The bridge matches order, folder, or process barcodes and selects the most recently printed, non-voided shipping label. Both DHL provider codes use the delivery country: US is domestic; other countries are international. Unknown/ambiguous orders, unsupported carriers, and absent printed labels pass through. Database failures retain the pending request for retry. Entry at carrier reader 1 refreshes the destination; downstream readers cache the decision, including pass-through. Reader 4 releases its cache entry; entries for earlier exits expire after five minutes. The carrier simulation receives packed orders from both outbound station lanes onto a shared handoff, triggers each reader with the order/process barcode, and follows PLC through/transfer commands. It supplies actual motor direction, endpoint overload, normalized diagnostics and diverter occupancy. Development station work and collection pickups are explicit dashboard actions; items remain physically present until acted upon. Canvas and oversize bin reception hands them to their offline stations. Each new simulated order gets an unprinted, zero-cost label for a configured carrier destination. Station actions use the same intake and completion rules as production; boxing substitutes local printing/shipping for external services and makes the label available to normal carrier routing. See the simulation source guide for its physical assumptions.

## Scanner handshake

The DataMan model uses buffered results and a four-phase `ResultsAvailable` / `ResultsAck` handshake. Reader trigger mode must be configured independently; the simulator models one Self-mode acquisition per crossing.

1. The PLC copies the barcode bytes, length, and reader context into a stable request, then sets `RequestReady`.
2. The worker writes `ApplyRouting` and the scanned barcode (plus any route) together, then commits in a separate `ResultReady` write. A changed OPC UA session aborts publication.
3. The PLC writes the response directly into the diverter's `Route`, sets `RouteReady`, and clears `RequestReady`. A pass-through reply also completes the lookup; unknown/no-read labels retain the existing through policy.
4. The worker clears `ResultReady`. The PLC does not consume the next buffered barcode until the routed payload leaves and `RouteReady` clears.

A missing lookup holds an arrived payload. There is no scanner-location brake invented by the simulator. Physical gating, one-result-per-payload triggering, and overrun recovery remain commissioning requirements. There is no lookup timeout that releases a pending request.

## Routing, queues, and simulation

The worker caches classification while a bin owns an unfinished station reservation. Unreserved bins are classified again on later scans, so empty, invalid, or previously unassigned contents cannot persist across reuse. Reservations are removed on physical release; later scans classify the bin from its current contents. Existing reservations are reconsidered when their destination becomes disabled or full. QC readers match folder IDs case-insensitively and picking-slip order IDs exactly, using current unresolved QC status.

`ST_LineStation` contains only `Enabled`, `Capacity`, and the physical `QueueFull` input. The backend owns reservations; there are no queue IDs, queue counters, active order identities, processing flags, or queue-publication `Valid` bits in PLC. A scanner's `ResultReady` is the only route-publication commit. Framing completion alone does not free capacity: routing releases it when the empty bin is scanned on outbound, in both production and simulation. Manual work is reconciled from current order locations. A missing release remains reserved for physical reconciliation.

Production reservations are committed to SQLite before scanner acknowledgement. Set `OPCUA_ROUTING_STATE` to a durable local path (default `.state/inbound-routes.sqlite`, relative to the bridge's working directory); preserve this file and its WAL across bridge restarts. Failed storage operations leave the scanner request pending. This is a single bridge per line. Virtual runs use an in-memory reservation store because their physical world resets with the simulation engine. When upgrading from the old PLC queue mirror, stop admissions and drain/reconcile the line before downloading the new PLC interface; existing PLC queue IDs are not automatically migrated.

The bridge awaits Drizzle Kit's programmatic SQLite schema push before starting routing. The `inboundRoutes` table declaration owns the schema; pushes that would discard stored data stop startup. Reservation reads and writes remain synchronous. The standalone build excludes Drizzle Kit's unused database drivers and uses Bun's built-in SQLite driver.

The development simulator supplies physical inputs and emulates people working at stations. It follows diverter motor outputs without consulting routing decisions, barcode matches, or production reservations. Conveyor accumulation uses the PLC's conveyor enable feedback and schematic spacing. Order transitions use the shared production persistence helper; shipping labels remain development fixtures.

See the [simulation source guide](../../opc-ua/src/simulation/README.md) for the folder structure, tick sequence, and physical assumptions.

## RT3 hardware evidence

The installed ZoneMax 49340401 RIGHT motor is configured CCW; physical CW raises and CCW lowers. Raise commands Reverse TRUE, Lower commands Reverse FALSE. A qualified new overload during deliberate motion establishes the hard endpoint and removes Run in the same scan. Overload outside that context faults. Position starts Unknown; the existing operator Start sequence requests Lower to establish its endpoint. Device configuration remains in EasyRoll/ZoneMax.

The virtual PLC exposes normalized direction, overload and diagnostic feedback. Production mapping belongs in the commissioned device/I/O boundary: ERSC Full PLC I/O output assembly #8 word 7 / register 4:0270 Run bit 0 and Reverse bit 8; input assembly #7 word 11 / register 4:0082 RIGHT motor status. See [installed settings, request handling, timing budget, sources and remaining commissioning values](lifts/README.md). The old Electric RAT fork-sensor model is historical only.

## Compiled virtual PLC integration tests

Start the built virtual PLC (`bun turbo run dev --filter=@frame-assembly/plc`) and run:

```sh
PLC_TEST_ENDPOINT=opc.tcp://127.0.0.1:4840 bun turbo run test-plc --filter=@frame-assembly/opc-ua
```

This explicit local-only suite writes test inputs into the virtual application, restarts the configured Docker PLC between cases to isolate request and route state, stops line motion on teardown, and executes the real compiled Main, FB_Diverter and FB_LineLift. It reads the repository-generated contracts through the production OPC UA variable manager and closes the loop with the real plant simulator. The regular OPC UA suite does not connect to a PLC. Integration tests reuse the bridge's local OPCUA_SECURITY/OPCUA_PKI and OPCUA_USERNAME/PASSWORD configuration; PLC_TEST_USERNAME/PASSWORD can override credentials for a dedicated virtual runtime. They do not relax server security or trust settings.
