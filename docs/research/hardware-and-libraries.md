# CODESYS libraries and EtherNet/IP metadata

Verified 2026-10-13, using official CODESYS documentation, ODVA publications, first-party source code, and read-only HTTP GET probes. No controller state was changed. Examples described as proposed schemas are design recommendations, not existing CODESYS APIs.

## Public library archive: a workable acquisition protocol

The archive serves plain text, CRLF-delimited `index` resources. Its hierarchy is **company → exact library title → exact version → exact artifact filename**. GET probes returned HTTP 200 for every level below; do not interpret `index` as HTML or JSON. These are observed endpoints, not a documented promise of an enduring public API.

| Resource                                                                                                | Observed response                                                                                         |
| ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| [Root index](https://store-archive.codesys.com/CODESYSLibs/index)                                       | Companies, including `System`, `CODESYS`, `3S - Smart Software Solutions GmbH`, `CAA Technical Workgroup` |
| [System index](https://store-archive.codesys.com/CODESYSLibs/System/index)                              | Library titles, including `Standard`, `Util`, `SysMem`                                                    |
| [Standard index](https://store-archive.codesys.com/CODESYSLibs/System/Standard/index)                   | Four-component version lines, including `3.5.18.0`, `3.5.22.0`                                            |
| [Standard 3.5.22.0 index](https://store-archive.codesys.com/CODESYSLibs/System/Standard/3.5.22.0/index) | One line: `Standard.compiled-library-v3`                                                                  |
| [Standard 3.0.0.0 index](https://store-archive.codesys.com/CODESYSLibs/System/Standard/3.0.0.0/index)   | One line: `standard.compiled-library`                                                                     |
| [Util 3.5.9.0 index](https://store-archive.codesys.com/CODESYSLibs/System/Util/3.5.9.0/index)           | One line: `Util.compiled-library-ge33`                                                                    |

Preserve spelling/case, strip only line endings, and URL-encode each path segment separately. `/System/standard/index` returned 404. A version directory GET returned 403 while its `/index` returned 200. The version index is not sorted numerically (`3.5.2.0` follows `3.5.18.0`); an exact pinned request should perform membership lookup, not choose a lexicographic maximum. An absent Standard version `3.5.22.1` returned 404. [Exact Standard version listing](https://store-archive.codesys.com/CODESYSLibs/System/Standard/index)

Download filenames **from the final index**. Actual payload probes:

| Artifact                                                                                                                 | HTTP | Bytes   | SHA-256 calculated from received bytes                             |
| ------------------------------------------------------------------------------------------------------------------------ | ---- | ------- | ------------------------------------------------------------------ |
| [Standard 3.5.22.0](https://store-archive.codesys.com/CODESYSLibs/System/Standard/3.5.22.0/Standard.compiled-library-v3) | 200  | 239072  | `a68412c2fac752f906faf716fef3301a8e4f2fda9a9009bca484081f77e183e6` |
| [Util 3.5.22.0](https://store-archive.codesys.com/CODESYSLibs/System/Util/3.5.22.0/Util.compiled-library-v3)             | 200  | 5048816 | `bbeb3679e14b450a9f2b97d8a51c709bf36b4efc1f241e3d9fa369433cf3ddd4` |

`Standard.library` and `Standard.compiled-library` at version `3.5.22.0` both returned 404. No `manifest.json` or `Standard.compiled-library-v3.sha256` was found at that version (both 404). This does not prove that every archive subtree lacks extra files; it means the filename indexes provide no authoritative hash. A separate plaintext dependencies resource is documented below. HTTP ETag was `"3a5e0-64d6f2f469d5b"`, not a SHA-256. Keep a project lockfile with an independently calculated content hash; distinguish first-fetch pinning from a publisher-signed manifest.

tsPLC uses [System/index](https://store-archive.codesys.com/CODESYSLibs/System/index) as the registry. Resolve configured `libraryName:version` entries within that company, preserving exact title/version membership. Title alone is not globally unique: `IoDrvEtherNetIP` also occurs under both [old company](https://store-archive.codesys.com/CODESYSLibs/3S%20-%20Smart%20Software%20Solutions%20GmbH/IoDrvEtherNetIP/index) and [CODESYS](https://store-archive.codesys.com/CODESYSLibs/CODESYS/IoDrvEtherNetIP/index). Do not silently expand a System lookup into a different vendor registry.

Proposed portable lock entry:

```json
{
  "request": "Standard:3.5.22.0",
  "company": "System",
  "title": "Standard",
  "version": "3.5.22.0",
  "filename": "Standard.compiled-library-v3",
  "url": "https://store-archive.codesys.com/CODESYSLibs/System/Standard/3.5.22.0/Standard.compiled-library-v3",
  "bytes": 239072,
  "sha256": "a68412c2fac752f906faf716fef3301a8e4f2fda9a9009bca484081f77e183e6"
}
```

Recommended resolver: validate a nonempty title and four decimal version components; verify actual System/title/version membership; reject missing identities; read the filename index; select the declared supported artifact; download to a temporary path; hash/verify bytes before moving into cache; preserve the original extension; let CODESYS validate the embedded identity and supported format. Reject path separators/traversal in index segments. Cache the catalog rather than crawling it on every build.

## Payload formats and the supported original installation API

`.library` contains implementation source. `.compiled-library` and `.compiled-library-v3` protect POU source; the current archive Standard payload is the latter. Since SP15, certificate-based compiled libraries use `-v3`. A compiled library can be installed and referenced using the same CODESYS workflow as a source library. Downloadability does not establish licensing rights or compatibility with a particular installed compiler. [Library-development information](https://content.helpme-codesys.com/en/CODESYS%20Development%20System/_cds_library_development_information.html), [Save as compiled library](https://content.helpme-codesys.com/en/CODESYS%20Development%20System/_cds_cmd_save_project_as_compiled_library.html)

Inside the **original CODESYS scripting engine**, `librarymanager.install_library(filepath, repository=None, overwrite=False) → ManagedLib` installs an artifact. `get_all_libraries(exclude_shadowed_libs=True)` and `find_library(display_name)` inspect installed candidates. `ManagedLib` provides exact identity, namespace and `dependencies: tuple[str]`; the documentation does not specify that property's string grammar. `application.get_library_manager().add_library(managed)` adds the project reference. [ScriptLibManObject reference](https://content.helpme-codesys.com/en/ScriptingEngine/ScriptLibManObject.html)

Illustrative original-engine sequence (not executed here):

```python
# local_path contains the already hash-verified, unchanged artifact.
managed = librarymanager.install_library(local_path, overwrite=False)
if managed.title != expected_title or managed.company != expected_company:
    raise RuntimeError("Downloaded library identity mismatch")
if str(managed.version) != expected_version:
    raise RuntimeError("Downloaded library version mismatch")
application.get_library_manager().add_library(managed)
```

Inspect project `.references` and each reference's `get_dependencies()` for the graph, with cycle detection. Managed references expose `.managed_library`; placeholders expose `placeholder_name`, `default_resolution`, `effective_resolution`, redirection and resolver information. Preserve the original resolver's results, then lock exact downloaded identities/hashes. Check installed exact identities before reinstalling. A top-level download does not establish dependency closure. [Reference/placeholder API](https://content.helpme-codesys.com/en/ScriptingEngine/ScriptLibManObject.html#ScriptLibManObject.ScriptLibraryReference.get_dependencies)

### Replacing a configured reference and setting its namespace

Verified current documented members:

| Member                                | Contract                                                              |
| ------------------------------------- | --------------------------------------------------------------------- |
| `lm.get_libraries(recursive=False)`   | `list[str]`, names rather than editable reference objects             |
| `lm.references`                       | `ScriptLibraryReferences`, a list of `ScriptLibraryReference` objects |
| `ref.name`                            | Getter; managed `Name, Version (Company)`, placeholder `#Name`        |
| `ref.managed_library`                 | Getter for `ManagedLib` when `ref.is_managed`                         |
| `ref.namespace`                       | Getter/setter; assign the namespace on the reference                  |
| `lm.remove_library(name)`             | Takes a string                                                        |
| `lm.add_library(library: ManagedLib)` | Adds a reference; documented since 3.5.5.0                            |

The documentation specifies no reference-version setter, `add_library` return value or duplicate/replacement behavior. Do not assume adding another version replaces the existing reference. [Official member signatures](https://content.helpme-codesys.com/en/ScriptingEngine/ScriptLibManObject.html#ScriptLibManObject.ScriptLibManObject)

Recommended sequence for an explicitly managed pin: validate installed `ManagedLib` identity; inspect matching title/company references; keep an exact match, otherwise capture namespace/settings and call `remove_library(old_ref.name)` then `add_library(managed)`. Re-read `.references`, assert exactly one expected identity and assign `.namespace` there. Validate removal/replacement in the Docker profile; this research did not execute it. An existing `#Standard` remains a placeholder: installing a payload must not implicitly rewrite its default resolution/redirection. Preserve resolver behavior.

## Dependency sidecars and offline payload metadata

The archive also serves **`{company}/{title}/{version}/dependencies`**, without a suffix or trailing `/index`. This is CRLF-delimited text, separate from the artifact filename index. The following GET probes all returned 200:

| Resource                                                                                                                                          | Observed declarations                   |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| [Standard 3.5.22.0 dependencies](https://store-archive.codesys.com/CODESYSLibs/System/Standard/3.5.22.0/dependencies)                             | Empty, 0 bytes                          |
| [Util 3.5.22.0 dependencies](https://store-archive.codesys.com/CODESYSLibs/System/Util/3.5.22.0/dependencies)                                     | Five lines, 102 bytes; reproduced below |
| [Util 3.5.9.0 dependencies](https://store-archive.codesys.com/CODESYSLibs/System/Util/3.5.9.0/dependencies)                                       | `#Standard`, `#SysMem`                  |
| [SysMem 3.5.17.0 dependencies](https://store-archive.codesys.com/CODESYSLibs/System/SysMem/3.5.17.0/dependencies)                                 | `SysTypes2 Interfaces, * (System)`      |
| [SysTypes2 Interfaces 3.5.17.0 dependencies](https://store-archive.codesys.com/CODESYSLibs/System/SysTypes2%20Interfaces/3.5.17.0/dependencies)   | Empty                                   |
| [CmpErrors2 Interfaces 3.5.22.0 dependencies](https://store-archive.codesys.com/CODESYSLibs/System/CmpErrors2%20Interfaces/3.5.22.0/dependencies) | Empty                                   |

Exact Util 3.5.22.0 body:

```text
#Standard
#SysMem
SysTypes2 Interfaces, * (System)
#SysTimeRtc
CmpErrors2 Interfaces, * (System)
```

Parse `#Name` as a **placeholder token**. Parse `Name, Version (Company)` as a library identity/constraint, preserving the original line. The observed `*` is a wildcard constraint; a managed reference can also contain it. An empty successful body denotes no listed declarations; a failed GET must not be treated as empty. This sidecar omits namespaces, optional flags, placeholder default identities and resolver GUIDs. Neither placeholder tokens nor wildcard identities are exact target-resolved pins.

Bounded probes for `metadata`, `metadata.json`, `dependencies.json`, `dependencies/index`, `index.json`, `manifest.json`, `.libinfo`, `.compiled-library-v3.json`, and Util `description`/`info`/`properties` returned 404. The supported observation is the plaintext `dependencies` resource; this is not a claim that every possible metadata endpoint is absent. Full responses are preserved in [library-metadata-evidence.json](library-metadata-evidence.json).

**Offline metadata extraction succeeded** for the exact Standard and Util 3.5.22.0 payloads above, using the existing format-aware `codesys-build/experimental/native/library_metadata.py::read_source_metadata`. This launched native OpenSSL checks, with no CODESYS process, Wine or vendor assembly. REA's initial `open_binary` could not open the custom payload; the reviewed existing parser provided the observation. Reader source hashes, container hashes, object evidence and declared references are recorded in the evidence file.

These payloads begin with the little-endian GUID envelope `a7d5a610-ef6b-4da0-b4de-2c309fbc0bc5`, rather than a bare ZIP header. The existing decoder validated the envelope checksum, ZIP CRCs, archive digest and embedded signatures, then read shared string/schema tables and typed Project Information/Library Manager records. It did not validate publisher certificate-chain or timestamp trust. Standard contained 104 ZIP entries / 38 paired object records; Util contained 673 / 262. No JSON dependency manifest was present in those inventories. This is an observed format, not a documented stable public parser API.

Extracted identities exactly matched `Standard / 3.5.22.0 / System` and `Util / 3.5.22.0 / System`. Standard had no Library Manager in its complete paired-object inventory. Util declared:

| Kind                     | Declared/default identity           | Namespace    | Optional |
| ------------------------ | ----------------------------------- | ------------ | -------- |
| Placeholder `Standard`   | `Standard, * (System)`              | `Standard`   | false    |
| Placeholder `SysMem`     | `SysMem, * (System)`                | `SysMem`     | false    |
| Managed                  | `SysTypes2 Interfaces, * (System)`  | `SysTypes`   | false    |
| Placeholder `SysTimeRtc` | `SysTimeRtc, * (System)`            | `SysTimeRtc` | true     |
| Managed                  | `CmpErrors2 Interfaces, * (System)` | `CmpErrors`  | false    |

Each placeholder stored resolver GUID `b303f5ce-75ff-4668-a777-7da8debb449c`; Util stored no placeholder redirections. This richer metadata establishes **declarations**, including optionality, but still does not establish the effective resolution for a configured device/application. Preserve original CODESYS resolution; do not turn every `#Name` into the highest System library with a matching title. Lock the concrete artifacts acquired for the original build. The offline reader's success on these two files does not establish support for every old/new/password-protected storage variant.

Filename lookup remains necessary for transitive acquisition: the verified SysTypes2 Interfaces 3.5.17.0 artifact is `SysTypes2_Itfs.compiled-library-v3`, and CmpErrors2 Interfaces 3.5.22.0 is `CmpErrors2_Itfs.compiled-library-v3`. Title-to-filename substitution would fail. [SysTypes2 filename index](https://store-archive.codesys.com/CODESYSLibs/System/SysTypes2%20Interfaces/3.5.17.0/index), [CmpErrors2 filename index](https://store-archive.codesys.com/CODESYSLibs/System/CmpErrors2%20Interfaces/3.5.22.0/index)

The official LibDoc export can emit Project Information and Library Manager JSON, but it invokes `CODESYS.exe --noUI --docexport=...`; it therefore requires the original engine. Its later `generate` step consumes already exported JSON. It does not supply a standalone compiled-v3 parser. [Official LibDoc workflow](https://content.helpme-codesys.com/en/LibDevSummary/docScripting.html)

Current CODESYS 4 documentation additionally describes `c4-cli library resolve`, `restore`, `list`, `explain` and a `Libraries.lock.json`. This is a separate toolchain, and was not tested against the existing CODESYS 3 Docker worker. [CODESYS 4 library CLI](https://content.helpme-codesys.com/en/CODESYS%204/_c4_commandline_c4_cli_library.html)

## EDS layout and typed I/O

EDS is an offline device description, not live connection state. Some EDS files are only stubs; rich channel names are therefore not guaranteed. ODVA identifies `Assem` and `Param` entries as ways to describe connection data. [ODVA metadata paper, 2025](https://www.odva.org/wp-content/uploads/2025/03/2025-ODVA-Conference_Majcher-Schaffner_Metadata_FINAL.pdf)

For the scanner's application: **T→O = PLC input**, produced by the adapter; **O→T = PLC output**, consumed by the adapter. Configuration assembly data is neither process input nor process output. In CODESYS, connections can be predefined from an EDS or configured generically; connection paths can be automatic, explicit, or symbolic. RPI must be compatible with the bus task. [CODESYS connection dialog](https://content.helpme-codesys.com/en/CODESYS%20EtherNetIP/_enic_dlg_target_new_connection.html)

Useful real EDS shape, confirmed in the upstream [OpENer sample EDS](https://github.com/EIPStackGroup/OpENer/blob/091e2de36f7dd640c708be6c9e40e307fe212260/data/opener_sample_app.eds):

| Entry                              | Positional fields to preserve                                                                                                                                                 |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `[Device]`                         | `VendCode`, `VendName`, `ProdType`, `ProdCode`, `MajRev`, `MinRev`, `ProdName`, `Catalog`                                                                                     |
| `[Params] ParamN`                  | Reserved; path length; path; descriptor; CIP type; data size in bytes; name; units; help; min/max/default; scaling; links; decimal precision                                  |
| `[Assembly] AssemN`                | Name; path; byte size; descriptor; reserved fields; ordered `(member bit length, member reference)` pairs                                                                     |
| `[Connection Manager] ConnectionN` | Trigger/transport; connection flags; O→T RPI/size/format; T→O RPI/size/format; proxy configuration size/format; target configuration size/format; name; help; connection path |

The sample's exclusive-owner connection points O→T at `Assem150`, T→O at `Assem100`, configuration at `Assem151`. Input/output assemblies each contain 32 repeated 8-bit members; the configuration assembly contains ten. Repetition requires stable unique generated identifiers even when several members reference the same `ParamN`. Param order alone does not determine direction. The connection's format references do.

The lexer must retain empty comma fields, multi-line entries, quoted strings, and `$` comments. Split only delimiters outside strings. Handle ordinary static `ParamN` and `AssemN` references explicitly; unresolved `Variant`, proxy/modular, indirect or parameterized definitions must produce a diagnostic rather than a guessed layout. The complete normative grammar lives in the CIP Networks Library; the public examples are useful fixtures, not proof of a complete EDS implementation. [ODVA EDS investigation](https://www.odva.org/wp-content/uploads/2022/06/2015_ODVA_Conference_Wiberg-Schiffer_Optimizing-EDSs-for-EtherNetIP-IO-Connection-Target-Devices_FINAL_PPT.pdf)

Compute assembly-relative `bitOffset` by accumulating ordered **member bit lengths**, including padding. Then `byteOffset = floor(bitOffset / 8)`, `bitWithinByte = bitOffset % 8`; do not align members by host/TypeScript object layout. CODESYS uses assembly order for I/O mapping and supports channels for padding. Its configured bit length can truncate or pad a parameter relative to its data type. [CODESYS Assemblies tab](https://content.helpme-codesys.com/en/CODESYS%20EtherNetIP/_enic_edt_target_assemblies.html)

Example proposed normalized metadata (illustrative channel names):

```ts
interface IoChannel {
  id: string; // Stable assembly/member path, not display name
  name: string;
  direction: "input" | "output" | "configuration";
  assembly: string; // EDS key, e.g. Assem100
  assemblyInstance?: number; // From resolved path, not assumed from key suffix
  parameter?: string; // ParamN
  cipType?: number;
  iecType?: string;
  bitOffset: number;
  bitLength: number;
  byteOffset: number;
  bitWithinByte: number;
  unit?: string;
  description?: string;
  padding: boolean;
  source: { file: string; sha256: string };
  mapping?: {
    devicePath: string[];
    connectorId?: number;
    parameterId?: number;
    elementPath: string[];
    variable: string;
    iecAddress?: string;
  };
}
```

CIP scalar codes `0xC1..0xCB` cover BOOL, signed and unsigned integer widths, REAL and LREAL; `0xD1..0xD4` are BYTE, WORD, DWORD and LWORD. Preserve source type and width; 64-bit integers need a lossless TypeScript representation such as `bigint`. Do not substitute generic `number` for every type. [OpENer CIP type definitions](https://github.com/EIPStackGroup/OpENer/blob/master/source/src/cip/ciptypes.h)

Keep transport headers distinct from process assembly members. A 32-bit run/idle header and sequence counters affect connection framing; adding four bytes to every EDS member offset is incorrect. [Rockwell first-party EDS manual, connection size/format sections](https://literature.rockwellautomation.com/idc/groups/literature/documents/pm/1756-pm002_-en-d.pdf)

### Public fixture and the Cognex reader

An unchanged, pinned public EDS is saved as `fixtures/opener_sample_app.eds`, with attribution in `fixtures/README.md` and the upstream adapted BSD license in `fixtures/OpENer-license.txt`. It is 17437 bytes with SHA-256 `0e0da5ddd62f571ea319dc29254be08cac5134236b389174983d80f0e370760f`. Use it for parser tests of repeated members, direction, input-only/listen-only connections and parameterized RPI. It is an OpENer sample, not a substitute device identity for B&R or Cognex. [Pinned upstream fixture](https://github.com/EIPStackGroup/OpENer/blob/091e2de36f7dd640c708be6c9e40e307fe212260/data/opener_sample_app.eds)

The example hardware includes a B&R X67BCD321.L12 bus controller and a Cognex DataMan 300 Series reader. Cognex's first-party manual supplies **assembly-relative** layout: DataMan input instance `11`, output instance `21`; 16-bit Trigger ID at input byte 6, Result ID at byte 8, result length at byte 14 and result bytes from byte 16. Output user data begins at byte 8. These are not absolute PLC addresses. [Cognex object model](https://docs.cognex.com/dmst_2532/web/EN/Industrial_Protocols_Manual/Content/Topics/PDF/DIPM/eip-object-model.htm)

For example, Cognex explicitly locates input `TriggerReady` at word 0 bit 0, input `ResultLength` at word 7, and output `Trigger` at word 0 bit 1. Preserve the actual selected connection size: not every connection transmits the maximum 500-byte assembly. These documented values can verify parser/generated-layout expectations against a DataMan EDS; they do not establish a reader's exact firmware, vendor revision or configured connection. [Cognex CompactLogix examples](https://docs.cognex.com/mx_579SR4/web/EN/Industrial_Protocols_Manual/Content/Topics/PDF/DMCAP/RockwellCompactLogixExamples.htm)

Cognex documents distributing the EDS files with the DataMan software under its `Tools/EtherNetIP/EDS` directory. This research did not retrieve a DataMan 300 EDS from a direct public artifact URL; the example's copy is described in [EDS layouts](eds-layouts.md). [Cognex industrial-protocol manual](https://support.cognex.com/docs/dmst_2530/EN/Industrial_Protocols_Manual.pdf)

## Original CODESYS descriptions and mappings

The supported scripting model provides device `device_parameters` and `connectors`; each connector has `host_parameters`. Parameters/sub-elements provide stable IDs, visible names, descriptions, units, `bit_size`, channel direction, `iec_type`/`param_type`, sub-element traversal and `io_mapping`. For mapped channels, `io_mapping.variable` names the IEC expression; `manual_iec_address` also returns the automatically assigned address when `automatic_iec_address=True`. EDS assembly-relative offsets must remain distinct from compiled `%I/%Q` addresses. [ScriptDeviceParameters](https://content.helpme-codesys.com/en/ScriptingEngine/ScriptDeviceParameters.html), [ScriptDeviceObject](https://content.helpme-codesys.com/en/ScriptingEngine/ScriptDeviceObject.html)

Generate symbolic mappings to explicit existing IEC variables (`GVL_IO.Device.InputChannel`) rather than inventing global `%IX` addresses. CODESYS assigns its process image for the actual configured device tree. It also exposes `export_io_mappings_as_csv(absolute_path)` and matching import. Verify generated declarations/layout against the original engine's imported EDS/device model before treating a vendor device as validated. The generic device-description importer supports converter plugins, but its published list does **not** name a dedicated EtherNet/IP EDS converter; installed plugin support needs a real integration probe. [Device repository scripting API](https://content.helpme-codesys.com/en/ScriptingEngine/ScriptDeviceRepository.html)

## Monitoring equivalent to the CODESYS views

| View                   | Data and behavior                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I/O mapping            | Device/connection/channel hierarchy, symbolic mapping, direction, IEC type, resolved address, assembly offset, bit width, unit, help and sampled value. Values belong to an online session and carry sample time/error/availability. [I/O Mapping tab](https://content.helpme-codesys.com/en/CODESYS%20Development%20System/_cds_edt_device_io_mapping.html)                                                                                                         |
| Connection status      | Read existing remote device FB outputs `eState`, `xDiagnosticAvailable`, `sDiagString`; `AdapterState.RUNNING` means its connections are established. Do not create driver FB instances manually. [RemoteAdapter](https://content.helpme-codesys.com/en/libs/IoDrvEtherNetIP/4.9.0.0/IoDrvEtherNetIP/Function-Blocks/RemoteAdapter.html), [AdapterState](https://content.helpme-codesys.com/en/libs/IoDrvEtherNetIP/4.9.0.0/IoDrvEtherNetIP/Enums/AdapterState.html) |
| Device tree/status/log | Distinguish operating, unavailable, unconfigured/connection error, current diagnostics and cleared errors; display filtered driver log entries separately from process values. [Scanner diagnosis](https://content.helpme-codesys.com/en/CODESYS%20EtherNetIP/_enic_scanner_diagnosis.html)                                                                                                                                                                          |
| Task configuration     | Task name/type, interval, priority, watchdog and ordered PROGRAM calls. [Task object](https://content.helpme-codesys.com/en/CODESYS%20Development%20System/_cds_f_reference_task.html)                                                                                                                                                                                                                                                                               |
| Task deployment        | Channel-to-task read/write usage, priority and selected bus task; data becomes available after code generation. Treat multiple output writers as a conflict. [Task Deployment tab](https://content.helpme-codesys.com/en/CODESYS%20Development%20System/_cds_edt_device_task_deployment.html)                                                                                                                                                                        |
| Task monitoring        | Status, IEC cycle count, cycle count, last/average/min/max cycle times, jitter and core where supported. Zero may mean unsupported counter. Static task config does not provide these live measurements. [Monitoring tab](https://content.helpme-codesys.com/en/CODESYS%20Development%20System/_cds_obj_task_config_monitor.html)                                                                                                                                    |

The original channel API supports `read_online_value(nTimeOut=1000)` when `can_access_online` is true. Alternatively read the mapped IEC symbols using the established online reader. Treat the API result as sampled text until parsed by the known IEC type. Never conflate offline `.value` configuration with an online read. [Online parameter read API](https://content.helpme-codesys.com/en/ScriptingEngine/ScriptDeviceParameters.html#ScriptDeviceParameters.ScriptValueDataElement.read_online_value)

Unreferenced I/O may not be updated. Display that fact instead of presenting an old value as current. Enabling `OnlyIfUnused` updates unused channels in the bus task; `AlwaysInBusCycle` overrides normal task consistency and is unsuitable as an automatic monitor setting. Monitoring should preserve build/runtime configuration and use read calls; reset, acknowledge, force, write, start/stop and configuration changes are separate control actions. [Fieldbus drivers and update modes](https://content.helpme-codesys.com/en/CODESYS%20Development%20System/_cds_device_fieldbus_devices_io_driver.html), [ScriptDriverInfo](https://content.helpme-codesys.com/en/ScriptingEngine/ScriptDriverInfo.html)

## Remaining integration limits

- At the time of this research no vendor device EDS was available, so no vendor-specific assembly was validated against hardware.
- Archive GET and local hashes are proven; original-engine installation of the downloaded Standard/Util artifacts was not executed in this research task.
- A parsed EDS can generate declarations/metadata offline. It cannot establish an EtherNet/IP connection without a compatible scanner driver, runtime license/configuration, configured device instance, network and physical adapter.
- Task monitoring and task-deployment extraction need an original-engine/runtime implementation probe; the referenced IDE documentation does not establish that the current build worker already supplies those measurements.
- The device XSD URLs embedded in the supplied runtime `.devdesc.xml` returned HTTP 429 when probed. This research relies on the documented original scripting model rather than claiming complete raw CODESYS device XML support.

## Bun native lint/format discrepancy

Read-only local probe: `bun --version` reported `1.4.3`; `bun --help` reported revision `1.4.3+c6da4a4d3` and listed native `check`, but no native `lint` or `format`. The official latest-release API returned `bun-v1.4.3`, released 2026-10-10. Its blog announces `bun check`; that operation checks types and does not emit JS or declarations. [Bun 1.4.3 release](https://github.com/oven-sh/bun/releases/tag/bun-v1.4.3), [Release blog](https://bun.com/blog/bun-v1.4.3)

The exact release source at `c6da4a4d3010e5553438c60f6bd76d981976867c` handles `check` around line 1050 but contains no `lint`/`format` root dispatch. Its recursively enumerated Git tree also lacks `src/lint`, `src/format` and the two corresponding runtime documentation files. [Stable command dispatcher](https://github.com/oven-sh/bun/blob/c6da4a4d3010e5553438c60f6bd76d981976867c/src/runtime/cli/mod.rs#L1050)

By contrast, main snapshot `7583003d82122bbfa5e06dcd688d8c2d1533fa22` has explicit `lint` and `format` dispatch at lines 1066–1076, `src/runtime/cli/lint_command.rs`, `format_command.rs`, both engines and both documentation pages. Thus the installed stable binary and published documentation differ because the source/documentation branch is ahead of stable; an `.oxlintrc` cannot add commands that are absent from the binary. [Main command dispatcher](https://github.com/oven-sh/bun/blob/7583003d82122bbfa5e06dcd688d8c2d1533fa22/src/runtime/cli/mod.rs#L1066)

Current official docs describe native `bun lint` and `bun format`, including configuration compatibility. The lint docs specifically warn that `"lint": "bun lint"` can recurse forever on a version without the native linter. Do not install such scripts against stable 1.4.3. To meet a strict native-only tooling requirement, use a verified build that contains these dispatchers, pinned by revision, and probe it outside any project script before recording it as usable. Otherwise, a clearly documented external-tool fallback is needed until a release includes the feature. No Bun installation or system upgrade was performed. [Bun lint docs](https://bun.com/docs/runtime/lint), [Bun format docs](https://bun.com/docs/runtime/format)

The `canary` GitHub release is a moving asset page; its Git tag probe resolved to an older commit and a source-file GET returned 404, so this research does not claim that an untested canary binary supplies the commands.
