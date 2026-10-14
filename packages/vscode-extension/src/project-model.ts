import ts from "typescript";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { tsplcConfigSchema, type ResolvedTsplcConfig } from "@tsplc/config/schema";
import { loadHardware, resolveIo, type HardwareCatalog } from "@tsplc/typegen/hardware";

export interface ProjectModel {
  root: string;
  configFile: string;
  hardware: HardwareCatalog;
  config: ResolvedTsplcConfig;
  source: "config" | "generated";
  symbols: Record<string, string>;
}

/** Evaluate literals and duration helpers only. Opening a workspace never executes its config. */
export function configLiteral(text: string): unknown {
  const file = ts.createSourceFile("tsplc.config.ts", text, ts.ScriptTarget.Latest, true);
  const variables = new Map<string, ts.Expression>();
  for (const statement of file.statements)
    if (ts.isVariableStatement(statement))
      for (const declaration of statement.declarationList.declarations)
        if (ts.isIdentifier(declaration.name) && declaration.initializer)
          variables.set(declaration.name.text, declaration.initializer);
  const resolving = new Set<string>();
  const value = (node: ts.Expression): unknown => {
    if (
      ts.isParenthesizedExpression(node) ||
      ts.isAsExpression(node) ||
      ts.isSatisfiesExpression(node)
    )
      return value(node.expression);
    if (ts.isStringLiteralLike(node)) return node.text;
    if (ts.isNumericLiteral(node)) return Number(node.text);
    if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
    if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
    if (
      ts.isPrefixUnaryExpression(node) &&
      node.operator === ts.SyntaxKind.MinusToken &&
      ts.isNumericLiteral(node.operand)
    )
      return -Number(node.operand.text);
    if (ts.isIdentifier(node) && variables.has(node.text) && !resolving.has(node.text)) {
      resolving.add(node.text);
      try {
        return value(variables.get(node.text)!);
      } finally {
        resolving.delete(node.text);
      }
    }
    if (ts.isArrayLiteralExpression(node))
      return node.elements.map((element) => value(element as ts.Expression));
    if (ts.isObjectLiteralExpression(node)) {
      const object: Record<string, unknown> = Object.create(null);
      for (const property of node.properties) {
        if (ts.isSpreadAssignment(property)) {
          const spread = value(property.expression);
          if (!spread || typeof spread !== "object" || Array.isArray(spread))
            throw new Error("Dynamic config spread requires tsplc typegen.");
          Object.assign(object, spread);
          continue;
        }
        if (ts.isShorthandPropertyAssignment(property)) {
          object[property.name.text] = value(property.name);
          continue;
        }
        if (!ts.isPropertyAssignment(property) || ts.isComputedPropertyName(property.name))
          throw new Error("Dynamic config property requires tsplc typegen.");
        object[property.name.getText(file).replace(/^['"]|['"]$/g, "")] = value(
          property.initializer,
        );
      }
      return object;
    }
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      if (node.expression.text === "defineConfig" && node.arguments[0])
        return value(node.arguments[0]);
      const scale: Record<string, number> = { ns: 1, ms: 1_000_000, seconds: 1_000_000_000 };
      const argument = node.arguments[0] && value(node.arguments[0]);
      if (
        scale[node.expression.text] &&
        typeof argument === "number" &&
        Number.isSafeInteger(argument * scale[node.expression.text]!)
      )
        return { kind: "duration", nanoseconds: String(argument * scale[node.expression.text]!) };
    }
    throw new Error(
      "This config contains an expression the editor cannot read safely. Run tsplc typegen to refresh its project view.",
    );
  };
  const exported = file.statements.find(ts.isExportAssignment);
  const expression = exported?.expression ?? variables.get("config");
  if (!expression) throw new Error("Export a default config or a named config.");
  return value(expression);
}
export async function readProject(file: string, text?: string): Promise<ProjectModel> {
  const root = dirname(file);
  // A missing or damaged generated file must not hide a valid literal config.
  const snapshot: unknown = await readFile(resolve(root, ".tsplc/project.json"), "utf8")
    .then((json) => JSON.parse(json))
    .catch(() => undefined);
  const manifest =
    snapshot &&
    typeof snapshot === "object" &&
    "version" in snapshot &&
    snapshot.version === 1 &&
    "configFile" in snapshot &&
    snapshot.configFile === file &&
    "config" in snapshot
      ? snapshot
      : undefined;
  const sourceText = text ?? (await readFile(file, "utf8"));
  let decoded: unknown;
  let source: ProjectModel["source"] = "config";
  try {
    decoded = configLiteral(sourceText);
  } catch (cause) {
    // Expressions require a materialized config. Schema and hardware errors
    // must still report the edited project's error, rather than use old settings.
    if (text !== undefined || !manifest) throw cause;
    decoded = manifest.config;
    source = "generated";
  }
  const config = tsplcConfigSchema.parse(decoded);
  const hardware = await loadHardware(config, root);
  // Reject IO bindings to unknown or unaddressable channels, as typegen does.
  resolveIo(config, hardware);
  const published =
    manifest && "symbols" in manifest && manifest.symbols && typeof manifest.symbols === "object"
      ? manifest.symbols
      : {};
  return {
    root,
    configFile: file,
    hardware,
    config,
    source,
    symbols: Object.fromEntries(
      Object.entries(published).filter(
        (entry): entry is [string, string] =>
          Object.hasOwn(config.io, entry[0]) && typeof entry[1] === "string",
      ),
    ),
  };
}

export interface DependencyLiteral {
  name: string;
  company: string;
  version?: string;
  local: boolean;
  start: number;
  end: number;
  versionStart?: number;
  versionEnd?: number;
}
export function dependencyLiterals(text: string): DependencyLiteral[] {
  const file = ts.createSourceFile("tsplc.config.ts", text, ts.ScriptTarget.Latest, true),
    dependencies: DependencyLiteral[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isPropertyAssignment(node) &&
      node.name.getText(file).replace(/^['"]|['"]$/g, "") === "dependencies" &&
      ts.isObjectLiteralExpression(node.initializer)
    ) {
      for (const item of node.initializer.properties) {
        if (!ts.isPropertyAssignment(item)) continue;
        const name = item.name.getText(file).replace(/^['"]|['"]$/g, "");
        let version: ts.StringLiteral | undefined,
          company = "System",
          local = false;
        if (ts.isStringLiteral(item.initializer)) version = item.initializer;
        else if (ts.isObjectLiteralExpression(item.initializer))
          for (const setting of item.initializer.properties) {
            if (!ts.isPropertyAssignment(setting) || !ts.isStringLiteral(setting.initializer))
              continue;
            const key = setting.name.getText(file).replace(/^['"]|['"]$/g, "");
            if (key === "version") version = setting.initializer;
            if (key === "company") company = setting.initializer.text;
            if (key === "path") local = true;
          }
        dependencies.push({
          name,
          company,
          local,
          version: version?.text,
          start: item.name.getStart(file),
          end: item.name.end,
          versionStart: version?.getStart(file),
          versionEnd: version?.end,
        });
      }
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return dependencies;
}

export interface DependencyCompletion {
  kind: "name" | "version";
  company: string;
  name?: string;
  start: number;
  end: number;
  quoted: boolean;
}

/** Completion ranges come from syntax nodes, including unfinished config edits. */
export function dependencyCompletion(
  text: string,
  offset: number,
): DependencyCompletion | undefined {
  const file = ts.createSourceFile("tsplc.config.ts", text, ts.ScriptTarget.Latest, true);
  let context: DependencyCompletion | undefined;
  const propertyName = (name: ts.PropertyName) =>
    ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : undefined;
  const range = (node: ts.Identifier | ts.StringLiteral) => {
    const quoted = ts.isStringLiteral(node);
    const start = node.getStart(file) + (quoted ? 1 : 0);
    const end = node.end - (quoted && text[node.end - 1] === text[node.getStart(file)] ? 1 : 0);
    return { start, end, quoted };
  };
  const inside = (node: ts.Node) =>
    offset >= node.getStart(file) &&
    (offset <= node.end ||
      (ts.isObjectLiteralExpression(node) &&
        text[node.end - 1] !== "}" &&
        !text.slice(node.end, offset).trim()));
  const visit = (node: ts.Node) => {
    if (
      !ts.isPropertyAssignment(node) ||
      propertyName(node.name) !== "dependencies" ||
      !ts.isObjectLiteralExpression(node.initializer) ||
      !inside(node.initializer)
    ) {
      ts.forEachChild(node, visit);
      return;
    }
    const object = node.initializer;
    for (const item of object.properties) {
      if (!inside(item)) continue;
      if (ts.isShorthandPropertyAssignment(item)) {
        context = { kind: "name", company: "System", ...range(item.name) };
        return;
      }
      if (!ts.isPropertyAssignment(item)) return;
      const settings = ts.isObjectLiteralExpression(item.initializer)
        ? item.initializer.properties
        : [];
      const companySetting = settings.find(
        (setting) => ts.isPropertyAssignment(setting) && propertyName(setting.name) === "company",
      );
      const company =
        companySetting &&
        ts.isPropertyAssignment(companySetting) &&
        ts.isStringLiteral(companySetting.initializer)
          ? companySetting.initializer.text
          : "System";
      const name = propertyName(item.name);
      if ((ts.isIdentifier(item.name) || ts.isStringLiteral(item.name)) && inside(item.name)) {
        context = { kind: "name", company, ...range(item.name) };
        return;
      }
      let version: ts.StringLiteral | undefined;
      if (ts.isStringLiteral(item.initializer)) version = item.initializer;
      else
        for (const setting of settings)
          if (
            ts.isPropertyAssignment(setting) &&
            propertyName(setting.name) === "version" &&
            ts.isStringLiteral(setting.initializer)
          )
            version = setting.initializer;
      if (version && inside(version) && name)
        context = { kind: "version", company, name, ...range(version) };
      return;
    }
    if (offset > object.getStart(file) && (offset < object.end || text[object.end - 1] !== "}"))
      context = { kind: "name", company: "System", start: offset, end: offset, quoted: false };
  };
  visit(file);
  return context;
}
