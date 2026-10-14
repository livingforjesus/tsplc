import type { TextDocument } from "vscode-languageserver-textdocument";
import type { Diagnostic } from "vscode-languageserver-types";

export type Span = { start: number; end: number };
export type Token = Span & {
  kind: "word" | "number" | "string" | "symbol" | "comment" | "pragma" | "address" | "eof";
  text: string;
  upper: string;
  unterminated?: boolean;
};
export type TypeNode = Span &
  (
    | { kind: "named"; name: string }
    | { kind: "pointer" | "reference"; target: TypeNode }
    | {
        kind: "array";
        element: TypeNode;
        bounds: { low?: Expr; high?: Expr }[];
      }
    | { kind: "string"; wide: boolean; length?: Expr }
    | { kind: "subrange"; base: TypeNode; low: Expr; high: Expr }
    | { kind: "unknown" }
  );
export type Argument = Span & {
  name?: Token;
  direction?: ":=" | "=>";
  value: Expr;
};
export type Expr = Span &
  (
    | { kind: "name"; token: Token }
    | { kind: "literal"; token: Token }
    | { kind: "member"; object: Expr; member: Token }
    | { kind: "index"; object: Expr; indices: Expr[] }
    | { kind: "deref"; object: Expr }
    | { kind: "call"; callee: Expr; args: Argument[] }
    | { kind: "unary"; operator: Token; operand: Expr }
    | { kind: "binary"; operator: Token; left: Expr; right: Expr }
    | { kind: "aggregate"; values: Argument[] }
    | { kind: "missing" }
  );
export type Statement = Span &
  (
    | { kind: "assign"; target: Expr; value: Expr; operator: Token }
    | { kind: "expression"; expression: Expr }
    | { kind: "condition"; expression: Expr }
    | { kind: "for"; variable: Expr; from: Expr; to: Expr; step?: Expr }
    | { kind: "case"; expression: Expr; labels: Expr[] }
  );
export type SymbolKind =
  | "program"
  | "functionBlock"
  | "function"
  | "method"
  | "property"
  | "interface"
  | "struct"
  | "union"
  | "enum"
  | "alias"
  | "gvl"
  | "variable"
  | "enumMember"
  | "action";
export type StSymbol = Span & {
  id: string;
  uri: string;
  name: string;
  nameSpan: Span;
  kind: SymbolKind;
  type: TypeNode;
  members: StSymbol[];
  section: string;
  modifiers: string[];
  attributes: string[];
  bases: TypeNode[];
  interfaces: TypeNode[];
  documentation: string;
  initializer?: Expr;
  address?: Token;
};
export type ParsedFile = {
  document: TextDocument;
  tokens: Token[];
  trivia: Token[];
  diagnostics: Diagnostic[];
  symbol?: StSymbol;
  locals: StSymbol[];
  statements: Statement[];
  typeUses: TypeNode[];
};
export const key = (name: string): string => name.toUpperCase();
export const namedType = (name: string, span: Span = { start: 0, end: 0 }): TypeNode => ({
  kind: "named",
  name,
  ...span,
});
export const unknownType: TypeNode = { kind: "unknown", start: 0, end: 0 };
export const voidType = namedType("VOID");
export const variableSections = new Set([
  "VAR",
  "VAR_INPUT",
  "VAR_OUTPUT",
  "VAR_IN_OUT",
  "VAR_TEMP",
  "VAR_STAT",
  "VAR_INST",
  "VAR_EXTERNAL",
  "VAR_ACCESS",
  "VAR_GENERIC",
  "VAR_GLOBAL",
  "VAR_CONFIG",
]);
export const modifiers = new Set([
  "PUBLIC",
  "PRIVATE",
  "PROTECTED",
  "INTERNAL",
  "ABSTRACT",
  "FINAL",
  "OVERRIDE",
]);
export const qualifiers = new Set(["CONSTANT", "RETAIN", "NON_RETAIN", "PERSISTENT"]);
export const objectKinds: Record<string, SymbolKind> = {
  PROGRAM: "program",
  FUNCTION_BLOCK: "functionBlock",
  FUNCTION: "function",
  METHOD: "method",
  PROPERTY: "property",
  INTERFACE: "interface",
};
export const keywords = new Set([
  ...Object.keys(objectKinds),
  ...Object.keys(objectKinds).map((name) => `END_${name}`),
  ...variableSections,
  ...modifiers,
  ...qualifiers,
  "TYPE",
  "END_TYPE",
  "STRUCT",
  "END_STRUCT",
  "UNION",
  "END_UNION",
  "END_VAR",
  "EXTENDS",
  "IMPLEMENTS",
  "IF",
  "THEN",
  "ELSIF",
  "ELSE",
  "END_IF",
  "CASE",
  "OF",
  "END_CASE",
  "FOR",
  "TO",
  "BY",
  "DO",
  "END_FOR",
  "WHILE",
  "END_WHILE",
  "REPEAT",
  "UNTIL",
  "END_REPEAT",
  "EXIT",
  "CONTINUE",
  "RETURN",
  "AND",
  "AND_THEN",
  "OR",
  "OR_ELSE",
  "XOR",
  "NOT",
  "MOD",
  "ARRAY",
  "POINTER",
  "REFERENCE",
  "REF_TO",
  "AT",
  "TRUE",
  "FALSE",
  "THIS",
  "SUPER",
  "REF=",
  "S=",
  "R=",
]);
