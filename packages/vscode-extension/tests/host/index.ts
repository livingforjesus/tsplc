import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import * as vscode from "vscode";

const waitFor = async (predicate: () => boolean, description: string) => {
  const deadline = Date.now() + 10000;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for ${description}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
};
export const run = async () => {
  const workspace = vscode.workspace.workspaceFolders?.[0]?.uri;
  assert(workspace);
  const root = vscode.Uri.joinPath(workspace, "apps/plc/src");
  const uri = vscode.Uri.joinPath(root, "Main.st");
  const doc = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(doc);
  assert.equal(doc.languageId, process.env.CODESYS_ST_TEST_LANGUAGE);
  const extension = vscode.extensions.getExtension("livingforjesus.vplc-vscode-extension");
  assert(extension);
  // Opening source must activate tooling; explicitly activating here hides regressions.
  await waitFor(() => extension.isActive, `automatic activation for ${doc.languageId}`);
  const content =
    "PROGRAM Main\nVAR\nFlag : BOOL;\nItem : ST_Conveyor;\nEND_VAR\nFlag := 1;\nItem.Status;\nEND_PROGRAM";
  const edit = new vscode.WorkspaceEdit();
  edit.replace(
    uri,
    new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length)),
    content,
  );
  assert(await vscode.workspace.applyEdit(edit));
  await waitFor(
    () =>
      vscode.languages
        .getDiagnostics(uri)
        .some((diagnostic) => diagnostic.code === "type-mismatch"),
    "type mismatch diagnostic",
  );
  const completion = await vscode.commands.executeCommand<vscode.CompletionList>(
    "vscode.executeCompletionItemProvider",
    uri,
    new vscode.Position(6, 5),
  );
  assert(completion?.items.some((item) => item.label === "Cards"));
  const definition = await vscode.commands.executeCommand<vscode.Location[]>(
    "vscode.executeDefinitionProvider",
    uri,
    new vscode.Position(3, 12),
  );
  assert(definition?.some((location) => location.uri.path.endsWith("ST_Conveyor.st")));
  const hover = await vscode.commands.executeCommand<vscode.Hover[]>(
    "vscode.executeHoverProvider",
    uri,
    new vscode.Position(5, 2),
  );
  assert(hover?.length);
  const rename = await vscode.commands.executeCommand<vscode.WorkspaceEdit>(
    "vscode.executeDocumentRenameProvider",
    uri,
    new vscode.Position(5, 2),
    "Enabled",
  );
  assert.equal(rename?.get(uri).length, 2);
  const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
    "vscode.executeDocumentSymbolProvider",
    uri,
  );
  assert(symbols?.some((symbol) => symbol.name === "Main"));
  const correction = new vscode.WorkspaceEdit();
  correction.replace(uri, new vscode.Range(5, 8, 5, 9), "TRUE");
  correction.delete(uri, new vscode.Range(6, 0, 7, 0));
  assert(await vscode.workspace.applyEdit(correction));
  await waitFor(() => vscode.languages.getDiagnostics(uri).length === 0, "cleared diagnostics");
  const methodUri = vscode.Uri.joinPath(
    root,
    "transport/FB_Conveyor/methods/SetMotionSignal/SetMotionSignal.implementation.st",
  );
  await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(methodUri));
  await vscode.commands.executeCommand("codesysST.openCounterpart");
  assert(
    vscode.window.activeTextEditor?.document.uri.path.endsWith("SetMotionSignal.declaration.st"),
  );
  const lineUri = vscode.Uri.joinPath(workspace, "apps/line/src/Main.st");
  const lineDoc = await vscode.workspace.openTextDocument(lineUri);
  await vscode.window.showTextDocument(lineDoc);
  const inbound = await vscode.commands.executeCommand<vscode.Hover[]>(
    "vscode.executeHoverProvider",
    lineUri,
    new vscode.Position(6, 3),
  );
  assert(
    inbound?.some((item) =>
      item.contents.some(
        (part) => typeof part !== "string" && part.value.includes("Inbound : FB_LineConveyor"),
      ),
    ),
  );
  const inboundCompletion = await vscode.commands.executeCommand<vscode.CompletionList>(
    "vscode.executeCompletionItemProvider",
    lineUri,
    new vscode.Position(6, 5),
  );
  assert(
    inboundCompletion?.items.some(
      (item) => item.label === "Inbound" && item.detail?.includes("FB_LineConveyor"),
    ),
  );
  const typeCompletion = await vscode.commands.executeCommand<vscode.CompletionList>(
    "vscode.executeCompletionItemProvider",
    lineUri,
    new vscode.Position(2, 15),
  );
  assert(typeCompletion?.items.some((item) => item.label === "FB_LineConveyor"));
  const probeUri = vscode.Uri.joinPath(root, "Ignored.scl");
  const probe = new vscode.WorkspaceEdit();
  probe.createFile(probeUri);
  probe.insert(
    probeUri,
    new vscode.Position(0, 0),
    "PROGRAM Probe\nVAR Flag : BOOL; END_VAR\nFlag := TRUE;\nEND_PROGRAM",
  );
  assert(await vscode.workspace.applyEdit(probe));
  const probeDoc = await vscode.workspace.openTextDocument(probeUri);
  assert.equal(probeDoc.languageId, "st");
  assert.deepEqual(
    await vscode.commands.executeCommand<vscode.Hover[]>(
      "vscode.executeHoverProvider",
      probeUri,
      new vscode.Position(2, 2),
    ),
    [],
  );
  const iecUri = vscode.Uri.joinPath(root, "Portable.iecst");
  const iecEdit = new vscode.WorkspaceEdit();
  iecEdit.createFile(iecUri);
  iecEdit.insert(
    iecUri,
    new vscode.Position(0, 0),
    "PROGRAM Portable\nVAR Motor : FB_Conveyor; END_VAR\nMotor();\nEND_PROGRAM",
  );
  assert(await vscode.workspace.applyEdit(iecEdit));
  const iecDoc = await vscode.languages.setTextDocumentLanguage(
    await vscode.workspace.openTextDocument(iecUri),
    "st",
  );
  assert.equal(iecDoc.languageId, "st");
  const iecHover = await vscode.commands.executeCommand<vscode.Hover[]>(
    "vscode.executeHoverProvider",
    iecUri,
    new vscode.Position(2, 2),
  );
  assert(
    iecHover?.some((item) =>
      item.contents.some(
        (part) => typeof part !== "string" && part.value.includes("Motor : FB_Conveyor"),
      ),
    ),
  );
  console.log(
    `VS Code host (${doc.languageId}): automatic activation, diagnostics, completion, definition, hover, rename, symbols, live edits, counterpart and blueprint Inbound passed; unrelated st dialects excluded.`,
  );
  const resultPath = process.env.CODESYS_ST_TEST_RESULT_PATH;
  assert(resultPath);
  assert(await vscode.workspace.saveAll(false));
  await writeFile(resultPath, JSON.stringify({ language: doc.languageId, passed: true }));
};
