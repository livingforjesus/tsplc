import type { SourceObject } from "./sources.ts";
import { tokenize, type Token } from "./st/lexer.ts";
import { variableSections } from "./st/declarations.ts";

export interface DirectIoBinding {
  address: string;
  type?: string;
}
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
      for (const name of variables)
        declarations.push({
          object,
          name: name.value,
          names: variables,
          colon: part[colonIndex]!,
          type: part[colonIndex + 1]?.value ?? "",
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
    if (!widths[declaration.type] || binding.address[2] !== widths[declaration.type])
      throw new Error(`${symbol}: ${declaration.type} is incompatible with ${binding.address}.`);
    if (binding.type && binding.type.toUpperCase() !== declaration.type)
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
