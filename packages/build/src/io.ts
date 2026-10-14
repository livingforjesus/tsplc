import type { SourceObject } from "./sources.ts";
import { tokenize, type Token } from "./st/lexer.ts";
import { variableSections } from "./st/declarations.ts";

export interface DirectIoBinding {
  address: string;
  type?: string;
}
// A span binds at its first element: ARRAY[l..u] OF <element> with consecutive addresses.
const arrayType = /^ARRAY\s*\[\s*(-?\d+)\s*\.\.\s*(-?\d+)\s*\]\s*OF\s+(\w+)$/;
const layout = (type: string) => {
  const array = arrayType.exec(type);
  return array
    ? { element: array[3]!, length: Number(array[2]) - Number(array[1]) + 1 }
    : { element: type, length: 1 };
};
const widths: Record<string, string> = {
  BOOL: "X",
  BYTE: "B",
  SINT: "B",
  USINT: "B",
  WORD: "W",
  INT: "W",
  UINT: "W",
  DWORD: "D",
  DINT: "D",
  UDINT: "D",
  REAL: "D",
};

/** Apply the shared mapping to declarations in memory; authored ST stays untouched. */
export function bindStructuredTextIo(
  objects: SourceObject[],
  bindings: Record<string, DirectIoBinding>,
) {
  const declarations: {
    object: SourceObject;
    name: string;
    names: Token[];
    colon: Token;
    type: string;
  }[] = [];
  const visit = (object: SourceObject) => {
    const tokens = tokenize(object.declaration, object.source);
    let section = false,
      start = 0;
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i]!;
      if (variableSections.has(token.value)) {
        section = true;
        start = i + 1;
        continue;
      }
      if (token.value === "END_VAR") {
        section = false;
        continue;
      }
      if (!section || token.value !== ";") continue;
      const part = tokens.slice(start, i).filter((t) => t.kind !== "pragma");
      start = i + 1;
      const colonIndex = part.findIndex((t) => t.value === ":");
      if (colonIndex < 1) continue;
      const names = part
        .slice(0, colonIndex)
        .filter(
          (t) => t.kind === "word" && !["CONSTANT", "RETAIN", "PERSISTENT", "AT"].includes(t.value),
        );
      const at = part.findIndex((t) => t.value === "AT");
      const variables = at < 0 ? names : names.filter((t) => t.start < part[at]!.start);
      const initializer = part.findIndex((t, index) => index > colonIndex && t.value === ":=");
      const typeTokens = part.slice(colonIndex + 1, initializer < 0 ? undefined : initializer);
      const type = typeTokens.length
        ? object.declaration
            .slice(typeTokens[0]!.start, typeTokens.at(-1)!.end)
            .replace(/\s+/g, " ")
            .toUpperCase()
        : "";
      for (const name of variables)
        declarations.push({
          object,
          name: name.value,
          names: variables,
          colon: part[colonIndex]!,
          type,
        });
    }
    object.children.forEach(visit);
  };
  objects.forEach(visit);
  const edits = new Map<SourceObject, { start: number; end: number; text: string }[]>();
  for (const [symbol, binding] of Object.entries(bindings)) {
    const parts = symbol.toUpperCase().split(".");
    if (parts.length > 2)
      throw new Error(`${symbol}: direct IO maps a scalar declaration, not a nested field.`);
    const matches = declarations.filter(
      (d) =>
        d.name === parts.at(-1) && (parts.length === 1 || d.object.name.toUpperCase() === parts[0]),
    );
    if (matches.length !== 1)
      throw new Error(
        `${symbol}: expected one ST variable declaration, found ${matches.length}. Use Object.Variable to disambiguate.`,
      );
    const declaration = matches[0]!;
    if (declaration.names.length !== 1)
      throw new Error(`${symbol}: declare mapped IO variables separately.`);
    const declared = layout(declaration.type);
    if (
      !widths[declared.element] ||
      (declared.length > 1 && declared.element === "BOOL") ||
      binding.address[2] !== widths[declared.element]
    )
      throw new Error(`${symbol}: ${declaration.type} is incompatible with ${binding.address}.`);
    const expected = binding.type && layout(binding.type.replace(/\s+/g, " ").toUpperCase());
    if (expected && (expected.element !== declared.element || expected.length !== declared.length))
      throw new Error(`${symbol}: expected ${binding.type}, found ${declaration.type}.`);
    const list = edits.get(declaration.object) ?? [];
    const start = declaration.names[0]!.end;
    if (list.some((e) => e.start === start))
      throw new Error(`${symbol}: the variable has more than one IO binding.`);
    list.push({ start, end: declaration.colon.start, text: ` AT ${binding.address} ` });
    edits.set(declaration.object, list);
  }
  for (const [object, list] of edits)
    for (const edit of list.sort((a, b) => b.start - a.start))
      object.declaration =
        object.declaration.slice(0, edit.start) + edit.text + object.declaration.slice(edit.end);
}
