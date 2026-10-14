import type { TextDocument } from "vscode-languageserver-textdocument";
import { type Diagnostic, DiagnosticSeverity } from "vscode-languageserver-types";
import type { Span, Token } from "./model";

export const diagnostic = (
  document: TextDocument,
  span: Span,
  code: string,
  message: string,
  severity: DiagnosticSeverity = DiagnosticSeverity.Error,
): Diagnostic => ({
  range: {
    start: document.positionAt(span.start),
    end: document.positionAt(Math.max(span.start, span.end)),
  },
  code,
  message,
  severity,
  source: "codesys-st",
});

/** Offsets are JavaScript UTF-16 offsets, the same units used by LSP. Never strip a BOM. */
export const lex = (document: TextDocument) => {
  const source = document.getText();
  const tokens: Token[] = [];
  const trivia: Token[] = [];
  const diagnostics: Diagnostic[] = [];
  let offset = 0;
  let unterminated = false;
  const push = (kind: Token["kind"], start: number) => {
    const text = source.slice(start, offset);
    const token: Token = {
      kind,
      text,
      upper: text.toUpperCase(),
      start,
      end: offset,
      ...(unterminated ? { unterminated: true } : {}),
    };
    (kind === "comment" || kind === "pragma" ? trivia : tokens).push(token);
  };
  const fail = (start: number, message: string) => {
    unterminated = message.startsWith("Unterminated");
    diagnostics.push(diagnostic(document, { start, end: offset }, "syntax", message));
  };
  const quote = () => {
    const start = offset;
    const delimiter = source[offset++];
    while (offset < source.length) {
      if (source[offset] === "$") {
        offset = Math.min(source.length, offset + 2);
      } else if (source[offset++] === delimiter) {
        return;
      }
    }
    fail(start, "Unterminated string literal.");
  };
  while (offset < source.length) {
    unterminated = false;
    const start = offset;
    const char = source[offset] ?? "";
    if (/\s|\uFEFF/.test(char)) {
      offset++;
      continue;
    }
    if (source.startsWith("//", offset)) {
      while (offset < source.length && !/[\r\n]/.test(source[offset] ?? "")) {
        offset++;
      }
      push("comment", start);
      continue;
    }
    if (source.startsWith("(*", offset)) {
      offset += 2;
      let depth = 1;
      while (offset < source.length && depth > 0) {
        if (source.startsWith("(*", offset)) {
          depth++;
          offset += 2;
        } else if (source.startsWith("*)", offset)) {
          depth--;
          offset += 2;
        } else {
          offset++;
        }
      }
      if (depth > 0) {
        fail(start, "Unterminated block comment.");
      }
      push("comment", start);
      continue;
    }
    if (char === "{") {
      offset++;
      while (offset < source.length && source[offset] !== "}") {
        if (source[offset] === "'" || source[offset] === '"') {
          quote();
        } else {
          offset++;
        }
      }
      if (offset === source.length) {
        fail(start, "Unterminated pragma.");
      } else {
        offset++;
      }
      push("pragma", start);
      continue;
    }
    if (char === "'" || char === '"') {
      quote();
      push("string", start);
      continue;
    }
    const rest = source.slice(offset);
    const address = /^%[IQM](?:[XBWDL])?(?:\d+(?:\.\d+)*|\*)/i.exec(rest)?.[0];
    if (address) {
      offset += address.length;
      push("address", start);
      continue;
    }
    const refOperator = /^(?:REF=|S=|R=)/i.exec(rest)?.[0];
    if (refOperator) {
      offset += refOperator.length;
      push("symbol", start);
      continue;
    }
    const prefix = /^[A-Za-z_][A-Za-z_\d]*#/.exec(rest)?.[0];
    if (prefix) {
      offset += prefix.length;
      if (source[offset] === "'" || source[offset] === '"') {
        quote();
      } else {
        const temporal =
          /^(?:L?TIME|L?T|L?DATE|L?D|L?TIME_OF_DAY|L?TOD|L?DATE_AND_TIME|L?DT)#$/i.test(prefix);
        const literal = (
          temporal
            ? /^-?[0-9][0-9a-zA-Z_:.-]*/
            : /^(?:[+-]?(?:(?:2|8|16)#[0-9a-fA-F_]+|\d[\d_]*(?:\.(?!\.)[\d_]*)?(?:[eE][+-]?[\d_]+)?)|TRUE\b|FALSE\b)/i
        ).exec(source.slice(offset))?.[0];
        if (literal) {
          offset += literal.length;
        } else {
          fail(start, "Expected a value after the literal type prefix.");
        }
      }
      push("number", start);
      continue;
    }
    const number =
      /^(?:(?:2|8|16)#[0-9a-fA-F_]+|\d[\d_]*(?:\.(?!\.)[\d_]+)?(?:[eE][+-]?[\d_]+)?)/.exec(
        rest,
      )?.[0];
    if (number) {
      offset += number.length;
      push("number", start);
      continue;
    }
    const word = /^[A-Za-z_][A-Za-z_\d]*/.exec(rest)?.[0];
    if (word) {
      offset += word.length;
      push("word", start);
      continue;
    }
    const pair = source.slice(offset, offset + 2);
    offset += [":=", "=>", "..", "<=", ">=", "<>", "**"].includes(pair) ? 2 : 1;
    push("symbol", start);
  }
  tokens.push({
    kind: "eof",
    text: "",
    upper: "",
    start: source.length,
    end: source.length,
  });
  return { tokens, trivia, diagnostics };
};
