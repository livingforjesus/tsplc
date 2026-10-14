# EDS layouts of the example descriptors

The [bottling-line example](../../examples/bottling-line/README.md) ships three EtherNet/IP descriptors: a Cognex DataMan 300 reader, a ConveyLinx-430/510 conveyor controller and a B&R X67BCD321.L12 bus controller. The parser supports all three. It infers omitted layout sizes, keeps configured connection payload sizes separate, resolves the actual runtime assembly instances from EPATH, preserves packed Cognex flags and exposes bounded byte-span elements. Tests cover Cognex's default 496-byte payload and 500-byte override, ConveyLinx's 16-bit reset-protected instances, and B&R's input 124 / output 112 instances. See [hardware.test.ts](../../packages/typegen/src/hardware.test.ts) and the [example config](../../examples/bottling-line/tsplc.config.ts).

The example uses virtual process-image addresses to verify EDS layout, typed IO and code generation. That does not establish a live connection to physical Cognex, ConveyLinx or B&R hardware; scanner topology remains template-owned.

The investigation below records the **initial parser failures and the evidence that guided the implemented fixes**. Statements about the original parser and proposed API in those sections describe that initial snapshot, not the current implementation. File identities, connection records and member offsets remain the source evidence.

## Identities and first parser failures

| File                                                                                          | Declared identity                                                | Vendor ID / product type / product code | Revision | Initial result                                               |
| --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | --------------------------------------- | -------- | ------------------------------------------------------------ |
| [0678077312900100.eds](../../examples/bottling-line/eds/0678077312900100.eds)                 | Cognex, DataMan 300 Series Reader; catalog DMR-3XX-00            | 678 / 773 / 1290                        | 1.5      | `Invalid EDS Assem11 size: .`                                |
| [ConveyLinx_V5_10_CODESYS.eds](../../examples/bottling-line/eds/ConveyLinx_V5_10_CODESYS.eds) | Insight Automation, ConveyLinx-430/510; catalog ERSC             | 1372 / 43 / 10                          | 5.10     | `Invalid EDS Assem105 size: .`                               |
| [EthernetIP_CPU1_IF1__ST1.eds](../../examples/bottling-line/eds/EthernetIP_CPU1_IF1__ST1.eds) | B&R Industrial Automation GmbH, B&R I/O Controller X67BCD321.L12 | 887 / 12 / 44279                        | 1.1      | Parses; reports incorrect runtime assembly instances 1 and 2 |

The B&R file identifies the bus controller as **X67BCD321.L12**. B&R FieldbusDESIGNER generates this descriptor per project; the example's copy has a generic comment header and file dates, while every device, assembly and connection record is unchanged. It does not declare module names or semantic channel names. [B&R file header](../../examples/bottling-line/eds/EthernetIP_CPU1_IF1__ST1.eds)

SHA-256 of the example's descriptor files:

```text
0678077312900100.eds         cfd8bf5305a2f0d12e16416556f8ea7491581da317b0b816754ae07c1dd93817
ConveyLinx_V5_10_CODESYS.eds  10a8451469ce0afa01fa1a5f534e3f5dbfa6f3fba58583858bdaecc1c03cfa73
EthernetIP_CPU1_IF1__ST1.eds  40eca4cc247e631583bd0803a6f51ac554366879c48a59167d3a7346e6ca3cf0
```

