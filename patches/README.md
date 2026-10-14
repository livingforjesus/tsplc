# Dependency patches

`node-opcua-hostname@2.184.0.patch` routes a synchronous `dns.lookupService`
validation error through its callback, allowing the existing hostname fallback
to run. A scoped IPv6 address returned by the host resolver exposed this during
OPC UA initialization. Both shipped JavaScript and TypeScript source are patched;
Bun applies the patch on install, and the extension bundles that JavaScript.

The regression in `packages/vscode-extension/tests/hostname.test.ts` runs real
library initialization and the extension build's generated CJS in isolated
processes, with the actual `lookupService` validation unchanged. Review and
remove this patch when upgrading to an upstream version with the same error
boundary.
