import { afterEach, expect, test } from "bun:test";
import { execFile } from "node:child_process";
import { copyFile, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);
const temporary: string[] = [];
const require = createRequire(import.meta.url);
const clientRequire = createRequire(require.resolve("node-opcua-client"));
const hostnameModule = clientRequire.resolve("node-opcua-hostname");
const hostnamePackage = dirname(clientRequire.resolve("node-opcua-hostname/package.json"));

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function initializeHostname(root: string, module: string) {
  const script = join(root, "initialize.mjs");
  await writeFile(
    script,
    `import assert from "node:assert/strict";
import dns from "node:dns";
import os from "node:os";

// Only the resolver result is controlled, inside this process. The real
// lookupService must reject the scoped address exactly as it did on the host.
const address = "fe80::80c:4e89:65fc:b825%14";
assert.throws(() => dns.lookupService(address, 0, () => {}), {
  code: "ERR_INVALID_ARG_VALUE",
});
let lookups = 0;
os.hostname = () => "vplc-hostname-fixture";
dns.lookup = (name, options, callback) => {
  assert.equal(name, os.hostname());
  lookups++;
  setImmediate(() => callback(null, address, 6));
};
const library = await import(process.argv[2]);
// The package starts prepareFQDN during import. Let its async callback settle;
// no unhandled-error listener or explicit second initialization hides failure.
await new Promise(resolve => setImmediate(resolve));
assert.equal(library.getFullyQualifiedDomainName(), os.hostname());
assert.equal(lookups, 1);
console.log(JSON.stringify({ hostname: library.getFullyQualifiedDomainName(), lookups }));
`,
  );
  return execute(process.execPath, [script, module], { timeout: 5000 });
}

test.skipIf(process.platform === "win32")(
  "OPC UA import falls back cleanly when lookupService rejects a scoped IPv6 address",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "vplc-hostname-"));
    temporary.push(root);
    const result = await initializeHostname(root, hostnameModule);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({ hostname: "vplc-hostname-fixture", lookups: 1 });
  },
);

test.skipIf(process.platform === "win32")(
  "the extension build bundles the hostname fallback patch and retains its license",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "vplc-hostname-bundle-"));
    temporary.push(root);
    await Promise.all(
      ["scripts", "src/server", "node_modules"].map((path) =>
        mkdir(join(root, path), { recursive: true }),
      ),
    );
    await Promise.all([
      copyFile(join(import.meta.dir, "../scripts/build.ts"), join(root, "scripts/build.ts")),
      symlink(dirname(require.resolve("esbuild/package.json")), join(root, "node_modules/esbuild")),
      symlink(hostnamePackage, join(root, "node_modules/node-opcua-hostname")),
      writeFile(
        join(root, "src/extension.ts"),
        'export { getFullyQualifiedDomainName } from "node-opcua-hostname";',
      ),
      writeFile(join(root, "src/server/main.ts"), 'console.log("server fixture");'),
    ]);
    await execute(process.execPath, ["scripts/build.ts"], { cwd: root, timeout: 5000 });
    const result = await initializeHostname(root, join(root, "dist/extension.cjs"));
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({ hostname: "vplc-hostname-fixture", lookups: 1 });
    expect(await Bun.file(join(root, "THIRD_PARTY_NOTICES.md")).text()).toContain(
      "## node-opcua-hostname",
    );
  },
);
