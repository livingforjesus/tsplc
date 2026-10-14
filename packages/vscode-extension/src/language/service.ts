import {
  type CompletionItem,
  CompletionItemKind,
  type Diagnostic,
  type DocumentSymbol,
  type FoldingRange,
  type Hover,
  InsertTextFormat,
  type Location,
  MarkupKind,
  type Position,
  type Range,
  type SemanticTokens,
  type SignatureHelp,
  type SymbolInformation,
  SymbolKind,
  type WorkspaceEdit,
} from "vscode-languageserver-types";
import { Analysis, parameters, type Use } from "./analysis";
import { type Expr, key, keywords, type ParsedFile, type Span, type StSymbol } from "./model";
import { parse } from "./parser";
import { Project } from "./project";
import { primitives, typeLabel } from "./types";

const completionKinds: Record<StSymbol["kind"], CompletionItemKind> = {
  program: CompletionItemKind.Module,
  functionBlock: CompletionItemKind.Class,
  function: CompletionItemKind.Function,
  method: CompletionItemKind.Method,
  property: CompletionItemKind.Property,
  interface: CompletionItemKind.Interface,
  struct: CompletionItemKind.Struct,
  union: CompletionItemKind.Struct,
  enum: CompletionItemKind.Enum,
  alias: CompletionItemKind.TypeParameter,
  gvl: CompletionItemKind.Module,
  variable: CompletionItemKind.Variable,
  enumMember: CompletionItemKind.EnumMember,
  action: CompletionItemKind.Method,
};
const symbolKinds: Record<StSymbol["kind"], SymbolKind> = {
  program: SymbolKind.Module,
  functionBlock: SymbolKind.Class,
  function: SymbolKind.Function,
  method: SymbolKind.Method,
  property: SymbolKind.Property,
  interface: SymbolKind.Interface,
  struct: SymbolKind.Struct,
  union: SymbolKind.Struct,
  enum: SymbolKind.Enum,
  alias: SymbolKind.TypeParameter,
  gvl: SymbolKind.Namespace,
  variable: SymbolKind.Variable,
  enumMember: SymbolKind.EnumMember,
  action: SymbolKind.Method,
};
export const semanticLegend = {
  tokenTypes: [
    "namespace",
    "type",
    "class",
    "enum",
    "interface",
    "struct",
    "parameter",
    "variable",
    "property",
    "enumMember",
    "function",
    "method",
  ],
  tokenModifiers: ["declaration", "readonly", "defaultLibrary"],
};
const typeKinds = new Set<StSymbol["kind"]>([
  "functionBlock",
  "interface",
  "struct",
  "union",
  "enum",
  "alias",
]);
const label = (symbol: StSymbol) => {
  if (["function", "method", "functionBlock", "program", "action"].includes(symbol.kind)) {
    return `${symbol.name}(${parameters(symbol)
      .map(
        (param) =>
          `${param.name} ${param.section === "VAR_OUTPUT" ? "=>" : ":="} ${typeLabel(param.type)}`,
      )
      .join(", ")})${typeLabel(symbol.type) === "VOID" ? "" : ` : ${typeLabel(symbol.type)}`}`;
  }
  return `${symbol.name} : ${typeLabel(symbol.type)}`;
};
const documentation = (symbol: StSymbol) => ({
  kind: MarkupKind.Markdown,
  value: `\`\`\`codesys-st\n${label(symbol)}\n\`\`\`${symbol.documentation ? `\n\n${symbol.documentation}` : ""}`,
});

