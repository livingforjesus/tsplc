import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { build } from "esbuild";

// Run from the directory holding the existing trusted PKI and ignored .env.
// Credentials remain in the environment; the probe only browses/reads/subscribes.
const { values } = parseArgs({
  options: {
    endpoint: { type: "string" },
    symbol: { type: "string", multiple: true },
    pki: { type: "string" },
  },
});
const endpoint = values.endpoint ?? process.env["OPCUA_ENDPOINT"];
const symbols = values.symbol;
const pki = values.pki ?? process.env["OPCUA_PKI"];
if (!endpoint || !symbols?.length || !pki)
  throw new Error("Specify --endpoint, one or more --symbol, and --pki (or OPCUA_PKI).");
if (process.env["OPCUA_USERNAME"] && process.env["OPCUA_PASSWORD"] === undefined)
  throw new Error("Set OPCUA_PASSWORD for the configured OPCUA_USERNAME.");

const bundle = resolve(import.meta.dir, "../artifacts/monitor-smoke.cjs");
// These are the same bundling options used by the shipped extension, including
// all OPC-UA dependencies. Run with Node to exercise the extension-host runtime.
await build({
  entryPoints: [resolve(import.meta.dir, "../src/monitor.ts")],
  outfile: bundle,
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  external: ["vscode"],
  sourcemap: true,
});
const probe = `
const { Monitor } = require(process.argv[1]);
const monitor = new Monitor(() => {});
(async () => {
  try {
    await monitor.connect(process.argv[2], new Set(JSON.parse(process.argv[3])), {
      certificateDirectory: process.argv[4],
      username: process.env.OPCUA_USERNAME,
      password: process.env.OPCUA_PASSWORD,
    });
    const samples = [...monitor.samples].map(([symbol, sample]) => ({
      symbol, value: sample.value, quality: sample.quality, good: sample.good,
    }));
    console.log(JSON.stringify({state: monitor.state, samples}, (_, value) =>
      typeof value === "bigint" ? value.toString() : value));
    if (monitor.state !== "Connected" || samples.length !== ${symbols.length} || samples.some(sample => !sample.good))
      throw new Error("The bundled monitor did not resolve all requested symbols with Good quality.");
  } finally { await monitor.disconnect(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
`;
const child = spawn(
  "node",
  ["-e", probe, bundle, endpoint, JSON.stringify(symbols), resolve(pki)],
  {
    stdio: "inherit",
  },
);
process.exitCode = await new Promise<number>((accept, reject) => {
  child.once("error", reject);
  child.once("exit", (code) => accept(code ?? 1));
});