The lexer succeeds on all three, preserving empty fields, comments, quoted strings, and multiline records. The immediate failures are the assembly parser's unconditional `integer(f[2])`. An empty assembly size is supported: its member layout supplies the size. Rockwell's first-party EDS manual explicitly recommends omitting assembly size when every member is described. [Rockwell EDS manual, printed p.54](https://literature.rockwellautomation.com/idc/groups/literature/documents/pm/1756-pm002_-en-d.pdf#page=54)

## Connections, instances, and byte sizes

Directions below are from the PLC/scanner perspective: T→O is input; O→T is output. Keep connection framing separate from assembly member offsets. The two-byte sequence count and optional run/idle header belong to transport sizing, not the relative byte positions below. [CODESYS connection dialog](https://content.helpme-codesys.com/en/CODESYS%20EtherNetIP/_enic_dlg_target_new_connection.html), [Rockwell EDS manual, printed pp.47–48](https://literature.rockwellautomation.com/idc/groups/literature/documents/pm/1756-pm002_-en-d.pdf#page=47)

### Cognex

Both assembly layouts describe **500-byte capacity**, but size parameters declare **default 496**, minimum **2**, maximum **500** bytes. These are UINT parameters with two-byte storage; their storage width is not their configured payload size. The active connection size must remain separate from capacity. [Param2, Input Size](../../examples/bottling-line/eds/0678077312900100.eds), [Param3, Output Size](../../examples/bottling-line/eds/0678077312900100.eds), [Assem11](../../examples/bottling-line/eds/0678077312900100.eds), [Assem21](../../examples/bottling-line/eds/0678077312900100.eds)

| Record                                                                              | Input format / actual instance | Input size                        | Output format / actual instance | Output size                       | EPATH                     |
| ----------------------------------------------------------------------------------- | ------------------------------ | --------------------------------- | ------------------------------- | --------------------------------- | ------------------------- |
| [Connection1](../../examples/bottling-line/eds/0678077312900100.eds), bidirectional | Assem11 / 11                   | Param2: default 496, range 2..500 | Assem21 / 21                    | Param3: default 496, range 2..500 | `20 04 24 01 2C 15 2C 0B` |
| [Connection2](../../examples/bottling-line/eds/0678077312900100.eds), input only    | Assem11 / 11                   | Param2                            | none; heartbeat point 254       | 0                                 | `20 04 24 01 2C FE 2C 0B` |
| [Connection3](../../examples/bottling-line/eds/0678077312900100.eds), output only   | none; heartbeat point 254      | 0                                 | Assem21 / 21                    | Param3                            | `20 04 24 01 2C 15 2C FE` |

Input `Result Data` is a 3872-bit span at byte 16: capacity 484 bytes, of which 480 fit in a 496-byte connection. Output `User Data` is a 3936-bit span at byte 8: capacity 492 bytes, of which 488 fit in a 496-byte connection. Treat those as byte spans/arrays, not single scalar BYTE values. The vendor's assembly table confirms Result Data indices 0..483 and User Data 0..491. This does not establish the size a deployment selects. [EDS members](../../examples/bottling-line/eds/0678077312900100.eds), [Cognex object model](https://docs.cognex.com/dmst_2532/web/EN/Industrial_Protocols_Manual/Content/Topics/PDF/DIPM/eip-object-model.htm)

### ConveyLinx

All ten assembly size fields are empty. Each sum of member widths agrees exactly with the corresponding literal connection size. No BOOL parameters occur in its process assemblies: names such as `Servo Left Status bits` and `Clear Motor Error (bit 0)` remain UINT16 declarations, without named sub-bit definitions. ConveyLogix's `Input[0]..Input[15]` and `Output[0]..Output[15]` are WORD16, not BOOL fields. [Assemblies](../../examples/bottling-line/eds/ConveyLinx_V5_10_CODESYS.eds), [Param600](../../examples/bottling-line/eds/ConveyLinx_V5_10_CODESYS.eds), [Param620](../../examples/bottling-line/eds/ConveyLinx_V5_10_CODESYS.eds)

| Connection record                                                                                         | Input format / instance / bytes | Output format / instance / bytes | RPI parameter                               |
| --------------------------------------------------------------------------------------------------------- | ------------------------------- | -------------------------------- | ------------------------------------------- |
| [Connection1, ZPA](../../examples/bottling-line/eds/ConveyLinx_V5_10_CODESYS.eds)                         | Assem105 / 105 / 42             | Assem106 / 106 / 50              | Param513: default 50000, range 8000..500000 |
| [Connection2, PLCIO](../../examples/bottling-line/eds/ConveyLinx_V5_10_CODESYS.eds)                       | Assem107 / 107 / 46             | Assem108 / 108 / 54              | Param516: default 10000, range 8000..500000 |
| [Connection3, ConveyLogix Interface](../../examples/bottling-line/eds/ConveyLinx_V5_10_CODESYS.eds)       | Assem121 / 121 / 32             | Assem122 / 122 / 32              | Param517: default 64000, range 8000..500000 |
| [Connection4, ZPA with Reset Protection](../../examples/bottling-line/eds/ConveyLinx_V5_10_CODESYS.eds)   | Assem305 / 305 / 42             | Assem306 / 306 / 50              | Param513                                    |
| [Connection5, PLCIO with Reset Protection](../../examples/bottling-line/eds/ConveyLinx_V5_10_CODESYS.eds) | Assem307 / 307 / 46             | Assem308 / 308 / 54              | Param516                                    |

RPI parameter values above are raw EDS values; these fields are connection timing, not instance or payload-size selectors. [Param513](../../examples/bottling-line/eds/ConveyLinx_V5_10_CODESYS.eds), [Param516](../../examples/bottling-line/eds/ConveyLinx_V5_10_CODESYS.eds), [Param517](../../examples/bottling-line/eds/ConveyLinx_V5_10_CODESYS.eds)

### B&R

`Assem1 = "Producing Assembly",,16,0x0000,,,128,;` and `Assem2 = "Consuming Assembly",,28,0x0000,,,224,;` are unnamed complete byte spans. There are no Params records. The current generic byte/bit channels retain these raw payloads; no physical channel labels can be inferred. [Assembly records](../../examples/bottling-line/eds/EthernetIP_CPU1_IF1__ST1.eds)

| Record                                                                                        | Input format / runtime instance / bytes | Output format / runtime instance / bytes | EPATH                     |
| --------------------------------------------------------------------------------------------- | --------------------------------------- | ---------------------------------------- | ------------------------- |
| [Connection1, Exclusive Owner](../../examples/bottling-line/eds/EthernetIP_CPU1_IF1__ST1.eds) | Assem1 / **124** / 16                   | Assem2 / **112** / 28                    | `20 04 24 01 2C 70 2C 7C` |
| [Connection2, Listen Only](../../examples/bottling-line/eds/EthernetIP_CPU1_IF1__ST1.eds)     | Assem1 / 124 / 16                       | none; heartbeat point 255 / 0            | `20 04 24 01 2C FF 2C 7C` |
| [Connection3, Input Only](../../examples/bottling-line/eds/EthernetIP_CPU1_IF1__ST1.eds)      | Assem1 / 124 / 16                       | none; heartbeat point 254 / 0            | `20 04 24 01 2C FE 2C 7C` |

## Static EPATH decoding needed for these files

Decode segments, including encoded width and little-endian value; do not assume every segment occupies two bytes. For these paths `20 04` means class 4, `24 01` means instance 1, `2C xx` is an eight-bit connection point, and `2D 00 lo hi` is a sixteen-bit connection point. `25 00 lo hi` encodes a sixteen-bit instance. Preserve the format-record ID separately from each connection's runtime instance. OpENer's first-party implementation masks the segment type and format separately, skips the required pad for wider values, and assigns consumed/produced paths in order. [Logical decoder](https://github.com/EIPStackGroup/OpENer/blob/091e2de36f7dd640c708be6c9e40e307fe212260/source/src/cip/cipepath.c#L332), [Connection path handling](https://github.com/EIPStackGroup/OpENer/blob/091e2de36f7dd640c708be6c9e40e307fe212260/source/src/cip/cipconnectionmanager.c#L1247)

Concrete decompositions:

```text
Cognex Connection1:
20 04 | 24 01 | 2C 15 | 2C 0B
class4  cfg1    output21 input11

B&R Connection1:
20 04 | 24 01 | 2C 70 | 2C 7C
class4  cfg1    output112 input124

ConveyLinx Connection4:
20 04 | 25 00 01 00 | 2D 00 32 01 | 2D 00 31 01
class4  cfg1(16-bit)  output306      input305

ConveyLinx Connection5:
20 04 | 25 00 01 00 | 2D 00 34 01 | 2D 00 33 01
class4  cfg1(16-bit)  output308      input307
```

No parameterized instance IDs occur in these three files. Cognex parameterizes connection sizes; ConveyLinx parameterizes RPI and uses wider constant instance IDs. Symbolic, routed, parameter-substituted, or unfamiliar path segments should be retained with a diagnostic until supported, rather than silently mapped from `AssemN` suffixes. [Actual connection records cited above]

## Parser changes identified by the initial probes

1. Infer an omitted assembly size from the sum of ordered member bits. Validate byte integrality and an explicit size against the layout. Keep `layoutBytes` separate from selected `connectionBytes`; an active connection may transmit only part of a declared span.
2. Retain parameter min/max/default and the connection's `id`, raw format references, size references, RPI references, flags, and EPATH. Resolve size Param references from their numeric default or an explicit configured override; never from parameter storage size.
3. Resolve runtime instances through the selected connection's EPATH, with assembly-path cross-checks where present. B&R's format keys 1/2 cannot stand in for runtime instances 124/112. Wider ConveyLinx segments must consume four bytes, even when their decoded value is small.
4. Preserve the current packed BOOL algorithm: Cognex's Params have `0xC1` and storage size 1, but assembly members explicitly have width 1. Advancing eight bits per BOOL would corrupt every following offset. Current summation and bit addresses worked in the isolated probe.
5. Represent multi-byte spans separately from scalar channels. Current Cognex named Result Data and User Data channels have `type: BYTE`, widths 3872/3936, and no address, so `generateHardwareTypes` omits them from named binding choices. Keep named spans plus optional scalar element children bounded to active connection size.
6. Generate generic bytes/bits only for the selected connection's effective payload. With Cognex default 496, capacity bytes 496..499 are not transferred and must not become addressable process data. Mark a scalar crossing the boundary unavailable; bound spans to their transferred portion.
7. Validate selected input/output formats against the chosen connection. Current `loadHardware` accepts direction from config alone; it does not reject selecting an output-only assembly as input. Zero-size heartbeat points do not produce process channels.
8. Preserve full offline identity, including vendor ID, product type, product code, major/minor revision and catalog. Current descriptor drops most of these. Imported identity and live identity, if later obtained, are distinct evidence.

The channel probe changed only scratch input text, filling omitted assembly sizes with member capacity to bypass the first failure. It did not patch implementation. It confirmed Cognex Trigger Ready at input bit 0, General Fault at bit 15, and Trigger at output bit 1; both array spans had no scalar address. ConveyLogix produced 16 input and 16 output named WORD channels. B&R emitted 396 generic byte/bit channels for its 16+28 bytes, no named semantic channels, and rejected a configured input assembly 124. Artificial base-zero addresses were used only inside that probe; no actual `%I/%Q` base was inferred. [Current channel generation](../../packages/typegen/src/hardware.ts)

For raw assembly bytes, packed BOOL extraction is `Boolean(bytes[offsetBits >> 3] & (1 << (offsetBits & 7)))`. Several flags share each byte; comparing the whole byte to `1` is incorrect. Existing IEC BOOL symbols read through the runtime already provide a boolean and need no assembly-byte decoding. This task did not test standalone CIP BOOL explicit-message encoding.

## Configuration identified during the investigation

Extend the existing device shape with a connection record ID and optional per-direction byte-size override. The `connection` and `size` fields shown below are now implemented. The address placeholders must be replaced with confirmed project values:

```ts
devices: {
  reader: {
    file: "eds/0678077312900100.eds",
    connection: "Connection1",
    inputs: {
      assembly: 11,
      address: confirmedReaderInputBase,
      // size: 496, // omitted => Param2 default; an override must satisfy 2..500
    },
    outputs: {
      assembly: 21,
      address: confirmedReaderOutputBase,
      // size: 496, // omitted => Param3 default
    },
  },
}
```

The `confirmed...Base` values must come from the configured device/project process image. Choosing a connection and importing an EDS does not assign absolute addresses. Recommended effective-size precedence: explicit override → selected connection literal or parameter default → referenced layout size if the connection size field is empty. Validate overrides against declared parameter constraints; a constant-size declaration should reject a conflicting override. Validate format/direction/instance together. If several connections match and none is selected, surface ambiguity; ConveyLinx has five meaningful alternatives.

Keep the simulation config separate from hardware commissioning config. Offline file parse success cannot imply a live B&R/ConveyLinx/Cognex connection, task association, or driver status. See [hardware monitoring research](hardware-monitoring.md).

## Assembly member offset reference

The tables below come directly from ordered EDS `(bit length, Param reference)` pairs; offsets are assembly-relative. No transport header or absolute PLC address is included. `Padding` means the EDS supplies no parameter reference; it does not name a physical signal. Packed BOOLs appear only in the Cognex tables.

### 0678077312900100.eds — Assem11

Source: [Assem11](../../examples/bottling-line/eds/0678077312900100.eds), 500-byte layout.

| Byte.bit offset | Bits | Parameter | Declared type | Name                       |
| --------------- | ---- | --------- | ------------- | -------------------------- |
| 0.0             | 1    | Param22   | BOOL          | Trigger Ready              |
| 0.1             | 1    | Param23   | BOOL          | Trigger Ack                |
| 0.2             | 1    | Param24   | BOOL          | Acquiring                  |
| 0.3             | 1    | Param25   | BOOL          | Missed Acq                 |
| 0.4             | 4    | —         | unspecified   | Padding / unspecified span |
| 1.0             | 1    | Param26   | BOOL          | Decoding                   |
| 1.1             | 1    | Param27   | BOOL          | Decode Complete            |
| 1.2             | 1    | Param28   | BOOL          | Results Buffer Overrun     |
| 1.3             | 1    | Param29   | BOOL          | Results Available          |
| 1.4             | 3    | —         | unspecified   | Padding / unspecified span |
| 1.7             | 1    | Param30   | BOOL          | General Fault              |
| 2.0             | 1    | Param31   | BOOL          | Soft Event Ack 0           |
| 2.1             | 1    | Param32   | BOOL          | Soft Event Ack 1           |
| 2.2             | 1    | Param33   | BOOL          | Soft Event Ack 2           |
| 2.3             | 1    | Param34   | BOOL          | Soft Event Ack 3           |
| 2.4             | 1    | Param35   | BOOL          | Soft Event Ack 4           |
| 2.5             | 1    | Param36   | BOOL          | Soft Event Ack 5           |
| 2.6             | 1    | Param37   | BOOL          | Soft Event Ack 6           |
| 2.7             | 1    | Param38   | BOOL          | Soft Event Ack 7           |
| 3.0             | 24   | —         | unspecified   | Padding / unspecified span |
| 6.0             | 16   | Param39   | UINT          | Trigger ID                 |
| 8.0             | 16   | Param40   | UINT          | Result ID                  |
| 10.0            | 16   | Param41   | UINT          | Result Code                |
| 12.0            | 16   | Param42   | UINT          | Result Extended            |
| 14.0            | 16   | Param43   | UINT          | Result Length              |
| 16.0            | 3872 | Param44   | BYTE          | Result Data                |

### 0678077312900100.eds — Assem21

Source: [Assem21](../../examples/bottling-line/eds/0678077312900100.eds), 500-byte layout.

| Byte.bit offset | Bits | Parameter | Declared type | Name                       |
| --------------- | ---- | --------- | ------------- | -------------------------- |
| 0.0             | 1    | Param4    | BOOL          | Trigger Enable             |
| 0.1             | 1    | Param5    | BOOL          | Trigger                    |
| 0.2             | 1    | Param6    | BOOL          | Buffer Results Enable      |
| 0.3             | 1    | Param7    | BOOL          | Results Ack                |
| 0.4             | 4    | —         | unspecified   | Padding / unspecified span |
| 1.0             | 1    | Param9    | BOOL          | Soft Event 0               |
| 1.1             | 1    | Param10   | BOOL          | Soft Event 1               |
| 1.2             | 1    | Param11   | BOOL          | Soft Event 2               |
| 1.3             | 1    | Param12   | BOOL          | Soft Event 3               |
| 1.4             | 1    | Param13   | BOOL          | Soft Event 4               |
| 1.5             | 1    | Param14   | BOOL          | Soft Event 5               |
| 1.6             | 1    | Param15   | BOOL          | Soft Event 6               |
| 1.7             | 1    | Param16   | BOOL          | Soft Event 7               |
| 2.0             | 16   | —         | unspecified   | Padding / unspecified span |
| 4.0             | 16   | Param17   | UINT          | User Data Option           |
| 6.0             | 16   | Param18   | UINT          | User Data Length           |
| 8.0             | 3936 | Param19   | BYTE          | User Data                  |

### ConveyLinx_V5_10_CODESYS.eds — Assem105

Source: [Assem105](../../examples/bottling-line/eds/ConveyLinx_V5_10_CODESYS.eds), 42-byte layout.

| Byte.bit offset | Bits | Parameter | Declared type | Name                   |
| --------------- | ---- | --------- | ------------- | ---------------------- |
| 0.0             | 16   | Param116  | UINT          | Zone Status Upstream   |
| 2.0             | 16   | Param196  | UINT          | Zone Status Downstream |
| 4.0             | 16   | Param106  | UINT          | Arrival Upstream       |
| 6.0             | 16   | Param107  | UINT          | Departure Upstream     |
| 8.0             | 16   | Param186  | UINT          | Arrival Downstream     |
| 10.0            | 16   | Param187  | UINT          | Departure Downstream   |
| 12.0            | 32   | Param88   | UDINT         | Diagnostic             |
| 16.0            | 32   | Param119  | UDINT         | Tracking Upstream      |
| 20.0            | 32   | Param199  | UDINT         | Tracking Downstream    |
| 24.0            | 16   | Param105  | UINT          | Release Upstream       |
| 26.0            | 16   | Param185  | UINT          | Release Downstream     |
| 28.0            | 32   | Param201  | UDINT         | Get Forward Tracking   |
| 32.0            | 32   | Param121  | UDINT         | Get Backward Tracking  |
| 36.0            | 16   | Param35   | UINT          | All Sensors            |
| 38.0            | 16   | Param514  | UINT          | Reserved               |
| 40.0            | 16   | Param19   | UINT          | ConveyStop Status      |

### ConveyLinx_V5_10_CODESYS.eds — Assem106

Source: [Assem106](../../examples/bottling-line/eds/ConveyLinx_V5_10_CODESYS.eds), 50-byte layout.

| Byte.bit offset | Bits | Parameter | Declared type | Name                        |
| --------------- | ---- | --------- | ------------- | --------------------------- |
| 0.0             | 32   | Param132  | UDINT         | Set Tracking Upstream       |
| 4.0             | 32   | Param212  | UDINT         | Set Tracking Downstream     |
| 8.0             | 16   | Param104  | UINT          | Accumulate Upstream         |
| 10.0            | 16   | Param184  | UINT          | Accumulate Downstream       |
| 12.0            | 16   | Param40   | UINT          | Speed Left                  |
| 14.0            | 16   | Param64   | UINT          | Speed Right                 |
| 16.0            | 16   | Param105  | UINT          | Release Upstream            |
| 18.0            | 16   | Param185  | UINT          | Release Downstream          |
| 20.0            | 16   | Param134  | UINT          | Induct Upstream Status      |
| 22.0            | 16   | Param232  | UINT          | Discharge Downstream        |
| 24.0            | 32   | Param139  | UDINT         | Induct Tracking Forward     |
| 28.0            | 32   | Param237  | UDINT         | Induct Tracking Backward    |
| 32.0            | 16   | Param22   | UINT          | Clear Motor Error (bit 0)   |
| 34.0            | 16   | Param63   | UINT          | Control Port Outputs        |
| 36.0            | 16   | Param514  | UINT          | Reserved                    |
| 38.0            | 16   | Param20   | UINT          | ConveyStop Control          |
| 40.0            | 16   | Param109  | UINT          | Jam Clear Upstream          |
| 42.0            | 16   | Param189  | UINT          | Jam Clear Downstream        |
| 44.0            | 16   | Param365  | UINT          | Conveyor Control Upstream   |
| 46.0            | 16   | Param375  | UINT          | Conveyor Control Downstream |
| 48.0            | 16   | Param387  | UINT          | Merger mode                 |

### ConveyLinx_V5_10_CODESYS.eds — Assem107

Source: [Assem107](../../examples/bottling-line/eds/ConveyLinx_V5_10_CODESYS.eds), 46-byte layout.

| Byte.bit offset | Bits | Parameter | Declared type | Name                      |
| --------------- | ---- | --------- | ------------- | ------------------------- |
| 0.0             | 16   | Param19   | UINT          | ConveyStop Status         |
| 2.0             | 16   | Param35   | UINT          | All Sensors               |
| 4.0             | 16   | Param36   | UINT          | Sensor Detect             |
| 6.0             | 16   | Param24   | UINT          | Voltage                   |
| 8.0             | 16   | Param55   | UINT          | Left Motor Current        |
| 10.0            | 16   | Param56   | UINT          | Left Motor Frequency      |
| 12.0            | 16   | Param57   | UINT          | Left Motor Temperature    |
| 14.0            | 16   | Param58   | UINT          | Left Motor Diagnostic     |
| 16.0            | 16   | Param79   | UINT          | Right Motor Current       |
| 18.0            | 16   | Param80   | UINT          | Right Motor Frequency     |
| 20.0            | 16   | Param81   | UINT          | Right Motor Temperature   |
| 22.0            | 16   | Param82   | UINT          | Right Motor Diagnostic    |
| 24.0            | 16   | Param60   | UINT          | Left Motor Digital IO     |
| 26.0            | 16   | Param84   | UINT          | Right Motor Digital IO    |
| 28.0            | 16   | Param134  | UINT          | Induct Upstream Status    |
| 30.0            | 16   | Param232  | UINT          | Discharge Downstream      |
| 32.0            | 32   | Param139  | UDINT         | Induct Tracking Forward   |
| 36.0            | 16   | Param514  | UINT          | Reserved                  |
| 38.0            | 16   | Param62   | UINT          | Left Motor Pulse Encoder  |
| 40.0            | 16   | Param86   | UINT          | Right Motor Pulse Encoder |
| 42.0            | 16   | Param11   | UINT          | Servo Left Status bits    |
| 44.0            | 16   | Param16   | UINT          | Servo Right Status bits   |

### ConveyLinx_V5_10_CODESYS.eds — Assem108

Source: [Assem108](../../examples/bottling-line/eds/ConveyLinx_V5_10_CODESYS.eds), 54-byte layout.

| Byte.bit offset | Bits | Parameter | Declared type | Name                             |
| --------------- | ---- | --------- | ------------- | -------------------------------- |
| 0.0             | 16   | Param20   | UINT          | ConveyStop Control               |
| 2.0             | 16   | Param60   | UINT          | Left Motor Digital IO            |
| 4.0             | 16   | Param84   | UINT          | Right Motor Digital IO           |
| 6.0             | 16   | Param37   | UINT          | Sensor Digital Output            |
| 8.0             | 16   | Param260  | UINT          | Left Motor Control               |
| 10.0            | 16   | Param261  | UINT          | Left Motor Brake Method          |
| 12.0            | 16   | Param262  | UINT          | Left Motor Speed Control Method  |
| 14.0            | 16   | Param270  | UINT          | Right Motor Control              |
| 16.0            | 16   | Param271  | UINT          | Right Motor Brake Method         |
| 18.0            | 16   | Param272  | UINT          | Right Motor Speed Control Method |
| 20.0            | 16   | Param40   | UINT          | Speed Left                       |
| 22.0            | 16   | Param64   | UINT          | Speed Right                      |
| 24.0            | 16   | Param43   | UINT          | Left Motor Acceleration          |
| 26.0            | 16   | Param44   | UINT          | Left Motor Deceleration          |
| 28.0            | 16   | Param67   | UINT          | Right Motor Acceleration         |
| 30.0            | 16   | Param68   | UINT          | Right Motor Deceleration         |
| 32.0            | 16   | Param22   | UINT          | Clear Motor Error (bit 0)        |
| 34.0            | 16   | Param196  | UINT          | Zone Status Downstream           |
| 36.0            | 16   | Param116  | UINT          | Zone Status Upstream             |
| 38.0            | 16   | Param34   | UINT          | Sensor Input Mask                |
| 40.0            | 32   | Param201  | UDINT         | Get Forward Tracking             |
| 44.0            | 16   | Param514  | UINT          | Reserved                         |
| 46.0            | 16   | Param8    | UINT          | Servo Left Pulses                |
| 48.0            | 16   | Param9    | UINT          | Servo Left Commands              |
| 50.0            | 16   | Param13   | UINT          | Servo Right Pulses               |
| 52.0            | 16   | Param14   | UINT          | Servo Right Commands             |

### ConveyLogix WORD arrays and reset-protected alternatives

[Assem121](../../examples/bottling-line/eds/ConveyLinx_V5_10_CODESYS.eds) contains Input[n], n=0..15, Param(600+n), WORD16 at byte 2*n. [Assem122](../../examples/bottling-line/eds/ConveyLinx_V5_10_CODESYS.eds) contains Output[n], n=0..15, Param(620+n), WORD16 at byte 2*n. Both total 32 bytes.

Reset-protected layouts match the corresponding base offsets/types, replacing only the listed reserved parameter with Reset Counter (UINT16):

| Reset assembly                                                            | Base assembly | Changed byte offset | Base parameter | Reset parameter |
| ------------------------------------------------------------------------- | ------------- | ------------------- | -------------- | --------------- |
| [Assem305](../../examples/bottling-line/eds/ConveyLinx_V5_10_CODESYS.eds) | Assem105      | 38                  | Param514       | Param515        |
| [Assem306](../../examples/bottling-line/eds/ConveyLinx_V5_10_CODESYS.eds) | Assem106      | 36                  | Param514       | Param515        |
| [Assem307](../../examples/bottling-line/eds/ConveyLinx_V5_10_CODESYS.eds) | Assem107      | 36                  | Param514       | Param515        |
| [Assem308](../../examples/bottling-line/eds/ConveyLinx_V5_10_CODESYS.eds) | Assem108      | 44                  | Param514       | Param515        |

### EthernetIP_CPU1_IF1__ST1.eds — Assem1

Source: [Assem1](../../examples/bottling-line/eds/EthernetIP_CPU1_IF1__ST1.eds), 16-byte layout.

| Byte.bit offset | Bits | Parameter | Declared type | Name                       |
| --------------- | ---- | --------- | ------------- | -------------------------- |
| 0.0             | 128  | —         | unspecified   | Padding / unspecified span |

### EthernetIP_CPU1_IF1__ST1.eds — Assem2

Source: [Assem2](../../examples/bottling-line/eds/EthernetIP_CPU1_IF1__ST1.eds), 28-byte layout.

| Byte.bit offset | Bits | Parameter | Declared type | Name                       |
| --------------- | ---- | --------- | ------------- | -------------------------- |
| 0.0             | 224  | —         | unspecified   | Padding / unspecified span |
