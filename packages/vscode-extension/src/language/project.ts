import { posix } from "node:path";
import type { Diagnostic } from "vscode-languageserver-types";
import { URI } from "vscode-uri";
import { builtinFiles } from "./builtins";
import { diagnostic } from "./lexer";
import {
  key,
  namedType,
  type ParsedFile,
  type Span,
  type StSymbol,
  type TypeNode,
  voidType,
} from "./model";
import { primitives } from "./types";

export type Unit = {
  symbol: StSymbol;
  files: ParsedFile[];
  children: Unit[];
  parent?: Unit;
  directory?: string;
};
const sourcePath = (uri: string) => URI.parse(uri).path;
const layout = (file: ParsedFile) => {
  const path = sourcePath(file.document.uri);
  const directory = posix.dirname(path);
  const stem = posix.basename(path).replace(/\.(st|iecst)$/i, "");
  const suffix = /^(.*)\.(declaration|implementation)$/i.exec(stem);
  const generic = /^(source|declaration|implementation)$/i.test(stem);
  const name = generic ? posix.basename(directory) : (suffix?.[1] ?? stem);
  return {
    path,
    directory,
    name,
    group: key(`${directory}/${name}`),
    part: key(suffix?.[2] ?? stem),
  };
};
const syntheticSymbol = (file: ParsedFile, name: string): StSymbol => ({
  id: `${file.document.uri}#action`,
  uri: file.document.uri,
  name,
  kind: "action",
  nameSpan: { start: 0, end: 0 },
  type: voidType,
  members: file.locals,
  section: "",
  modifiers: [],
  attributes: [],
  bases: [],
  interfaces: [],
  documentation: "",
  start: 0,
  end: file.document.getText().length,
});

