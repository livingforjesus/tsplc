import * as vscode from "vscode";
import { libraryIndex } from "@vplc/build/libraries";
import { dependencyCompletion, dependencyLiterals } from "./project-model.ts";

const cache = new Map<string, { time: number; values: string[] }>();
async function index(path: string[]) {
  const key = path.join("/"),
    entry = cache.get(key);
  if (entry && Date.now() - entry.time < 300_000) return entry.values;
  const values = await libraryIndex(path);
  cache.set(key, { time: Date.now(), values });
  return values;
}
export function registerDependencyValidation(
  context: vscode.ExtensionContext,
  output: vscode.OutputChannel,
) {
  const collection = vscode.languages.createDiagnosticCollection("vplc-libraries"),
    timers = new Map<string, ReturnType<typeof setTimeout>>();
  const matches = (document: vscode.TextDocument) =>
    /[/\\]vplc\.config\.ts$/.test(document.fileName);
  const validate = async (document: vscode.TextDocument) => {
    const version = document.version,
      diagnostics: vscode.Diagnostic[] = [];
    try {
      for (const dependency of dependencyLiterals(document.getText())) {
        if (dependency.local) continue;
        const names = await index([dependency.company]);
        let message: string | undefined,
          start = dependency.start,
          end = dependency.end;
        if (!names.includes(dependency.name))
          message = `Unknown ${dependency.company} library '${dependency.name}'. Names are case sensitive.`;
        else if (
          dependency.version &&
          !(await index([dependency.company, dependency.name])).includes(dependency.version)
        ) {
          message = `Version '${dependency.version}' does not exist for '${dependency.name}'.`;
          start = dependency.versionStart!;
          end = dependency.versionEnd!;
        }
        if (message) {
          const diagnostic = new vscode.Diagnostic(
            new vscode.Range(document.positionAt(start), document.positionAt(end)),
            message,
            vscode.DiagnosticSeverity.Error,
          );
          diagnostic.source = "vPLC library archive";
          diagnostics.push(diagnostic);
        }
      }
      if (document.version === version && !document.isClosed)
        collection.set(document.uri, diagnostics);
    } catch (cause) {
      if (document.version === version && !document.isClosed) collection.delete(document.uri);
      output.appendLine(`Library validation unavailable: ${String(cause)}`);
    }
  };
  const schedule = (document: vscode.TextDocument) => {
    if (!matches(document)) return;
    const key = document.uri.toString(),
      timer = timers.get(key);
    if (timer) clearTimeout(timer);
    timers.set(
      key,
      setTimeout(() => {
        timers.delete(key);
        void validate(document);
      }, 400),
    );
  };
  context.subscriptions.push(
    collection,
    {
      dispose: () => {
        for (const timer of timers.values()) clearTimeout(timer);
      },
    },
    vscode.workspace.onDidOpenTextDocument(schedule),
    vscode.workspace.onDidChangeTextDocument((event) => schedule(event.document)),
    vscode.workspace.onDidCloseTextDocument((document) => {
      collection.delete(document.uri);
      const timer = timers.get(document.uri.toString());
      if (timer) clearTimeout(timer);
      timers.delete(document.uri.toString());
    }),
    vscode.languages.registerCompletionItemProvider(
      { language: "typescript", pattern: "**/vplc.config.ts" },
      {
        provideCompletionItems: async (document, position) => {
          const text = document.getText(),
            offset = document.offsetAt(position),
            target = dependencyCompletion(text, offset);
          if (!target || offset < target.start || offset > target.end) return undefined;
          const version = target.kind === "version";
          try {
            const values = await index(version ? [target.company, target.name!] : [target.company]);
            return values.map((value) => {
              const item = new vscode.CompletionItem(
                value,
                version ? vscode.CompletionItemKind.Value : vscode.CompletionItemKind.Module,
              );
              item.detail = version
                ? `CODESYS ${target.name}`
                : `CODESYS ${target.company} library`;
              item.range = new vscode.Range(
                document.positionAt(target.start),
                document.positionAt(target.end),
              );
              if (target.quoted) {
                const quote = text[target.start - 1]!;
                item.insertText = value.replaceAll("\\", "\\\\").replaceAll(quote, `\\${quote}`);
              } else if (target.start === target.end) {
                item.insertText = new vscode.SnippetString()
                  .appendText(`${JSON.stringify(value)}: "`)
                  .appendTabstop(1)
                  .appendText('"');
              } else
                item.insertText = /^[A-Za-z_$][\w$]*$/.test(value) ? value : JSON.stringify(value);
              return item;
            });
          } catch (cause) {
            output.appendLine(String(cause));
            return undefined;
          }
        },
      },
      '"',
      "'",
      ":",
    ),
  );
  vscode.workspace.textDocuments.forEach(schedule);
}
