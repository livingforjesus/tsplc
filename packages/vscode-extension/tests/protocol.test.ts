import { afterAll, beforeAll, expect, it } from "bun:test";
import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  createMessageConnection,
  type MessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
} from "vscode-jsonrpc/node";
import type {
  CompletionItem,
  Hover,
  InitializeResult,
  Location,
  PublishDiagnosticsParams,
  SemanticTokens,
  WorkspaceEdit,
} from "vscode-languageserver/node";

let process: ChildProcessWithoutNullStreams;
let rpc: MessageConnection;
const diagnostics = new Map<string, PublishDiagnosticsParams>();
const root = pathToFileURL(resolve(import.meta.dir, "fixtures/conveyor")).href;
const uri = `${root}/Main.st`;
const text = "PROGRAM Main\nVAR\nFlag : BOOL;\nEND_VAR\nFlag := 123;\nEND_PROGRAM";
const waitFor = async (predicate: () => boolean) => {
  const deadline = Date.now() + 5000;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error("Timed out waiting for LSP diagnostics");
    }
    await Bun.sleep(10);
  }
};
beforeAll(async () => {
  const build = Bun.spawn(["bun", "scripts/build.ts"], {
    cwd: resolve(import.meta.dir, ".."),
    stderr: "pipe",
  });
  expect(await build.exited).toBe(0);
  process = spawn("node", [resolve(import.meta.dir, "../dist/server.cjs"), "--stdio"], {
    stdio: "pipe",
  });
  rpc = createMessageConnection(
    new StreamMessageReader(process.stdout),
    new StreamMessageWriter(process.stdin),
  );
  rpc.onNotification("textDocument/publishDiagnostics", (params: PublishDiagnosticsParams) =>
    diagnostics.set(params.uri, params),
  );
  rpc.listen();
  const init = await rpc.sendRequest<InitializeResult>("initialize", {
    processId: null,
    rootUri: root,
    workspaceFolders: [{ uri: root, name: "fixture" }],
    capabilities: { workspace: { workspaceFolders: true } },
  });
  expect(init.capabilities.definitionProvider).toBe(true);
  expect(init.capabilities.renameProvider).toEqual({ prepareProvider: true });
  await rpc.sendNotification("initialized", {});
});
afterAll(async () => {
  if (rpc) {
    await rpc.sendRequest("shutdown");
    await rpc.sendNotification("exit");
    rpc.dispose();
  }
  process?.kill();
});

it("indexes disk sources and resolves split method definitions over actual JSON-RPC", async () => {
  const methodUri = `${root}/transport/FB_Conveyor/methods/SetMotionSignal/SetMotionSignal.implementation.st`;
  const content = await Bun.file(new URL(methodUri)).text();
  const before = content.slice(0, content.indexOf("MotionAsserted") + 3);
  const lines = before.split("\n");
  const definitions = await rpc.sendRequest<Location[]>("textDocument/definition", {
    textDocument: { uri: methodUri },
    position: {
      line: lines.length - 1,
      character: lines.at(-1)?.length ?? 0,
    },
  });
  expect(definitions[0]?.uri).toBe(`${root}/types/ST_Output.st`);
});

it("publishes versioned diagnostics, incremental edits, semantic tokens and rename", async () => {
  await rpc.sendNotification("textDocument/didOpen", {
    textDocument: { uri, languageId: "codesys-st", version: 1, text },
  });
  await waitFor(() => diagnostics.get(uri)?.version === 1);
  expect(diagnostics.get(uri)?.diagnostics.some((d) => d.code === "type-mismatch")).toBe(true);
  const completions = await rpc.sendRequest<CompletionItem[]>("textDocument/completion", {
    textDocument: { uri },
    position: { line: 4, character: 2 },
  });
  expect(completions.some((item) => item.label === "Flag")).toBe(true);
  const hover = await rpc.sendRequest<Hover>("textDocument/hover", {
    textDocument: { uri },
    position: { line: 4, character: 2 },
  });
  expect(JSON.stringify(hover)).toContain("BOOL");
  const tokens = await rpc.sendRequest<SemanticTokens>("textDocument/semanticTokens/full", {
    textDocument: { uri },
  });
  expect(tokens.data.length).toBeGreaterThan(0);
  const rename = await rpc.sendRequest<WorkspaceEdit>("textDocument/rename", {
    textDocument: { uri },
    position: { line: 4, character: 2 },
    newName: "Enabled",
  });
  expect(rename.changes?.[uri]).toHaveLength(2);
  await rpc.sendNotification("textDocument/didChange", {
    textDocument: { uri, version: 2 },
    contentChanges: [
      {
        range: {
          start: { line: 4, character: 8 },
          end: { line: 4, character: 11 },
        },
        text: "TRUE",
      },
    ],
  });
  await waitFor(() => diagnostics.get(uri)?.version === 2);
  expect(diagnostics.get(uri)?.diagnostics).toEqual([]);
});

it("restores disk state when an unsaved document closes", async () => {
  await rpc.sendNotification("textDocument/didClose", {
    textDocument: { uri },
  });
  await waitFor(() => diagnostics.get(uri)?.version === undefined);
  const symbols = await rpc.sendRequest<unknown[]>("workspace/symbol", {
    query: "Flag",
  });
  expect(symbols).toEqual([]);
});
