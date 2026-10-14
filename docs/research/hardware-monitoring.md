# Device-description metadata and read-only hardware monitoring

Verified 2026-10-13 from CODESYS documentation, CODESYS-maintained driver examples, OPC Foundation specifications, published npm metadata and version-pinned node-opcua source. No controller was contacted, no REA operation was performed, and no implementation was changed. Code below illustrates verified API shapes; it is not a controller integration test.

## Practical `.devdesc.xml` channel discovery

CODESYS documents a parameter for each I/O, with `ParameterId`, a type such as `std:DWORD`, an `Attributes` child whose `channel` is `input`/`output`, and a name. IDs identify parameters; they are not process-image addresses. Its example's 1000/2000 input/output numbering is a recommendation for that driver, not a universal direction rule. [CODESYS: Linking Your Own I/Os](https://content.helpme-codesys.com/en/CODESYS%20Control/_rtsl_extension_connecting_user_ios.html)

Adapted fragment, within a connector's `HostParameterSet`:

```xml
<Parameter ParameterId="1000" type="std:DWORD">
  <Attributes channel="input"/>
  <Default>0</Default>
  <Name name="local:Counter">Counter</Name>
</Parameter>
```

Useful paths and fields:

| Location                                                      | Meaning for the importer                                                                                                            |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `DeviceDescription`                                           | Parse the namespace URI `http://www.3s-software.com/schemas/DeviceDescription-1.0.xsd`; do not rely on an XML prefix spelling       |
| `Device/DeviceIdentification/{Type,Id,Version}`               | Preserve the device identity, including the original textual ID                                                                     |
| `Device/Connector`                                            | Preserve `connectorId` when supplied, `moduleType`, `interface`, `role` and source order; `role` is bus topology, not I/O direction |
| `Connector/HostParameterSet//Parameter`                       | Read `ParameterId`, `type`, `Attributes@channel`, `Name`, `Description`, `Default`; `ParameterSection` can wrap parameters          |
| `Device/DeviceParameterSet`                                   | Device-level parameters also exist; do not assume every parameter is attached to a connector                                        |
| `Types@namespace`                                             | Logical CODESYS type namespace: `std:BYTE` is built-in, `local:SomeType` refers to a declared local type                            |
| `StructType/Component`                                        | Retain ordered `identifier`, `type`, `VisibleName`, defaults and nested element paths                                               |
| `BitfieldType@basetype`                                       | Bit members belong to the specified underlying storage type; do not allocate one byte per BOOL component                            |
| `ArrayType@basetype/FirstDimension/{LowerBorder,UpperBorder}` | Preserve bounds and expand supported arrays; do not assume zero-based indexing                                                      |
| `Strings@namespace/Language/String`                           | Resolve localized label references while retaining identifiers independently of display names                                       |

CODESYS's maintained driver documentation supplies these structures, bitfield and array examples. `channel="none"` describes configuration rather than a mappable I/O channel. `download`, `functional`, `offlineaccess` and `onlineaccess` describe configuration/driver processing and permissions. An online-readable declaration is not a sampled online value. [CODESYS Forge I/O driver documentation](https://forge.codesys.com/drv/io-drivers/doc/Generic/)

Use `(source hash, device identity, connector locator, ParameterId, element path)` as the stable channel key. A connector ID is optional in real files; retain its source position rather than manufacturing an ID. Keep unknown/custom types as diagnostics until supported. XML source order alone does not establish compiler alignment, generated `%I/%Q` addresses, or fieldbus connection offsets.

