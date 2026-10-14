import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { integerExpression } from "./constants";
import {
  type Declaration,
  type GlobalList,
  type TypeReference,
  parseDeclarations,
  parseGlobals,
} from "./parser";

export interface GenerateOptions {
  /** Directory searched recursively, or an explicit list of TYPE source files. */
  types: string | readonly string[];
  /** Directory or explicit GVL files; each list is named after its .st filename. */
  globals?: string | readonly string[];
  /** Inferred contracts select published globals and supported integer constants. */
  publishedGlobalsOnly?: boolean;
}

const integerTypePattern = /^(?:U?S?INT|U?DINT|BYTE|WORD|DWORD)$/;

const scalars: Record<string, string> = {
  BOOL: "boolean",
  BYTE: "number",
  WORD: "number",
  DWORD: "number",
  LWORD: "bigint",
  SINT: "number",
  INT: "number",
  DINT: "number",
  LINT: "bigint",
  USINT: "number",
  UINT: "number",
  UDINT: "number",
  ULINT: "bigint",
  REAL: "number",
  LREAL: "number",
  TIME: "number",
  TOD: "number",
  TIME_OF_DAY: "number",
  DATE: "number",
  DT: "number",
  DATE_AND_TIME: "number",
};

async function sources(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const paths = await Promise.all(
    entries
      .sort((a, b) => {
        if (a.name === b.name) return 0;
        return a.name < b.name ? -1 : 1;
      })
      .map(async (entry) => {
        const file = join(directory, entry.name);
        if (entry.isDirectory()) return sources(file);
        return entry.isFile() && /\.st$/i.test(file) ? [file] : [];
      }),
  );
  return paths.flat();
}

const quote = (value: string) => JSON.stringify(value);
const documentation = (value: string) =>
  value ? `/** ${value.replace(/\*\//g, "* /").replace(/\r?\n/g, "\n * ")} */\n` : "";

function unique<T extends { name: string; source: string }>(items: T[]): Map<string, T> {
  const result = new Map<string, T>();
  for (const item of items) {
    const key = item.name.toUpperCase();
    if (result.has(key))
      throw new Error(
        `${item.source}: duplicate declaration ${item.name} (also in ${result.get(key)?.source})`,
      );
    result.set(key, item);
  }
  return result;
}

export async function generateTypes(options: GenerateOptions): Promise<string> {
  const typeFiles =
    typeof options.types === "string" ? await sources(options.types) : options.types;
  const declarations = (
    await Promise.all(
      typeFiles.map(async (name) =>
        parseDeclarations({ name, text: await readFile(name, "utf8") }),
      ),
    )
  ).flat();
  const globalFiles =
    typeof options.globals === "string" ? await sources(options.globals) : (options.globals ?? []);
  // Program-only projects have a valid empty export selection. Directory
  // discovery still rejects empty input rather than hiding a bad setting.
  if (
    !typeFiles.length &&
    !globalFiles.length &&
    (typeof options.types === "string" || typeof options.globals === "string")
  )
    throw new Error(
      `no .st declarations found in ${typeof options.types === "string" ? options.types : "the selected source files"}`,
    );
  let globals = await Promise.all(
    globalFiles.map(async (name) =>
      parseGlobals(
        { name, text: await readFile(name, "utf8") },
        basename(name).replace(/\.st$/i, ""),
      ),
    ),
  );
  if (options.publishedGlobalsOnly)
    globals = globals
      .map((list) =>
        list.constant
          ? list
          : { ...list, members: list.members.filter((member) => member.published) },
      )
      .filter((list) => list.constant || list.members.length);
  return emit(declarations, globals, options.publishedGlobalsOnly ?? false);
}

