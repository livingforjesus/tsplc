import * as vscode from "vscode";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { readProject, type ProjectModel } from "./project-model.ts";
import { hardwarePage, hardwareUpdate, monitoredSymbols } from "./hardware-renderer.ts";
import { Monitor } from "./monitor.ts";
import { monitorPassword, monitorPasswordKey } from "./monitor-credentials.ts";

export class HardwareView implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private project?: ProjectModel;
  private projects: vscode.Uri[] = [];
  private updateTimer?: ReturnType<typeof setTimeout>;
  private connectionRequest = 0;
  private connecting = false;
  private readonly monitor = new Monitor(() => this.scheduleUpdate());

  constructor(
    private readonly output: vscode.OutputChannel,
    private readonly extensionUri: vscode.Uri,
    private readonly secrets: vscode.SecretStorage,
  ) {}

  resolveWebviewView(view: vscode.WebviewView) {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "media")],
    };
    view.webview.onDidReceiveMessage(async (message: unknown) => {
      if (!message || typeof message !== "object" || !("action" in message)) return;
      try {
        switch (message.action) {
          case "ready":
            this.sendSamples();
            break;
          case "refresh":
            await this.refresh();
            break;
          case "connect":
            await this.connect();
            break;
          case "disconnect":
            await this.disconnect();
            break;
          case "forgetPassword":
            await this.forgetPassword();
            break;
          case "select":
            await this.select();
            break;
          case "typegen":
            await this.command("typegen");
            break;
          case "config":
            if (this.project)
              await vscode.window.showTextDocument(vscode.Uri.file(this.project.configFile));
            break;
        }
      } catch (cause) {
        void vscode.window.showErrorMessage(String(cause));
      }
    });
    view.onDidDispose(() => {
      this.view = undefined;
    });
    void this.refresh();
  }

  async refresh() {
    this.projects = await vscode.workspace.findFiles(
      "**/tsplc.config.ts",
      "**/{node_modules,.work,.vscode-test,build,dist}/**",
      100,
    );
    const uri =
      this.projects.find((item) => item.fsPath === this.project?.configFile) ?? this.projects[0];
    if (!uri) {
      await this.disconnect();
      this.project = undefined;
      this.render();
      return;
    }
    try {
      const next = await readProject(uri.fsPath);
      if (
        this.project &&
        (JSON.stringify(next.config) !== JSON.stringify(this.project.config) ||
          JSON.stringify(next.symbols) !== JSON.stringify(this.project.symbols))
      )
        await this.disconnect();
      this.project = next;
      this.render();
    } catch (cause) {
      this.output.appendLine(String(cause));
      this.render(cause instanceof Error ? cause.message : String(cause));
    }
  }

  async select() {
    const selected = await vscode.window.showQuickPick(
      this.projects.map((uri) => ({ label: vscode.workspace.asRelativePath(uri), uri })),
      { placeHolder: "Select a tsPLC project" },
    );
    if (!selected) return;
    await this.disconnect();
    this.project = await readProject(selected.uri.fsPath);
    this.render();
  }

  async connect() {
    if (!vscode.workspace.isTrusted)
      throw new Error("Trust this workspace to connect to its PLC endpoint.");
    if (!this.project) await this.refresh();
    if (!this.project) throw new Error("No valid tsplc.config.ts found.");
    if (this.connecting) throw new Error("A monitor connection is already in progress.");
    const selected = this.project;
    this.connecting = true;
    const request = ++this.connectionRequest;
    // A disconnect, project switch or revoked trust during an await cancels this request.
    const cancelled = () =>
      request !== this.connectionRequest ||
      selected !== this.project ||
      !vscode.workspace.isTrusted;
    try {
      // A failed refresh can leave the last valid page visible. Connecting must
      // validate the current file instead of reusing that page's old endpoint.
      const project = await readProject(selected.configFile);
      if (cancelled()) return;
      const monitor = project.config.monitor;
      if (!monitor) throw new Error("Configure monitor.endpoint in tsplc.config.ts.");
      const password = await monitorPassword(monitor, this.secrets, (options) =>
        vscode.window.showInputBox(options),
      );
      if (password === null || cancelled()) return;
      this.project = project;
      this.render();
      await this.monitor.connect(monitor.endpoint, monitoredSymbols(project), {
        namespaceUri: monitor.namespaceUri,
        securityMode: monitor.securityMode,
        securityPolicy: monitor.securityPolicy,
        certificateDirectory: resolve(project.root, monitor.certificateDirectory),
        username: monitor.username,
        password,
      });
    } finally {
      this.connecting = false;
    }
  }

  async disconnect() {
    ++this.connectionRequest;
    await this.monitor.disconnect();
  }

  async forgetPassword() {
    const monitor = this.project?.config.monitor;
    if (!monitor?.username) return;
    await this.secrets.delete(monitorPasswordKey(monitor.endpoint, monitor.username));
    void vscode.window.showInformationMessage(
      `Saved monitor password removed for ${monitor.username}.`,
    );
  }

  async dispose() {
    if (this.updateTimer) clearTimeout(this.updateTimer);
    this.updateTimer = undefined;
    this.view = undefined;
    await this.disconnect();
  }

  private scheduleUpdate() {
    if (!this.view || this.updateTimer) return;
    this.updateTimer = setTimeout(() => {
      this.updateTimer = undefined;
      this.sendSamples();
    }, 100);
  }

  private sendSamples() {
    void this.view?.webview.postMessage(hardwareUpdate(this.monitor.state, this.monitor.samples));
  }

  async command(command: "typegen" | "check" | "build" | "install") {
    if (!vscode.workspace.isTrusted)
      throw new Error("Trust this workspace to run its tsPLC config.");
    if (!this.project) await this.refresh();
    if (!this.project) throw new Error("No tsplc.config.ts found.");
    const terminal = vscode.window.createTerminal({
      name: `tsPLC ${command}`,
      cwd: this.project.root,
      shellPath: "bun",
      shellArgs: ["run", "--bun", "tsplc", command, "--config", this.project.configFile],
    });
    terminal.show();
  }

  private render(error?: string) {
    if (!this.view) return;
    const webview = this.view.webview;
    webview.html = hardwarePage(this.project, {
      nonce: randomUUID(),
      cspSource: webview.cspSource,
      styleUri: webview
        .asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "media/hardware-view.css"))
        .toString(),
      scriptUri: webview
        .asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "media/hardware-view.js"))
        .toString(),
      relativePath: (path) => vscode.workspace.asRelativePath(path),
      ...(error ? { error } : {}),
    });
  }
}
