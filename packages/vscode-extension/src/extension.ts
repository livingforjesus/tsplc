import * as vscode from "vscode";
import { LanguageClient, TransportKind } from "vscode-languageclient/node";
import { HardwareView } from "./hardware-view.ts";
import { registerDependencyValidation } from "./dependency-validation.ts";

let client: LanguageClient | undefined;
let hardware: HardwareView | undefined;
export const activate = async (context: vscode.ExtensionContext) => {
  const sourcePattern = "**/*.{st,ST,iecst,IECST}";
  const sourceWatcher = vscode.workspace.createFileSystemWatcher(sourcePattern);
  const configWatcher = vscode.workspace.createFileSystemWatcher(
    "**/{tsplc,codesys-build}.config.{ts,js,mts,cts,mjs,cjs}",
  );
  const hardwareWatcher = vscode.workspace.createFileSystemWatcher("**/*.{eds,EDS,devdesc.xml}");
  const manifestWatcher = vscode.workspace.createFileSystemWatcher("**/.tsplc/project.json");
  const output = vscode.window.createOutputChannel("CODESYS Structured Text");
  const view = new HardwareView(output, context.extensionUri, context.secrets);
  hardware = view;
  context.subscriptions.push(
    sourceWatcher,
    configWatcher,
    hardwareWatcher,
    manifestWatcher,
    output,
    vscode.window.registerWebviewViewProvider("tsplc.hardware", view),
  );
  for (const event of [
    hardwareWatcher.onDidChange,
    hardwareWatcher.onDidCreate,
    hardwareWatcher.onDidDelete,
    configWatcher.onDidChange,
    configWatcher.onDidCreate,
    configWatcher.onDidDelete,
    manifestWatcher.onDidChange,
  ])
    context.subscriptions.push(event(() => void view.refresh()));
  for (const command of ["typegen", "check", "build", "install"] as const)
    context.subscriptions.push(
      vscode.commands.registerCommand(`tsplc.${command}`, () => view.command(command)),
    );
  context.subscriptions.push(
    vscode.commands.registerCommand("tsplc.connect", () => view.connect()),
    vscode.commands.registerCommand("tsplc.disconnect", () => view.disconnect()),
    vscode.commands.registerCommand("tsplc.forgetMonitorPassword", () => view.forgetPassword()),
    vscode.commands.registerCommand("tsplc.refresh", () => view.refresh()),
  );
  registerDependencyValidation(context, output);
  const config = vscode.workspace.getConfiguration("codesysST");
  const languageClient = new LanguageClient(
    "codesysST",
    "CODESYS Structured Text",
    { module: context.asAbsolutePath("dist/server.cjs"), transport: TransportKind.ipc },
    {
      documentSelector: [
        { scheme: "file", language: "codesys-st" },
        { scheme: "untitled", language: "codesys-st" },
        // Existing ST extensions also claim SCL/XML formats; only attach to ST source.
        { scheme: "file", language: "st", pattern: sourcePattern },
      ],
      initializationOptions: {
        sourceRoots: config.get<string[]>("sourceRoots", []),
        libraryPaths: config.get<string[]>("libraryPaths", []),
      },
      synchronize: {
        fileEvents: [sourceWatcher, configWatcher],
        configurationSection: "codesysST",
      },
      outputChannel: output,
    },
  );
  client = languageClient;
  context.subscriptions.push(
    vscode.commands.registerCommand("codesysST.restartServer", () => languageClient.restart()),
    vscode.commands.registerCommand("codesysST.openCounterpart", async () => {
      const uri = vscode.window.activeTextEditor?.document.uri;
      if (!uri) return;
      const target = await languageClient.sendRequest<string | null>("codesysST/counterpart", {
        uri: uri.toString(),
      });
      if (target) await vscode.window.showTextDocument(vscode.Uri.parse(target));
      else
        void vscode.window.showInformationMessage(
          "This source has no separate declaration or implementation.",
        );
    }),
    // Read-only documents for bundled standard-library signatures (go to definition).
    vscode.workspace.registerTextDocumentContentProvider("codesys-st", {
      provideTextDocumentContent: async (uri) =>
        (await languageClient.sendRequest<string | null>("codesysST/source", {
          uri: uri.toString(),
        })) ?? "",
    }),
  );
  await languageClient.start();
};
export const deactivate = async () => {
  await hardware?.dispose();
  hardware = undefined;
  await client?.stop();
  client = undefined;
};
