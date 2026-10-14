# VS Code and live monitoring

[Documentation home](../README.md) · [Hardware guide](hardware-and-io.md)

The extension is a VSIX, separate from the Bun/npm packages. It provides ST
language support, project commands and a Hardware & IO view. PLC TypeScript also
uses VS Code's TypeScript support and the SDK declarations in your `tsconfig`.

## Install

From the checkout:

```sh
cd packages/vscode-extension
bun run build
bun run package
```

Install `packages/vscode-extension/artifacts/tsplc.vsix` using **Extensions:
Install from VSIX**. Reload the extension host/window if VS Code requests it.
Open your PLC project's folder so it can discover `tsplc.config.ts`.

## Project commands and hardware view

The tsPLC command palette provides **Generate Types**, **Check Project**,
**Build Project**, **Install Libraries** and **Refresh Hardware**. These use the
project's shared config and CLI; the editor is not a second build configuration.

The Hardware & IO view shows selected devices, connections, assemblies, channels,
logical mappings, addresses, types and expandable byte bits. It also shows the
configured tasks and driver status symbols. It reads literal config safely;
computed configs use the `.tsplc/project.json` snapshot produced by the CLI.
Run `tsplc typegen` or `tsplc build` and refresh after changing such a config.

The EDS model is offline information. A parsed descriptor does not mean a device
is connected. Live values require published symbols and a successful monitor
session; channel and driver states are displayed separately.

## Configure monitoring

Add `monitor` to the root config:

```ts
monitor: {
  endpoint: "opc.tcp://127.0.0.1:4840",
  securityMode: "SignAndEncrypt",
  securityPolicy: "Basic256Sha256",
  certificateDirectory: ".tsplc/opcua-pki",
  username: "monitor-user",
  passwordEnv: "PLC_MONITOR_PASSWORD",
},
```

This endpoint is a local example. Use the intended runtime's actual endpoint.
`SignAndEncrypt` and `Basic256Sha256` are the defaults. Omit `passwordEnv` to use
the extension's masked prompt and VS Code SecretStorage for the endpoint/user;
**Forget Monitor Password** clears that saved credential. Omit `username` for a
server that permits anonymous access. Username authentication cannot use `None`
security.

`namespaceUri` can select the namespace by URI. `symbols` adds explicitly qualified
symbols to monitor, and `devices.<name>.statusSymbols` supplies existing driver
status paths. Those symbols must actually be published by the target/template.

## Establish certificate trust

Unknown server certificates are rejected. Compare the certificate in the
configured directory's `rejected/` folder with the certificate exported from the
intended PLC, then move the verified certificate to `trusted/certs/` and reconnect.
Install/trust the client certificate from `own/certs/` in the runtime's certificate
manager as required by that target. The extension does not automatically trust
unknown servers or downgrade encryption.

Use **Connect Monitor** and **Disconnect Monitor**. The view is read-only and
shows sample quality and timestamps. Missing symbols are unavailable; retained
values become stale on connection loss. An engineering download connection does
not by itself enable an OPC UA server or publish all fields.

## Structured Text editing

The ST language server supports completion, navigation, rename, diagnostics,
semantic highlighting and split POU layouts. It indexes each configured source
root separately and respects unsaved editor buffers.

For all layouts and settings, see the [extension reference](../../packages/vscode-extension/README.md).
**CODESYS ST: Open Declaration / Implementation** navigates between source parts;
**CODESYS ST: Restart Language Server** restarts indexing.