The original scripting model supplies connector `host_parameters`, nested `has_sub_elements`, `bit_size`, `channel_type`, `iec_type`, `param_type` and `io_mapping`. It can supply the configured mapping and assigned IEC address after import/configuration. Use this model to validate raw XML extraction. `read_online_value(nTimeOut=1000)` requires `can_access_online`; offline `.value` is configuration. [ScriptDeviceParameters](https://content.helpme-codesys.com/en/ScriptingEngine/ScriptDeviceParameters.html)

Local observation: `packages/build/docker/install/device/codesyscontrol.devdesc.xml` has SHA-256 `3bc0b83e22bdbc94fa50f868b35218fb269e0a382e4a8fb50df648debcd6e990`, identity Type `4096`, ID `0000 1008`, version `4.22.0.0`, and two parent connectors. It contains **zero `Parameter` elements and zero I/O channels**. This runtime description is useful for identity/namespace tests, but cannot validate channel generation. The prior research's XSD GET returned 429; these findings do not claim full schema validation.

## Offline descriptions, runtime values and device state

Keep three independent records:

```ts
interface ChannelDescription {
  key: string;
  direction: "input" | "output" | "configuration";
  sourceType: string;
  elementPath: string[];
  bitLength?: number;
  mappedSymbol?: string;
  iecAddress?: string; // only when supplied by configured CODESYS mapping
}

interface RuntimeSample {
  nodeId: string; // discovered/configured OPC UA binding, not ParameterId
  value: unknown;
  statusCode: string;
  sourceTimestamp?: string;
  serverTimestamp?: string;
  receivedAt: string;
  connectionGeneration: number;
}
```

EDS/XML metadata establishes supported identities, layouts and declarations. It does not establish that the adapter is present, configured or exchanging I/O. For EtherNet/IP, read the existing driver's `RemoteAdapter` outputs `eState`, `xDiagnosticAvailable`, `sDiagString`. Do not instantiate that driver FB manually. Reset/acknowledge inputs are control operations. [RemoteAdapter outputs](https://content.helpme-codesys.com/en/libs/IoDrvEtherNetIP/4.9.0.0/IoDrvEtherNetIP/Function-Blocks/RemoteAdapter.html)

The IDE's online device tree distinguishes operation, unavailable device, unconfigured/incorrect connection, pending diagnostics and cleared errors. OPC UA connectivity alone proves none of these driver states. If no corresponding runtime symbol is exposed, display device state as **unknown**; do not derive it from a successful scalar read or an EDS file. [CODESYS EtherNet/IP diagnosis](https://content.helpme-codesys.com/en/CODESYS%20EtherNetIP/_enic_scanner_diagnosis.html)

OPC UA sees published symbols. Configure mapped I/O and diagnostic outputs in a read-only symbol set; neither an XML parameter ID nor an IEC address automatically determines a UA NodeId. CODESYS recommends IEC Symbol Set Configuration for OPC UA starting with SP18. A discovered node supplies the runtime binding. [CODESYS symbol publication/access rights](https://content.helpme-codesys.com/en/CODESYS%20Communication/_cds_obj_symbolconfiguration.html)

Retain the entire DataValue quality and timestamps. Bad quality means the value is unusable; an old `sourceTimestamp` alone does not prove staleness because it may identify the last value/status change. Combine transport/subscription liveness, received time and explicit driver diagnostics. A server without detailed source status may still report Good. [OPC Foundation DataValue semantics](https://reference.opcfoundation.org/specs/OPC-10000-4/7.11)

## Node support in the VS Code extension host

Read-only registry GETs found **`node-opcua-client` 2.187.5 requires Node `>=22.13.0`**. The umbrella `node-opcua` package declares the same requirement. Both identify source revision `fa39d3fc7d0b5929378a55653c0f3eafccbef74d`. The repository README's older “20 or above” statement conflicts with the published package; the package requirement is the appropriate installation/runtime check. [Published client metadata](https://registry.npmjs.org/node-opcua-client/2.187.5), [Pinned package source](https://github.com/node-opcua/node-opcua/blob/fa39d3fc7d0b5929378a55653c0f3eafccbef74d/packages/node-opcua-client/package.json)

vPLC currently declares `engines.vscode: ^1.96.0`; that does not ensure Node 22.13.0. VS Code 1.101 moved its extension host from Node 20 to Node 22. Verify the actual `process.versions.node`, enforce the dependency's minimum before loading it, and test the chosen VS Code minimum. Build-time Bun and `@types/node` versions do not select the extension host's runtime. [VS Code 1.101 runtime change](https://code.visualstudio.com/updates/v1_101)

The existing `main` entry runs in a Node extension host. Desktop/remote hosts can run on different machines; choose the host that can reach the PLC endpoint. A browser webview should render data passed from that host. TCP client support does not follow from a webview or `browser` entry point. [VS Code extension-host configurations](https://code.visualstudio.com/api/advanced-topics/extension-host)

## Browse and subscription lifecycle

Recommended design: one owner for each active endpoint/session; browse tree children on expansion, cache by connection generation, and subscribe only to selected/visible variables. Read metadata attributes in arrays rather than issuing one request per field. Bound browse/read/monitor batches and concurrency to server limits; show operation-level failures.

Verified browse API: `session.requestedMaxReferencesPerNode`, `session.browse(description | descriptions[])`, and `session.browseNext(point | points[], releaseContinuationPoints)`. Continue pages on the same session. If the UI cancels or stops after a display cap, release the outstanding point with `browseNext(point, true)`; truncating the display must not leak server continuation resources. [Pinned browse/read signatures](https://github.com/node-opcua/node-opcua/blob/fa39d3fc7d0b5929378a55653c0f3eafccbef74d/packages/node-opcua-pseudo-session/source/basic_session_interface.ts), [OPC Foundation BrowseNext contract](https://reference.opcfoundation.org/specs/OPC-10000-4/5.9.3)

Illustrative monitoring sequence after `client.connect(endpoint)` and `client.createSession(identity)`:

```ts
import { AttributeIds, TimestampsToReturn } from "node-opcua-client";

const subscription = await session.createSubscription2({
  requestedPublishingInterval: 500,
  requestedLifetimeCount: 120,
  requestedMaxKeepAliveCount: 10,
  maxNotificationsPerPublish: 200,
  publishingEnabled: true,
});
const group = await subscription.monitorItems(
  watchedNodeIds.map((nodeId) => ({ nodeId, attributeId: AttributeIds.Value })),
  { samplingInterval: 500, queueSize: 1, discardOldest: true },
  TimestampsToReturn.Both,
);
group.on("changed", (item, dataValue, index) => {
  // Preserve quality/timestamps; coalesce view refreshes.
  recordSample(watchedNodeIds[index], dataValue);
});
```

The intervals above are proposed UI defaults, not CODESYS real-time cycle rates; inspect revised subscription/monitoring parameters. Queue size 1 suits a current-value display and discards intermediate changes; it cannot represent an event history. Groups provide `changed`, `initialized`, `err`, `terminated` and `monitoredItems`; inspect per-item errors instead of calling every node subscribed. [Pinned subscription API](https://github.com/node-opcua/node-opcua/blob/fa39d3fc7d0b5929378a55653c0f3eafccbef74d/packages/node-opcua-client/source/client_subscription.ts), [Group events](https://github.com/node-opcua/node-opcua/blob/fa39d3fc7d0b5929378a55653c0f3eafccbef74d/packages/node-opcua-client/source/client_monitored_item_group.ts)

On `connection_lost`/`start_reconnection`, mark samples disconnected/stale and pause requests. A re-established channel does not by itself prove the session is restored: the session's `session_restored` event covers session and related subscription recovery. Use a generation counter to ignore late responses from obsolete sessions, and avoid creating a second subscription while the library restores the original. [Pinned client connection events](https://github.com/node-opcua/node-opcua/blob/fa39d3fc7d0b5929378a55653c0f3eafccbef74d/packages/node-opcua-client/source/client_base.ts), [Session APIs/events](https://github.com/node-opcua/node-opcua/blob/fa39d3fc7d0b5929378a55653c0f3eafccbef74d/packages/node-opcua-client/source/client_session.ts)

Use idempotent asynchronous shutdown on explicit disconnect, endpoint replacement and extension deactivation. Remove view listeners/timers, then attempt **all three** cleanup steps even if an earlier one rejects: `await subscription.terminate()`, `await session.close(true)` (delete subscriptions), `await client.disconnect()`. Handle resources acquired before a connect/session/monitor failure. [Pinned connection/session lifecycle](https://github.com/node-opcua/node-opcua/blob/fa39d3fc7d0b5929378a55653c0f3eafccbef74d/packages/node-opcua-client/source/opcua_client.ts)

Return the shutdown Promise from exported `deactivate()`. VS Code does not await asynchronous `Disposable.dispose()` callbacks or `context.subscriptions` disposal. A fire-and-forget disposable is insufficient for orderly network shutdown. [VS Code deactivation contract](https://code.visualstudio.com/api/references/activation-events), [Disposable/subscriptions contract](https://code.visualstudio.com/api/references/vscode-api)

Read-only here means browsing/reading and managing the client's sessions/subscriptions. Monitoring must not invoke UA Write/Call, driver reset/acknowledge or PLC start/stop. Matching real DataMan/B&R descriptions, deployed symbol bindings and physical driver diagnostics remain integration work; none was verified against hardware in this research.