export class LanguageService {
  private readonly files = new Map<string, ParsedFile>();
  private snapshot?: { project: Project; analysis: Analysis };
  setDocument(uri: string, text: string, version = 0): void {
    const previous = this.files.get(uri);
    if (previous?.document.getText() === text) {
      return;
    }
    this.files.set(uri, parse(uri, text, version));
    delete this.snapshot;
  }
  removeDocument(uri: string): void {
    this.files.delete(uri);
    delete this.snapshot;
  }
  private state() {
    if (!this.snapshot) {
      const project = new Project(this.files);
      this.snapshot = { project, analysis: new Analysis(project) };
    }
    return this.snapshot;
  }
  diagnostics(uri: string): Diagnostic[] {
    return this.state().project.diagnostics.get(uri) ?? [];
  }
  private range(uri: string, span: Span): Range {
    const document = this.state().project.files.get(uri)?.document;
    return {
      start: document?.positionAt(span.start) ?? { line: 0, character: 0 },
      end: document?.positionAt(span.end) ?? { line: 0, character: 0 },
    };
  }
  private location(symbol: StSymbol): Location {
    return { uri: symbol.uri, range: this.range(symbol.uri, symbol.nameSpan) };
  }
  private useAt(uri: string, position: Position): Use | undefined {
    const file = this.files.get(uri);
    if (!file) {
      return undefined;
    }
    const offset = file.document.offsetAt(position);
    return this.state()
      .analysis.uses.get(uri)
      ?.filter((use) => use.start <= offset && offset <= use.end)
      .sort((a, b) => a.end - a.start - (b.end - b.start))[0];
  }
  private inTrivia(file: ParsedFile, offset: number): boolean {
    return [
      ...file.trivia,
      ...file.tokens.filter(
        (token) => token.kind === "string" || /^(?:W?STRING)#['"]/i.test(token.text),
      ),
    ].some(
      (token) =>
        token.start <= offset &&
        (offset < token.end ||
          (offset === token.end && (token.unterminated || token.text.startsWith("//")))),
    );
  }
  private expressions(file: ParsedFile): Expr[] {
    const result: Expr[] = [];
    const pending: Expr[] = [];
    for (const statement of file.statements) {
      switch (statement.kind) {
        case "assign":
          pending.push(statement.target, statement.value);
          break;
        case "for":
          pending.push(statement.variable, statement.from, statement.to);
          if (statement.step) {
            pending.push(statement.step);
          }
          break;
        case "case":
          pending.push(statement.expression, ...statement.labels);
          break;
        default:
          pending.push(statement.expression);
      }
    }
    for (const symbol of [...(file.symbol?.members ?? []), ...file.locals]) {
      if (symbol.initializer) {
        pending.push(symbol.initializer);
      }
    }
    for (const expression of pending) {
      result.push(expression);
      switch (expression.kind) {
        case "member":
        case "deref":
          pending.push(expression.object);
          break;
        case "index":
          pending.push(expression.object, ...expression.indices);
          break;
        case "call":
          pending.push(expression.callee, ...expression.args.map((arg) => arg.value));
          break;
        case "unary":
          pending.push(expression.operand);
          break;
        case "binary":
          pending.push(expression.left, expression.right);
          break;
        case "aggregate":
          pending.push(...expression.values.map((arg) => arg.value));
          break;
      }
    }
    return result;
  }
  private callAt(file: ParsedFile, offset: number): Extract<Expr, { kind: "call" }> | undefined {
    return this.expressions(file)
      .filter(
        (expr): expr is Extract<Expr, { kind: "call" }> =>
          expr.kind === "call" && expr.callee.end < offset && offset <= expr.end,
      )
      .sort((a, b) => a.end - a.start - (b.end - b.start))[0];
  }
  completion(uri: string, position: Position): CompletionItem[] {
    const file = this.files.get(uri);
    if (!file) {
      return [];
    }
    const offset = file.document.offsetAt(position);
    if (this.inTrivia(file, offset)) {
      return [];
    }
    const { project, analysis } = this.state();
    const before = file.document.getText().slice(0, offset);
    const partial = /[A-Za-z_][\w]*$/.exec(before)?.[0] ?? "";
    const wordStart = offset - partial.length;
    const suffix = /^\w*/.exec(file.document.getText().slice(offset))?.[0] ?? "";
    const editRange = this.range(uri, {
      start: wordStart,
      end: offset + suffix.length,
    });
    const item = (symbol: StSymbol): CompletionItem => ({
      label: symbol.name,
      kind: symbol.modifiers.includes("CONSTANT")
        ? CompletionItemKind.Constant
        : completionKinds[symbol.kind],
      detail: label(symbol),
      documentation: documentation(symbol),
      sortText: `${symbol.uri.startsWith("codesys-st:") ? "2" : "0"}${symbol.name}`,
      textEdit: { range: editRange, newText: symbol.name },
    });
    const dot = /\.\s*[\w]*$/.exec(before);
    if (dot && !/\.\.$/.test(before)) {
      const dotOffset = before.length - dot[0].length;
      const expression = this.expressions(file)
        .filter(
          (expr): expr is Extract<Expr, { kind: "member" }> =>
            expr.kind === "member" &&
            expr.object.end <= dotOffset &&
            expr.member.start >= dotOffset &&
            expr.member.start <= offset + 1,
        )
        .sort((a, b) => b.object.end - a.object.end)[0];
      if (expression) {
        const info = analysis.infer(file, expression.object);
        if (info.isType && !["enum", "gvl"].includes(info.symbol?.kind ?? "")) {
          return [];
        }
        return project.members(info.type, file).map(item);
      }
      return [];
    }
    const inType =
      /(?:\b(?:EXTENDS|IMPLEMENTS|OF|POINTER\s+TO|REFERENCE\s+TO)|:(?!=))\s*[\w.]*$/i.test(before);
    if (inType) {
      return [
        ...project
          .visible(file)
          .filter((symbol) => typeKinds.has(symbol.kind))
          .map(item),
        ...Object.keys(primitives)
          .filter((name) => !name.startsWith("__") && name !== "VOID")
          .concat("STRING", "WSTRING", "ARRAY", "POINTER TO", "REFERENCE TO")
          .map((name) => ({
            label: name,
            kind: CompletionItemKind.TypeParameter,
            textEdit: { range: editRange, newText: name },
          })),
      ];
    }
    const result = project.visible(file).map(item);
    const call = this.callAt(file, offset);
    if (call) {
      const target = analysis.callTarget(file, call.callee);
      const used = new Set(
        call.args.filter((arg) => arg.end < wordStart).map((arg) => arg.name?.upper),
      );
      if (target) {
        result.unshift(
          ...parameters(target)
            .filter((param) => !used.has(key(param.name)))
            .map((param) => ({
              ...item(param),
              label: param.name,
              kind: CompletionItemKind.Field,
              sortText: `!${param.name}`,
              insertTextFormat: InsertTextFormat.Snippet,
              textEdit: {
                range: editRange,
                newText: `${param.name} ${param.section === "VAR_OUTPUT" ? "=>" : ":="} \${1}`,
              },
            })),
        );
      }
    }
    result.push(
      ...[
        "IF",
        "THEN",
        "ELSE",
        "END_IF",
        "CASE",
        "FOR",
        "WHILE",
        "RETURN",
        "TRUE",
        "FALSE",
        "THIS",
        "SUPER",
        "VAR",
        "END_VAR",
      ].map((name) => ({
        label: name,
        kind: CompletionItemKind.Keyword,
        sortText: `3${name}`,
        textEdit: { range: editRange, newText: name },
      })),
    );
    return result;
  }
  hover(uri: string, position: Position): Hover | null {
    const use = this.useAt(uri, position);
    return use ? { contents: documentation(use.symbol), range: this.range(uri, use) } : null;
  }
  definition(uri: string, position: Position): Location[] {
    const use = this.useAt(uri, position);
    return use ? [this.location(use.symbol)] : [];
  }
  typeDefinition(uri: string, position: Position): Location[] {
    const use = this.useAt(uri, position);
    if (!use) {
      return [];
    }
    const { project } = this.state();
    let type = project.resolveType(use.symbol.type);
    while (type.kind === "pointer" || type.kind === "reference" || type.kind === "array") {
      type = project.resolveType(type.kind === "array" ? type.element : type.target);
    }
    const symbol = project.typeSymbol(type);
    return symbol ? [this.location(symbol)] : [];
  }
  references(uri: string, position: Position, includeDeclaration = true): Location[] {
    const use = this.useAt(uri, position);
    if (!use) {
      return [];
    }
    const locations: Location[] = [];
    for (const [fileUri, uses] of this.state().analysis.uses) {
      for (const other of uses) {
        if (other.symbol.id === use.symbol.id && (includeDeclaration || !other.declaration)) {
          locations.push({ uri: fileUri, range: this.range(fileUri, other) });
        }
      }
    }
    return locations;
  }
  prepareRename(uri: string, position: Position): { range: Range; placeholder: string } | null {
    const use = this.useAt(uri, position);
    if (
      !use ||
      use.symbol.uri.startsWith("codesys-st:") ||
      !["variable", "enumMember"].includes(use.symbol.kind) ||
      use.symbol.nameSpan.start === use.symbol.nameSpan.end
    ) {
      return null;
    }
    return { range: this.range(uri, use), placeholder: use.symbol.name };
  }
  rename(uri: string, position: Position, newName: string): WorkspaceEdit {
    if (
      !/^[A-Za-z_][A-Za-z_\d]*$/.test(newName) ||
      keywords.has(key(newName)) ||
      primitives[key(newName)] ||
      ["STRING", "WSTRING"].includes(key(newName))
    ) {
      throw new Error("Use a valid non-keyword IEC identifier.");
    }
    const use = this.useAt(uri, position);
    if (!use || !this.prepareRename(uri, position)) {
      throw new Error(
        "This symbol cannot be renamed. Object names are tied to filenames; rename their source files and declarations together.",
      );
    }
    const { project } = this.state();
    const owner = project.bySymbol.get(use.symbol.id);
    const localFile = project.files.get(use.symbol.uri);
    const accessorLocal = localFile?.locals.some((symbol) => symbol.id === use.symbol.id);
    const ownerPeers =
      owner?.symbol.kind === "gvl" && !owner.symbol.attributes.includes("qualified_only")
        ? [...project.globals.values()].flat()
        : (owner?.symbol.members ?? []);
    const peers = accessorLocal && localFile ? localFile.locals : ownerPeers;
    if (peers.some((symbol) => key(symbol.name) === key(newName) && symbol.id !== use.symbol.id)) {
      throw new Error(`Rename conflicts with the existing declaration ${newName}.`);
    }
    for (const [fileUri, uses] of this.state().analysis.uses) {
      const file = project.files.get(fileUri);
      if (!file) {
        continue;
      }
      for (const reference of uses.filter(
        (item) => item.symbol.id === use.symbol.id && !item.declaration,
      )) {
        const before = file.document.getText().slice(0, reference.start);
        const after = file.document.getText().slice(reference.end);
        if (
          /\.\s*$/.test(before) ||
          (/^\s*(?::=|=>)/.test(after) &&
            parameters(owner?.symbol ?? use.symbol).some((param) => param.id === use.symbol.id) &&
            owner !== project.owner(file))
        ) {
          continue;
        }
        const conflict = project.lookup(file, newName);
        if (conflict && conflict.id !== use.symbol.id) {
          throw new Error(`Rename would capture a reference with ${newName} in ${fileUri}.`);
        }
      }
    }
    const changes: NonNullable<WorkspaceEdit["changes"]> = {};
    for (const location of this.references(uri, position)) {
      const list = changes[location.uri] ?? [];
      list.push({ range: location.range, newText: newName });
      changes[location.uri] = list;
    }
    return { changes };
  }
  signatureHelp(uri: string, position: Position): SignatureHelp | null {
    const file = this.files.get(uri);
    if (!file) {
      return null;
    }
    const offset = file.document.offsetAt(position);
    if (this.inTrivia(file, offset)) {
      return null;
    }
    const call = this.callAt(file, offset);
    if (!call) {
      return null;
    }
    const target = this.state().analysis.callTarget(file, call.callee);
    if (!target) {
      return null;
    }
    const params = parameters(target);
    const current = call.args.find((arg) => arg.start <= offset && offset <= arg.end);
    let active = call.args.filter((arg) => arg.end < offset).length;
    if (current?.name) {
      const index = params.findIndex((param) => key(param.name) === current.name?.upper);
      if (index >= 0) {
        active = index;
      }
    }
    return {
      signatures: [
        {
          label: label(target),
          documentation: target.documentation,
          parameters: params.map((param) => ({
            label: `${param.name} ${param.section === "VAR_OUTPUT" ? "=>" : ":="} ${typeLabel(param.type)}`,
            documentation: param.documentation,
          })),
        },
      ],
      activeSignature: 0,
      activeParameter: Math.min(active, Math.max(0, params.length - 1)),
    };
  }
  documentSymbols(uri: string): DocumentSymbol[] {
    const file = this.files.get(uri);
    if (!file) {
      return [];
    }
    const convert = (symbol: StSymbol): DocumentSymbol => ({
      name: symbol.name,
      detail: typeLabel(symbol.type),
      kind: symbolKinds[symbol.kind],
      range: this.range(uri, symbol),
      selectionRange: this.range(uri, symbol.nameSpan),
      children: symbol.members.map(convert),
    });
    return file.symbol ? [convert(file.symbol)] : file.locals.map(convert);
  }
  workspaceSymbols(query: string): SymbolInformation[] {
    return [...this.state().project.allSymbols.values()]
      .filter(
        (symbol) => !symbol.uri.startsWith("codesys-st:") && key(symbol.name).includes(key(query)),
      )
      .slice(0, 1000)
      .map((symbol) => ({
        name: symbol.name,
        kind: symbolKinds[symbol.kind],
        location: this.location(symbol),
      }));
  }
  semanticTokens(uri: string): SemanticTokens {
    const uses = this.state().analysis.uses.get(uri) ?? [];
    const types: Partial<Record<StSymbol["kind"], string>> = {
      gvl: "namespace",
      alias: "type",
      functionBlock: "class",
      program: "namespace",
      enum: "enum",
      interface: "interface",
      struct: "struct",
      union: "struct",
      variable: "variable",
      enumMember: "enumMember",
      property: "property",
      method: "method",
      function: "function",
      action: "method",
    };
    const data: number[] = [];
    let line = 0;
    let character = 0;
    let end = -1;
    for (const use of [...uses].sort((a, b) => a.start - b.start)) {
      if (use.start < end) {
        continue;
      }
      const range = this.range(uri, use);
      if (range.start.line !== range.end.line) {
        continue;
      }
      const name =
        use.symbol.kind === "variable" &&
        ["VAR_INPUT", "VAR_OUTPUT", "VAR_IN_OUT"].includes(use.symbol.section)
          ? "parameter"
          : (types[use.symbol.kind] ?? "variable");
      const modifiers =
        Number(use.declaration) |
        (Number(use.symbol.modifiers.includes("CONSTANT") || use.symbol.kind === "enumMember") <<
          1) |
        (Number(use.symbol.uri.startsWith("codesys-st:")) << 2);
      data.push(
        range.start.line - line,
        range.start.line === line ? range.start.character - character : range.start.character,
        range.end.character - range.start.character,
        semanticLegend.tokenTypes.indexOf(name),
        modifiers,
      );
      line = range.start.line;
      character = range.start.character;
      end = use.end;
    }
    return { data };
  }
  foldingRanges(uri: string): FoldingRange[] {
    const file = this.files.get(uri);
    if (!file) {
      return [];
    }
    const ranges: FoldingRange[] = [];
    const stack: { token: string; line: number }[] = [];
    for (const token of file.tokens) {
      const line = file.document.positionAt(token.start).line;
      if (
        /^(PROGRAM|FUNCTION_BLOCK|FUNCTION|METHOD|PROPERTY|INTERFACE|TYPE|STRUCT|UNION|VAR(?:_\w+)?|IF|CASE|FOR|WHILE|REPEAT)$/.test(
          token.upper,
        )
      ) {
        stack.push({ token: token.upper, line });
      } else if (token.upper.startsWith("END_")) {
        const opener = token.upper.slice(4);
        const index = stack
          .map((item) => (item.token.startsWith("VAR") ? "VAR" : item.token))
          .lastIndexOf(opener);
        if (index >= 0) {
          const open = stack[index];
          stack.splice(index);
          if (open && open.line < line) {
            ranges.push({ startLine: open.line, endLine: line });
          }
        }
      }
    }
    for (const trivia of file.trivia.filter((token) => token.kind === "comment")) {
      const start = file.document.positionAt(trivia.start).line;
      const end = file.document.positionAt(trivia.end).line;
      if (end > start) {
        ranges.push({ startLine: start, endLine: end, kind: "comment" });
      }
    }
    return ranges;
  }
  counterpart(uri: string): string | null {
    const files = this.state().project.byFile.get(uri)?.files ?? [];
    const index = files.findIndex((file) => file.document.uri === uri);
    return files.length > 1 && index >= 0
      ? (files[(index + 1) % files.length]?.document.uri ?? null)
      : null;
  }
}
