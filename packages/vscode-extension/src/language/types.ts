import { type Expr, key, namedType, type TypeNode } from "./model";

export type Primitive = {
  family:
    | "bool"
    | "integer"
    | "bits"
    | "real"
    | "time"
    | "date"
    | "tod"
    | "datetime"
    | "void"
    | "generic";
  bits?: number;
  signed?: boolean;
};
export const primitives: Record<string, Primitive> = {
  BOOL: { family: "bool" },
  BIT: { family: "bool" },
  VOID: { family: "void" },
  SINT: { family: "integer", bits: 8, signed: true },
  USINT: { family: "integer", bits: 8, signed: false },
  INT: { family: "integer", bits: 16, signed: true },
  UINT: { family: "integer", bits: 16, signed: false },
  DINT: { family: "integer", bits: 32, signed: true },
  UDINT: { family: "integer", bits: 32, signed: false },
  LINT: { family: "integer", bits: 64, signed: true },
  ULINT: { family: "integer", bits: 64, signed: false },
  __XINT: { family: "integer", bits: 64, signed: true },
  __UXINT: { family: "integer", bits: 64, signed: false },
  __XWORD: { family: "bits", bits: 64, signed: false },
  BYTE: { family: "bits", bits: 8, signed: false },
  WORD: { family: "bits", bits: 16, signed: false },
  DWORD: { family: "bits", bits: 32, signed: false },
  LWORD: { family: "bits", bits: 64, signed: false },
  REAL: { family: "real", bits: 32 },
  LREAL: { family: "real", bits: 64 },
  TIME: { family: "time", bits: 32 },
  LTIME: { family: "time", bits: 64 },
  DATE: { family: "date", bits: 32 },
  LDATE: { family: "date", bits: 64 },
  TOD: { family: "tod", bits: 32 },
  TIME_OF_DAY: { family: "tod", bits: 32 },
  LTOD: { family: "tod", bits: 64 },
  LTIME_OF_DAY: { family: "tod", bits: 64 },
  DT: { family: "datetime", bits: 32 },
  DATE_AND_TIME: { family: "datetime", bits: 32 },
  LDT: { family: "datetime", bits: 64 },
  LDATE_AND_TIME: { family: "datetime", bits: 64 },
  ANY: { family: "generic" },
  ANY_NUM: { family: "generic" },
  ANY_INT: { family: "generic" },
  ANY_REAL: { family: "generic" },
  ANY_BIT: { family: "generic" },
  ANY_STRING: { family: "generic" },
  ANY_DATE: { family: "generic" },
  ANY_MAGNITUDE: { family: "generic" },
  ANY_ELEMENTARY: { family: "generic" },
  __ADDRESS: { family: "generic" },
};
export const integerRange = (type: TypeNode): [bigint, bigint] | undefined => {
  const primitive = type.kind === "named" ? primitives[key(type.name)] : undefined;
  if (!primitive?.bits || !["integer", "bits"].includes(primitive.family)) {
    return undefined;
  }
  const max = 2n ** BigInt(primitive.bits - Number(!!primitive.signed));
  return [primitive.signed ? -max : 0n, max - 1n];
};
export const integerLiteral = (text: string): bigint | undefined => {
  let value = text.replaceAll("_", "");
  value = value.replace(/^[A-Za-z][A-Za-z0-9]*#/, "");
  const sign = value.startsWith("-") ? -1n : 1n;
  value = value.replace(/^[+-]/, "");
  const based = /^(2|8|16)#(.+)$/.exec(value);
  if (based) {
    const base = Number(based[1]);
    const digits = based[2] ?? "";
    if (![...digits].every((c) => Number.parseInt(c, 16) < base)) {
      return undefined;
    }
    return (
      [...digits].reduce((n, c) => n * BigInt(base) + BigInt(Number.parseInt(c, 16)), 0n) * sign
    );
  }
  return /^\d+$/.test(value) ? BigInt(value) * sign : undefined;
};
export const literalType = (expr: Expr): TypeNode => {
  if (expr.kind !== "literal") {
    return namedType("VOID");
  }
  const text = expr.token.upper;
  if (["TRUE", "FALSE"].includes(text) || /^BOOL#/.test(text)) {
    return namedType("BOOL");
  }
  if (expr.token.kind === "address") {
    const size = text[2];
    return namedType(
      ({ X: "BOOL", B: "BYTE", W: "WORD", D: "DWORD", L: "LWORD" } as Record<string, string>)[
        size ?? ""
      ] ?? "BOOL",
    );
  }
  const prefix = /^([A-Z_][A-Z_\d]*)#/.exec(text)?.[1];
  if (expr.token.kind === "string" || prefix === "STRING" || prefix === "WSTRING") {
    return {
      kind: "string",
      wide: expr.token.text.startsWith('"') || prefix === "WSTRING",
      start: expr.start,
      end: expr.end,
    };
  }
  if (prefix) {
    return namedType(
      ({ T: "TIME", LT: "LTIME", D: "DATE", LD: "LDATE" } as Record<string, string>)[prefix] ??
        prefix,
    );
  }
  if (integerLiteral(text) !== undefined) {
    return namedType("__INTEGER_LITERAL");
  }
  return namedType("__REAL_LITERAL");
};
export const typeLabel = (type: TypeNode): string => {
  switch (type.kind) {
    case "named":
      return type.name;
    case "unknown":
      return "<unknown>";
    case "pointer":
      return `POINTER TO ${typeLabel(type.target)}`;
    case "reference":
      return `REFERENCE TO ${typeLabel(type.target)}`;
    case "array":
      return `ARRAY[${type.bounds.map((b) => (b.low && b.high ? `${exprLabel(b.low)}..${exprLabel(b.high)}` : "*")).join(", ")}] OF ${typeLabel(type.element)}`;
    case "string":
      return `${type.wide ? "WSTRING" : "STRING"}${type.length ? `(${exprLabel(type.length)})` : ""}`;
    case "subrange":
      return `${typeLabel(type.base)}(${exprLabel(type.low)}..${exprLabel(type.high)})`;
  }
};
export const exprLabel = (expr: Expr): string => {
  switch (expr.kind) {
    case "literal":
      return expr.token.text;
    case "name":
      return expr.token.text;
    case "unary":
      return `${expr.operator.text}${exprLabel(expr.operand)}`;
    case "binary":
      return `${exprLabel(expr.left)} ${expr.operator.text} ${exprLabel(expr.right)}`;
    case "member":
      return `${exprLabel(expr.object)}.${expr.member.text}`;
    default:
      return "…";
  }
};