function emit(
  declarations: Declaration[],
  globals: GlobalList[],
  publishedGlobalsOnly: boolean,
): string {
  const types = unique(declarations);
  unique(globals);
  const constants = globals.filter((list) => list.constant);
  // Keep integer constants useful to host clients, including declaration bounds.
  // Private block presets and labels cannot use this integer-only export format.
  // Their declarations still remain available to the lazy bound resolver below.
  const constantLists = publishedGlobalsOnly
    ? constants
        .map((list) => ({
          ...list,
          members: list.members.filter(
            (member) =>
              member.type.kind === "named" &&
              integerTypePattern.test(member.type.name.toUpperCase()),
          ),
        }))
        .filter((list) => list.members.length)
    : constants;
  const variableLists = globals.filter((list) => !list.constant);
  const constantValues = new Map<string, number>();
  const resolvingConstants = new Set<string>();
  const constantDefinitions = constants.flatMap((list) =>
    list.members.map((member) => ({
      list,
      member,
      key: `${list.name}.${member.name}`.toUpperCase(),
    })),
  );
  function constant(name: string, scope?: string): number {
    const key = name.toUpperCase();
    const scoped = constantDefinitions.find(
      (item) => item.key === `${scope}.${name}`.toUpperCase(),
    );
    const candidates = scoped
      ? [scoped]
      : constantDefinitions.filter(
          (item) =>
            item.key === key || (!name.includes(".") && item.member.name.toUpperCase() === key),
        );
    if (candidates.length !== 1) throw new Error(`unknown or ambiguous constant ${name}`);
    const definition = candidates[0]!;
    const cached = constantValues.get(definition.key);
    if (cached !== undefined) return cached;
    if (resolvingConstants.has(definition.key)) throw new Error(`cyclic constant ${name}`);
    const { member, list } = definition;
    if (
      member.initial === undefined ||
      member.type.kind !== "named" ||
      !integerTypePattern.test(member.type.name.toUpperCase())
    )
      throw new Error(
        `${list.source}: constant ${member.name} must have an integer type and initializer`,
      );
    resolvingConstants.add(definition.key);
    const value = integerExpression(member.initial, (reference) => constant(reference, list.name));
    resolvingConstants.delete(definition.key);
    constantValues.set(definition.key, value);
    return value;
  }

  function bound(expression: string): number {
    return integerExpression(expression, (name) => constant(name));
  }
  function dimensions(type: Extract<TypeReference, { kind: "array" }>) {
    return type.dimensions.map(({ lower, upper }) => {
      const start = bound(lower);
      const end = bound(upper);
      if (end < start || !Number.isSafeInteger(end - start + 1))
        throw new Error(`invalid array bounds ${lower}..${upper}`);
      return { start, end };
    });
  }
  function declaration(name: string): Declaration {
    const found = types.get(name.toUpperCase());
    if (!found) throw new Error(`unknown IEC type ${name}`);
    return found;
  }
  function tsType(type: TypeReference): string {
    if (type.kind === "array") {
      dimensions(type);
      return type.dimensions.reduce((child) => `Array<${child}>`, tsType(type.element));
    }
    if (type.kind === "string") {
      const length = bound(type.length);
      if (length < 1) throw new Error(`invalid ${type.name} length ${length}`);
      return "string";
    }
    return scalars[type.name.toUpperCase()] ?? declaration(type.name).name;
  }
  function resolved(type: TypeReference): TypeReference {
    if (type.kind !== "named" || scalars[type.name.toUpperCase()]) return type;
    const definition = declaration(type.name);
    if (definition.kind === "alias") return resolved(definition.type);
    if (definition.kind === "enum") return { kind: "named", name: definition.base };
    return type;
  }
  function iecType(type: TypeReference): string {
    const actual = resolved(type);
    if (actual.kind === "string") return `${actual.name}(${bound(actual.length)})`;
    if (actual.kind === "array")
      return `ARRAY[${dimensions(actual)
        .map(({ start, end }) => `${start}..${end}`)
        .join(", ")}] OF ${iecType(actual.element)}`;
    return scalars[actual.name.toUpperCase()]
      ? actual.name.toUpperCase()
      : declaration(actual.name).name;
  }

  // Topological order makes generated field lists reusable without duplicating child fields.
  const ordered: Declaration[] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();
  function visitReference(type: TypeReference): void {
    if (type.kind === "array") return visitReference(type.element);
    if (type.kind === "named" && !scalars[type.name.toUpperCase()]) visit(declaration(type.name));
  }
  function visit(type: Declaration): void {
    if (visited.has(type.name)) return;
    if (visiting.has(type.name))
      throw new Error(`${type.source}: cyclic type reference involving ${type.name}`);
    visiting.add(type.name);
    if (type.kind === "struct") type.members.forEach((member) => visitReference(member.type));
    if (type.kind === "alias") visitReference(type.type);
    visiting.delete(type.name);
    visited.add(type.name);
    ordered.push(type);
  }
  declarations.forEach(visit);

  const reserved = new Set(
    "break case catch class const continue debugger default delete do else enum export extends false finally for function if import in instanceof new null return super switch this throw true try typeof var void while with yield let static implements interface package private protected public await arguments eval PlcGlobals PlcField typeFields symbols globalVariableLists".split(
      " ",
    ),
  );
  for (const name of [
    ...declarations.map((type) => type.name),
    ...constantLists.map((list) => list.name),
  ]) {
    if (!/^[A-Za-z_]\w*$/.test(name) || reserved.has(name) || /^_fields\d+$/.test(name))
      throw new Error(`name cannot be exported to TypeScript: ${name}`);
    reserved.add(name);
  }
  const indexes = new Map(ordered.map((type, index) => [type.name, index]));
  function complex(type: TypeReference): boolean {
    const actual = resolved(type);
    if (actual.kind === "array") return complex(actual.element);
    return actual.kind === "named" && !scalars[actual.name.toUpperCase()];
  }
  function fields(type: TypeReference, path: string, description: string, depth = 0): string {
    const actual = resolved(type);
    if (actual.kind === "named" && complex(actual)) {
      const children = `_fields${indexes.get(declaration(actual.name).name)}`;
      if (path === '""') return children;
      return `${children}.map((member) => ({ ...member, field: ${path} + "." + member.field }))`;
    }
    if (actual.kind === "array" && complex(actual.element)) {
      const ranges = dimensions(actual);
      const coordinates = ranges.map(
        (range, index) => `String(i${depth}_${index} + (${range.start}))`,
      );
      const arrayPath = `${path} + "[" + ${coordinates.join(' + "," + ')} + "]"`;
      return ranges.reduceRight(
        (child, range, index) =>
          `Array.from({ length: ${range.end - range.start + 1} }, (_, i${depth}_${index}) => ${child}).flat()`,
        fields(actual.element, `(${arrayPath})`, description, depth + 1),
      );
    }
    return `[{ field: ${path}, type: ${quote(iecType(actual))}, description: ${quote(description)} }]`;
  }

  const output = [
    "// Generated by @vplc/typegen. Edit the PLC sources and regenerate.\n",
    "export interface PlcField { field: string; type: string; description: string; }\n",
  ];
  for (const type of ordered) {
    try {
      const doc = documentation(type.description);
      if (type.kind === "struct") {
        output.push(
          `${doc}export interface ${type.name} {\n${type.members.map((member) => `${documentation(member.description)}${quote(member.name)}: ${tsType(member.type)};`).join("\n")}\n}\n`,
        );
        output.push(
          `const _fields${indexes.get(type.name)}: PlcField[] = [\n${type.members.map((member) => `...${fields(member.type, quote(member.name), member.description)},`).join("\n")}\n];\n`,
        );
      } else if (type.kind === "alias") {
        output.push(`${doc}export type ${type.name} = ${tsType(type.type)};\n`);
        output.push(
          `const _fields${indexes.get(type.name)}: PlcField[] = ${fields(type.type, '""', type.description)};\n`,
        );
      } else {
        if (!integerTypePattern.test(type.base))
          throw new Error(`unsupported enum base ${type.base}`);
        const entries = new Map<string, number>();
        for (const member of type.members) {
          const previous = [...entries.values()].at(-1) ?? -1;
          const value =
            member.value === undefined
              ? previous + 1
              : integerExpression(
                  member.value,
                  (name) => entries.get(name.toUpperCase()) ?? constant(name),
                );
          entries.set(member.name.toUpperCase(), value);
        }
        output.push(
          `${doc}export const ${type.name} = { ${type.members.map((member) => `${quote(member.name)}: ${entries.get(member.name.toUpperCase())}`).join(", ")} } as const;\nexport type ${type.name} = (typeof ${type.name})[keyof typeof ${type.name}];\n`,
        );
        output.push(
          `const _fields${indexes.get(type.name)}: PlcField[] = ${fields({ kind: "named", name: type.base }, '""', type.description)};\n`,
        );
      }
    } catch (error) {
      throw new Error(
        `${type.source} (${type.name}): ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
  }
  output.push(
    `export const typeFields = {\n${ordered.map((type) => `${quote(type.name)}: _fields${indexes.get(type.name)},`).join("\n")}\n};\n`,
  );
  for (const list of constantLists) {
    output.push(
      `${documentation(list.description)}export const ${list.name} = {\n${list.members.map((member) => `${documentation(member.description)}${quote(member.name)}: ${constant(`${list.name}.${member.name}`)},`).join("\n")}\n} as const;\n`,
    );
  }
  output.push(
    `export interface PlcGlobals {\n${variableLists.map((list) => `${documentation(list.description)}${quote(list.name)}: {\n${list.members.map((member) => `${documentation(member.description)}${quote(member.name)}: ${tsType(member.type)};`).join("\n")}\n};`).join("\n")}\n}\n`,
  );
  output.push(
    `export const globalVariableLists = ${JSON.stringify(Object.fromEntries(variableLists.map((list) => [list.name, list.description])), null, "\t")} as const;\n`,
  );
  output.push(
    `export const symbols = ${JSON.stringify(
      variableLists.flatMap((list) =>
        list.members.map((member) => ({
          name: member.name,
          gvl: list.name,
          type:
            member.type.kind === "named" && !scalars[member.type.name.toUpperCase()]
              ? declaration(member.type.name).name
              : iecType(member.type),
          description: member.description,
        })),
      ),
      null,
      "\t",
    )} as const;\n`,
  );
  return output.join("\n");
}
