import {
  createConnection,
  ErrorCodes,
  type InitializeParams,
  ProposedFeatures,
  ResponseError,
  TextDocumentSyncKind,
  TextDocuments,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { URI } from "vscode-uri";
import { version } from "../../package.json";
import { semanticLegend } from "../language/service";
import { type Settings, Workspace } from "./workspace";

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);
const strings = (object: object, field: keyof Settings): string[] => {
  const value: unknown = Reflect.get(object, field);
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
};
const settings = (value: unknown): Settings => {
  const object = value && typeof value === "object" ? value : {};
  return {
    sourceRoots: strings(object, "sourceRoots"),
    libraryPaths: strings(object, "libraryPaths"),
  };
};
let workspace = new Workspace([], settings({}), (message) => connection.console.warn(message));
let ready: Promise<unknown> = Promise.resolve();
let debounce: ReturnType<typeof setTimeout> | undefined;
let published = new Set<string>();
const publish = () => {
  const uris = new Set(workspace.allUris());
  for (const uri of published) {
    if (!uris.has(uri)) {
      void connection.sendDiagnostics({ uri, diagnostics: [] });
    }
  }
  for (const uri of uris) {
    const version = documents.get(uri)?.version;
    void connection.sendDiagnostics({
      uri,
      diagnostics: workspace.service(uri).diagnostics(uri),
      ...(version !== undefined ? { version } : {}),
    });
  }
  published = uris;
};
const scheduleDiagnostics = () => {
  if (debounce) {
    clearTimeout(debounce);
  }
  debounce = setTimeout(() => {
    ready.then(publish).catch((error) => connection.console.error(String(error)));
  }, 100);
};
const refresh = () => {
  ready = workspace
    .refresh()
    .then((changed) => {
      if (changed) {
        publish();
      }
    })
    .catch((error) => connection.console.error(`Workspace indexing failed: ${String(error)}`));
  return ready;
};
connection.onInitialize((params: InitializeParams) => {
  const folders = (
    params.workspaceFolders?.map((folder) => folder.uri) ?? (params.rootUri ? [params.rootUri] : [])
  )
    .filter((uri) => URI.parse(uri).scheme === "file")
    .map((uri) => URI.parse(uri).fsPath);
  workspace = new Workspace(folders, settings(params.initializationOptions), (message) =>
    connection.console.warn(message),
  );
  ready = workspace.refresh();
  return {
    serverInfo: { name: "CODESYS Structured Text", version },
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      completionProvider: {
        triggerCharacters: [".", ":", "(", ","],
        resolveProvider: false,
      },
      hoverProvider: true,
      definitionProvider: true,
      typeDefinitionProvider: true,
      referencesProvider: true,
      renameProvider: { prepareProvider: true },
      documentSymbolProvider: true,
      workspaceSymbolProvider: true,
      signatureHelpProvider: {
        triggerCharacters: ["(", ","],
        retriggerCharacters: [":", "="],
      },
      semanticTokensProvider: { legend: semanticLegend, full: true },
      foldingRangeProvider: true,
      workspace: {
        workspaceFolders: { supported: true, changeNotifications: true },
      },
    },
  };
});
connection.onInitialized(() => {
  void ready.then(publish);
});
documents.onDidChangeContent((event) => {
  workspace.setDocument(event.document.uri, event.document.getText(), event.document.version);
  scheduleDiagnostics();
});
documents.onDidClose((event) => {
  workspace.closeDocument(event.document.uri);
  void refresh();
});
connection.onDidChangeWatchedFiles(() => refresh());
connection.onDidChangeConfiguration((params) => {
  const raw: unknown = params.settings;
  const value = raw && typeof raw === "object" && "codesysST" in raw ? raw.codesysST : raw;
  workspace.settings = settings(value);
  return refresh();
});
connection.onNotification(
  "workspace/didChangeWorkspaceFolders",
  ({ event }: { event: { added: { uri: string }[]; removed: { uri: string }[] } }) => {
    const removed = new Set(event.removed.map((folder) => URI.parse(folder.uri).fsPath));
    workspace.folders = [
      ...workspace.folders.filter((folder) => !removed.has(folder)),
      ...event.added
        .filter((folder) => URI.parse(folder.uri).scheme === "file")
        .map((folder) => URI.parse(folder.uri).fsPath),
    ];
    return refresh();
  },
);
/** Requests wait for indexing, then use the project that owns the document. */
const serviceFor = async (uri: string) => {
  await ready;
  return workspace.service(uri);
};
connection.onCompletion(async ({ textDocument: { uri }, position }) =>
  (await serviceFor(uri)).completion(uri, position),
);
connection.onHover(async ({ textDocument: { uri }, position }) =>
  (await serviceFor(uri)).hover(uri, position),
);
connection.onDefinition(async ({ textDocument: { uri }, position }) =>
  (await serviceFor(uri)).definition(uri, position),
);
connection.onTypeDefinition(async ({ textDocument: { uri }, position }) =>
  (await serviceFor(uri)).typeDefinition(uri, position),
);
connection.onReferences(async ({ textDocument: { uri }, position, context }) =>
  (await serviceFor(uri)).references(uri, position, context.includeDeclaration),
);
connection.onPrepareRename(async ({ textDocument: { uri }, position }) =>
  (await serviceFor(uri)).prepareRename(uri, position),
);
connection.onRenameRequest(async ({ textDocument: { uri }, position, newName }) => {
  const service = await serviceFor(uri);
  try {
    return service.rename(uri, position, newName);
  } catch (error) {
    throw new ResponseError(
      ErrorCodes.InvalidParams,
      error instanceof Error ? error.message : String(error),
    );
  }
});
connection.onSignatureHelp(async ({ textDocument: { uri }, position }) =>
  (await serviceFor(uri)).signatureHelp(uri, position),
);
connection.onDocumentSymbol(async ({ textDocument: { uri } }) =>
  (await serviceFor(uri)).documentSymbols(uri),
);
connection.onWorkspaceSymbol(async ({ query }) => {
  await ready;
  return workspace.projects.flatMap((project) => project.service.workspaceSymbols(query));
});
connection.languages.semanticTokens.on(async ({ textDocument: { uri } }) =>
  (await serviceFor(uri)).semanticTokens(uri),
);
connection.onFoldingRanges(async ({ textDocument: { uri } }) =>
  (await serviceFor(uri)).foldingRanges(uri),
);
connection.onRequest("codesysST/counterpart", async ({ uri }: { uri: string }) =>
  (await serviceFor(uri)).counterpart(uri),
);
connection.onRequest("codesysST/source", async (params: { uri: string }) => {
  if (!params.uri.startsWith("codesys-st:/standard/")) {
    return null;
  }
  const { builtinFiles } = await import("../language/builtins");
  return builtinFiles.find((file) => file.document.uri === params.uri)?.document.getText() ?? null;
});
connection.onShutdown(() => {
  if (debounce) {
    clearTimeout(debounce);
  }
});
documents.listen(connection);
connection.listen();