export class Project {
  readonly units: Unit[] = [];
  readonly byFile = new Map<string, Unit>();
  readonly bySymbol = new Map<string, Unit>();
  readonly globals = new Map<string, StSymbol[]>();
  readonly diagnostics = new Map<string, Diagnostic[]>();
  readonly allSymbols = new Map<string, StSymbol>();
  readonly files: Map<string, ParsedFile>;
  file(uri: string): ParsedFile {
    const file = this.files.get(uri);
    if (!file) {
      throw new Error(`Index invariant: no source for ${uri}.`);
    }
    return file;
  }
  constructor(files: Map<string, ParsedFile>) {
    this.files = new Map([
      ...builtinFiles.map((file) => [file.document.uri, file] as const),
      ...files,
    ]);
    const groups = new Map<string, ParsedFile[]>();
    for (const file of this.files.values()) {
      this.diagnostics.set(file.document.uri, [...file.diagnostics]);
      const group = layout(file).group;
      const list = groups.get(group) ?? [];
      list.push(file);
      groups.set(group, list);
    }
    const directories = new Map<string, Unit>();
    for (const members of groups.values()) {
      const declarations = members.filter((file) => file.symbol);
      const first = declarations[0];
      if (!first?.symbol) {
        continue;
      }
      const unit: Unit = { symbol: first.symbol, files: members, children: [] };
      const shape = layout(first);
      if (key(shape.name) === key(posix.basename(shape.directory))) {
        unit.directory = shape.directory;
        directories.set(key(shape.directory), unit);
      }
      for (const duplicate of declarations.slice(1)) {
        this.addDiagnostic(
          duplicate,
          duplicate.symbol?.nameSpan ?? { start: 0, end: 0 },
          "ambiguous-source",
          `Multiple declarations or combined sources for ${unit.symbol.name}.`,
        );
      }
      if (members.filter((file) => layout(file).part === "IMPLEMENTATION").length > 1) {
        this.addDiagnostic(
          first,
          first.symbol.nameSpan,
          "ambiguous-source",
          `Multiple implementations for ${unit.symbol.name}.`,
        );
      }
      this.units.push(unit);
      for (const file of members) {
        this.byFile.set(file.document.uri, unit);
      }
    }
    for (const unit of this.units) {
      const path = sourcePath(unit.symbol.uri);
      const collection = /^(.*)\/(methods|properties|actions)\//i.exec(path);
      if (!collection) {
        continue;
      }
      const owner = directories.get(key(collection[1] ?? ""));
      if (owner && ["functionBlock", "program", "interface"].includes(owner.symbol.kind)) {
        unit.parent = owner;
        owner.children.push(unit);
      } else {
        const file = this.file(unit.symbol.uri);
        this.addDiagnostic(
          file,
          unit.symbol.nameSpan,
          "orphan-member",
          `${unit.symbol.name} has no owning program, function block or interface directory.`,
        );
      }
    }
    for (const file of this.files.values()) {
      if (this.byFile.has(file.document.uri)) {
        continue;
      }
      const shape = layout(file);
      const property = directories.get(key(shape.directory));
      if (property?.symbol.kind === "property" && ["GET", "SET"].includes(key(shape.name))) {
        property.files.push(file);
        this.byFile.set(file.document.uri, property);
        continue;
      }
      const action = /^(.*)\/actions\//i.exec(shape.path);
      const owner = action ? directories.get(key(action[1] ?? "")) : undefined;
      if (owner && ["functionBlock", "program"].includes(owner.symbol.kind)) {
        const unit: Unit = {
          symbol: syntheticSymbol(file, shape.name),
          parent: owner,
          files: [file],
          children: [],
        };
        owner.children.push(unit);
        this.units.push(unit);
        this.byFile.set(file.document.uri, unit);
      } else {
        this.addDiagnostic(
          file,
          { start: 0, end: Math.min(1, file.document.getText().length) },
          "missing-declaration",
          "No declaration or owning object was found for this implementation.",
        );
      }
    }
    for (const unit of this.units) {
      this.bySymbol.set(unit.symbol.id, unit);
      this.register(unit.symbol, unit);
      if (!unit.parent) {
        this.addGlobal(unit.symbol);
      }
      if (
        !unit.symbol.attributes.includes("qualified_only") &&
        ["gvl", "enum"].includes(unit.symbol.kind)
      ) {
        for (const member of unit.symbol.members) {
          this.addGlobal(member);
        }
      }
      for (const file of unit.files) {
        for (const local of file.locals) {
          this.register(local, unit);
        }
      }
    }
    for (const [name, symbols] of this.globals) {
      const user = symbols.filter((symbol) => !symbol.uri.startsWith("codesys-st:"));
      if (user.length) {
        this.globals.set(name, user);
      }
      if (user.length > 1) {
        for (const symbol of user) {
          this.addDiagnostic(
            this.file(symbol.uri),
            symbol.nameSpan,
            "duplicate-symbol",
            `Duplicate IEC name ${symbol.name}. Directory names do not introduce namespaces.`,
          );
        }
      }
    }
    for (const unit of this.units) {
      const seen = new Set<string>();
      for (const symbol of [
        ...unit.symbol.members,
        ...unit.children.map((child) => child.symbol),
      ]) {
        if (seen.has(key(symbol.name))) {
          this.addDiagnostic(
            this.file(symbol.uri),
            symbol.nameSpan,
            "duplicate-symbol",
            `Duplicate declaration ${symbol.name} in ${unit.symbol.name}.`,
          );
        }
        seen.add(key(symbol.name));
      }
      for (const file of unit.files) {
        const localNames = new Set<string>();
        for (const local of file.locals) {
          if (localNames.has(key(local.name))) {
            this.addDiagnostic(
              file,
              local.nameSpan,
              "duplicate-symbol",
              `Duplicate local declaration ${local.name}.`,
            );
          }
          localNames.add(key(local.name));
        }
      }
    }
  }
  addDiagnostic(
    file: ParsedFile,
    span: Span,
    code: string,
    message: string,
    severity: 1 | 2 | 3 | 4 = 1,
  ) {
    this.diagnostics
      .get(file.document.uri)
      ?.push(diagnostic(file.document, span, code, message, severity));
  }
  private register(symbol: StSymbol, owner: Unit) {
    this.allSymbols.set(symbol.id, symbol);
    this.bySymbol.set(symbol.id, owner);
    for (const child of symbol.members) {
      this.register(child, owner);
    }
  }
  private addGlobal(symbol: StSymbol) {
    const name = key(symbol.name);
    const list = this.globals.get(name) ?? [];
    list.push(symbol);
    this.globals.set(name, list);
  }
  global(name: string): StSymbol | undefined {
    const normalized = key(name).replace(/^STANDARD\./, "");
    const matches = this.globals.get(normalized);
    return matches?.length === 1 ? matches[0] : undefined;
  }
  typeSymbol(type: TypeNode): StSymbol | undefined {
    return type.kind === "named" ? this.global(type.name) : undefined;
  }
  resolveType(type: TypeNode): TypeNode {
    const seen = new Set<string>();
    let current = type;
    while (current.kind === "named") {
      const symbol = this.typeSymbol(current);
      if (symbol?.kind !== "alias" || seen.has(symbol.id)) {
        break;
      }
      seen.add(symbol.id);
      current = symbol.type;
    }
    return current;
  }
  valueType(type: TypeNode): TypeNode {
    const resolved = this.resolveType(type);
    return resolved.kind === "reference" ? this.resolveType(resolved.target) : resolved;
  }
  validType(type: TypeNode): boolean {
    if (type.kind !== "named") {
      return type.kind !== "unknown";
    }
    const symbol = this.typeSymbol(type);
    return (
      !!primitives[key(type.name)] ||
      (!!symbol &&
        ["struct", "union", "enum", "alias", "functionBlock", "interface"].includes(symbol.kind))
    );
  }
  allMembers(symbol: StSymbol): StSymbol[] {
    const seen = new Set<string>();
    const pending = [symbol];
    const result: StSymbol[] = [];
    const names = new Set<string>();
    for (const current of pending) {
      if (seen.has(current.id)) {
        continue;
      }
      seen.add(current.id);
      for (const member of [
        ...current.members,
        ...(this.bySymbol.get(current.id)?.children.map((unit) => unit.symbol) ?? []),
      ]) {
        if (
          names.has(key(member.name)) ||
          (current !== symbol && member.modifiers.includes("PRIVATE"))
        ) {
          continue;
        }
        names.add(key(member.name));
        result.push(member);
      }
      for (const base of current.bases) {
        const parent = this.typeSymbol(base);
        if (parent) {
          pending.push(parent);
        }
      }
    }
    return result;
  }
  owner(file: ParsedFile): Unit | undefined {
    return this.byFile.get(file.document.uri);
  }
  container(file: ParsedFile): Unit | undefined {
    const unit = this.owner(file);
    return unit?.parent ?? unit;
  }
  isDescendant(child: StSymbol, parent: StSymbol): boolean {
    const seen = new Set<string>();
    const pending = [child];
    for (const current of pending) {
      if (current.id === parent.id) {
        return true;
      }
      if (seen.has(current.id)) {
        continue;
      }
      seen.add(current.id);
      for (const type of [...current.bases, ...current.interfaces]) {
        const base = this.typeSymbol(type);
        if (base) {
          pending.push(base);
        }
      }
    }
    return false;
  }
  accessible(symbol: StSymbol, file: ParsedFile): boolean {
    const owner = this.bySymbol.get(symbol.id);
    const container = this.container(file);
    if (!owner) {
      return true;
    }
    const declaringContainer =
      symbol.kind === "method" || symbol.kind === "property" || symbol.kind === "action"
        ? owner.parent
        : owner;
    if (!declaringContainer) {
      return true;
    }
    const same = container?.symbol.id === declaringContainer.symbol.id;
    if (symbol.modifiers.includes("PRIVATE")) {
      return same;
    }
    if (symbol.modifiers.includes("PROTECTED")) {
      return !!container && this.isDescendant(container.symbol, declaringContainer.symbol);
    }
    if (symbol.kind === "variable" && ["functionBlock", "program"].includes(owner.symbol.kind)) {
      if (symbol.section === "VAR_TEMP") {
        return same && !this.owner(file)?.parent;
      }
      if (
        owner.symbol.kind === "functionBlock" &&
        !same &&
        !["VAR_INPUT", "VAR_OUTPUT"].includes(symbol.section)
      ) {
        return !!container && this.isDescendant(container.symbol, owner.symbol);
      }
    }
    return true;
  }
  visible(file: ParsedFile): StSymbol[] {
    const unit = this.owner(file);
    const result = [...file.locals];
    if (unit) {
      result.push(...unit.symbol.members, ...unit.children.map((child) => child.symbol));
      if (["function", "method", "property"].includes(unit.symbol.kind)) {
        result.push(unit.symbol);
      }
      if (unit.parent) {
        result.push(
          ...this.allMembers(unit.parent.symbol).filter((symbol) => this.accessible(symbol, file)),
        );
      } else {
        result.push(...this.allMembers(unit.symbol));
      }
    }
    result.push(...[...this.globals.values()].filter((list) => list.length === 1).flat());
    const seen = new Set<string>();
    return result.filter((symbol) => {
      const name = key(symbol.name);
      if (seen.has(name)) {
        return false;
      }
      seen.add(name);
      return true;
    });
  }
  lookup(file: ParsedFile, name: string): StSymbol | undefined {
    return this.visible(file).find((symbol) => key(symbol.name) === key(name));
  }
  members(type: TypeNode, file: ParsedFile, includeInaccessible = false): StSymbol[] {
    const resolved = this.valueType(type);
    const symbol = this.typeSymbol(resolved);
    if (!symbol) {
      return [];
    }
    return this.allMembers(symbol).filter(
      (member) => includeInaccessible || this.accessible(member, file),
    );
  }
  symbolType(symbol: StSymbol): TypeNode {
    return ["functionBlock", "program", "struct", "union", "enum", "interface", "gvl"].includes(
      symbol.kind,
    )
      ? namedType(symbol.name, symbol.nameSpan)
      : symbol.type;
  }
  propertyAccess(symbol: StSymbol): { read: boolean; write: boolean } {
    const unit = this.bySymbol.get(symbol.id);
    if (unit?.parent?.symbol.kind === "interface") {
      return { read: true, write: true };
    }
    return {
      read: !!unit?.files.some((file) => key(layout(file).name) === "GET"),
      write: !!unit?.files.some((file) => key(layout(file).name) === "SET"),
    };
  }
}
