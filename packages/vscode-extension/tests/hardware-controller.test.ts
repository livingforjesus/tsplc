import { expect, mock, spyOn, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import type * as vscode from "vscode";
import { Monitor } from "../src/monitor.ts";

let files: vscode.Uri[] = [];
let input: (options: vscode.InputBoxOptions) => Promise<string | undefined> = async () => undefined;
const workspace = { isTrusted: true, findFiles: async () => files };
mock.module("vscode", () => ({
  workspace,
  window: { showInputBox: (options: vscode.InputBoxOptions) => input(options) },
}));
const { HardwareView } = await import("../src/hardware-view.ts");

async function fixture(username?: string) {
  const root = await mkdtemp(resolve(tmpdir(), "tsplc-monitor-view-"));
  const configFile = resolve(root, "tsplc.config.ts");
  const config = {
    backend: "codesys",
    monitor: { endpoint: "opc.tcp://current:4840", ...(username ? { username } : {}) },
  };
  await writeFile(configFile, `export default ${JSON.stringify(config)};`);
  const uri = { fsPath: configFile } as vscode.Uri;
  files = [uri];
  workspace.isTrusted = true;
  const values = new Map<string, string>();
  const secrets: vscode.SecretStorage = {
    keys: async () => [...values.keys()],
    get: async (key) => values.get(key),
    store: async (key, value) => {
      values.set(key, value);
    },
    delete: async (key) => {
      values.delete(key);
    },
    onDidChange: () => ({ dispose() {} }),
  };
  const output: vscode.OutputChannel = {
    name: "Fixture",
    append() {},
    appendLine() {},
    replace() {},
    clear() {},
    show() {},
    hide() {},
    dispose() {},
  };
  const view = new HardwareView(output, uri, secrets);
  await view.refresh();
  return { root, configFile, config, view };
}

test("Connect validates current config instead of using an endpoint retained after a failed refresh", async () => {
  const { root, configFile, config, view } = await fixture();
  const connect = spyOn(Monitor.prototype, "connect").mockImplementation(async () => {});
  try {
    await writeFile(
      configFile,
      'export default { backend: "codesys", monitor: { endpoint: "invalid" } };',
    );
    await view.refresh();
    await expect(view.connect()).rejects.toThrow();
    expect(connect).not.toHaveBeenCalled();
    config.monitor.endpoint = "opc.tcp://edited:4840";
    await writeFile(configFile, `export default ${JSON.stringify(config)};`);
    await view.connect();
    expect(connect).toHaveBeenCalledWith("opc.tcp://edited:4840", new Set(), {
      namespaceUri: undefined,
      securityMode: "SignAndEncrypt",
      securityPolicy: "Basic256Sha256",
      certificateDirectory: resolve(root, ".tsplc/opcua-pki"),
      username: undefined,
      password: undefined,
    });
  } finally {
    await view.dispose();
    connect.mockRestore();
  }
});

test("Disconnect during the password prompt prevents a delayed network connection", async () => {
  const { view } = await fixture("reader");
  let release!: (password: string) => void;
  let ready!: () => void;
  const prompted = new Promise<void>((resolve) => {
    ready = resolve;
  });
  input = async () => {
    ready();
    return new Promise<string>((resolve) => {
      release = resolve;
    });
  };
  const connect = spyOn(Monitor.prototype, "connect").mockImplementation(async () => {});
  try {
    const connecting = view.connect();
    await prompted;
    await view.disconnect();
    release("synthetic-secret");
    await connecting;
    expect(connect).not.toHaveBeenCalled();
  } finally {
    input = async () => undefined;
    await view.dispose();
    connect.mockRestore();
  }
});
