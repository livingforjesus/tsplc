import * as vscode from "vscode";
import { LanguageClient, TransportKind } from "vscode-languageclient/node";
import { HardwareView } from "./hardware-view.ts";
import { registerDependencyValidation } from "./dependency-validation.ts";

let client: LanguageClient | undefined;
let hardware: HardwareView | undefined;
export const activate = async (context: vscode.ExtensionContext) => {
  const sourcePattern = "**/*.{st,ST,iecst,IECST}";
  const watcher = vscode.workspace.createFileSystemWatcher(sourcePattern);
  const configWatcher = vscode.workspace.createFileSystemWatcher(
    "**/{vplc,codesys-build}.config.{ts,js,mts,cts,mjs,cjs}",
  );
  const output = vscode.window.createOutputChannel("CODESYS Structured Text");
  hardware = new HardwareView(output, context.extensionUri, context.secrets);
  const hardwareWatcher = vscode.workspace.createFileSystemWatcher("**/*.{eds,EDS,devdesc.xml}");
  const manifestWatcher = vscode.workspace.createFileSystemWatcher("**/.vplc/project.json");
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("vplc.hardware", hardware),
    hardwareWatcher,
    manifestWatcher,
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
    context.subscriptions.push(
      event(() => {
        void hardware?.refresh();
      }),
    );
  for (const command of ["typegen", "check", "build", "install"] as const)
    context.subscriptions.push(
      vscode.commands.registerCommand(`vplc.${command}`, () => hardware?.command(command)),
    );
  context.subscriptions.push(
    vscode.commands.registerCommand("vplc.connect", () => hardware?.connect()),
    vscode.commands.registerCommand("vplc.disconnect", () => hardware?.disconnect()),
    vscode.commands.registerCommand("vplc.forgetMonitorPassword", () => hardware?.forgetPassword()),
    vscode.commands.registerCommand("vplc.refresh", () => hardware?.refresh()),
  );
  registerDependencyValidation(context, output);
  const config = vscode.workspace.getConfiguration("codesysST");
  client = new LanguageClient(
    "codesysST",
    "CODESYS Structured Text",
    {
      run: {
        module: context.asAbsolutePath("dist/server.cjs"),
        transport: TransportKind.ipc,
      },
      debug: {
        module: context.asAbsolutePath("dist/server.cjs"),
        transport: TransportKind.ipc,
      },
    },
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
        fileEvents: [watcher, configWatcher],
        configurationSection: "codesysST",
      },
      outputChannel: output,
    },
  );
  context.subscriptions.push(
    watcher,
    configWatcher,
    output,
    vscode.commands.registerCommand("codesysST.restartServer", async () => {
      await client?.restart();
    }),
    vscode.commands.registerCommand("codesysST.openCounterpart", async () => {
      const uri = vscode.window.activeTextEditor?.document.uri;
      if (!uri || !client) {
        return;
      }
      const target = await client.sendRequest<string | null>("codesysST/counterpart", {
        uri: uri.toString(),
      });
      if (target) {
        await vscode.window.showTextDocument(vscode.Uri.parse(target));
      } else {
        void vscode.window.showInformationMessage(
          "This source has no separate declaration or implementation.",
        );
      }
    }),
    vscode.workspace.registerTextDocumentContentProvider("codesys-st", {
      provideTextDocumentContent: async (uri) =>
        (await client?.sendRequest<string | null>("codesysST/source", {
          uri: uri.toString(),
        })) ?? "",
    }),
  );
  await client.start();
};
export const deactivate = async () => {
  await hardware?.dispose();
  hardware = undefined;
  await client?.stop();
  client = undefined;
};
