import { beforeAll, describe, expect, it } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createOnigScanner, createOnigString, loadWASM } from "vscode-oniguruma";
import { type IGrammar, INITIAL, parseRawGrammar, Registry } from "vscode-textmate";

let grammar: IGrammar;

beforeAll(async () => {
  const wasm = await readFile(
    fileURLToPath(import.meta.resolve("vscode-oniguruma/release/onig.wasm")),
  );
  await loadWASM(wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength));
  const grammarPath = join(import.meta.dir, "../syntaxes/codesys-st.tmLanguage.json");
  const raw = parseRawGrammar(await readFile(grammarPath, "utf8"), grammarPath);
  const registry = new Registry({
    onigLib: Promise.resolve({ createOnigScanner, createOnigString }),
    loadGrammar: async (scope) => (scope === raw.scopeName ? raw : null),
  });
  const loaded = await registry.loadGrammar(raw.scopeName);
  if (!loaded) throw new Error("Structured Text grammar did not load");
  grammar = loaded;
});

const tokenize = (lines: string[]) => {
  let stack = INITIAL;
  return lines.map((line) => {
    const result = grammar.tokenizeLine(line, stack);
    stack = result.ruleStack;
    return result.tokens.map((token) => ({
      text: line.slice(token.startIndex, token.endIndex),
      scopes: token.scopes,
    }));
  });
};

describe("adversarial syntax highlighting", () => {
  it("keeps nested block comments active until the outer terminator", () => {
    const tokens = tokenize(["(* outer (* nested *)", "END_VAR", "*) PROGRAM Main"]);
    const middle = tokens[1]?.find(({ text }) => text.includes("END_VAR"));
    expect(middle?.scopes.some((scope) => scope.startsWith("comment."))).toBe(true);
    const program = tokens[2]?.find(({ text }) => text === "PROGRAM");
    expect(program?.scopes.some((scope) => scope.startsWith("keyword."))).toBe(true);
    expect(program?.scopes.some((scope) => scope.startsWith("comment."))).toBe(false);
  });

  it.each(["'text $' END_VAR $' still text'", '"text $" END_VAR $" still text"'])(
    "does not end strings on IEC escaped quotes in %s",
    (literal) => {
      const tokens = tokenize([`Message := ${literal}; END_IF;`])[0] ?? [];
      const internal = tokens.find(({ text }) => text.includes("END_VAR"));
      expect(internal?.scopes.some((scope) => scope.startsWith("string."))).toBe(true);
      const ending = tokens.find(({ text }) => text === "END_IF");
      expect(ending?.scopes.some((scope) => scope.startsWith("keyword."))).toBe(true);
    },
  );

  it("does not highlight keyword prefixes inside variable names", () => {
    const tokens = tokenize(["END_Value := VAR_FUTURE;"])[0] ?? [];
    for (const token of tokens.filter(({ text }) => /END_Value|VAR_FUTURE/.test(text))) {
      expect(token.scopes.some((scope) => scope.startsWith("keyword."))).toBe(false);
    }
  });

  it("highlights lowercase control flow as keywords", () => {
    const tokens = tokenize(["if Enabled then return; end_if;"])[0] ?? [];
    for (const keyword of ["if", "then", "return", "end_if"]) {
      expect(
        tokens
          .find(({ text }) => text === keyword)
          ?.scopes.some((scope) => scope.startsWith("keyword.")),
      ).toBe(true);
    }
  });

  it("keeps fake declarations inside line comments", () => {
    const tokens = tokenize(["// PROGRAM Fake VAR_INPUT Secret : BOOL;"])[0] ?? [];
    expect(tokens.every(({ scopes }) => scopes.some((scope) => scope.startsWith("comment.")))).toBe(
      true,
    );
  });

  it("does not let an unterminated single-line comment consume the next line", () => {
    const tokens = tokenize(["// comment", "FUNCTION Read : INT"]);
    expect(
      tokens[1]
        ?.find(({ text }) => text === "FUNCTION")
        ?.scopes.some((scope) => scope.startsWith("keyword.")),
    ).toBe(true);
  });
});
