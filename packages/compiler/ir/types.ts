export type TypeId = string;
export type SymbolId = string;

export interface Field {
  name: string;
  type: TypeId;
  readonly: boolean;
  mode?: "inOut";
}

export type PlcType =
  | { id: TypeId; kind: "bool" }
  | { id: TypeId; kind: "integer"; bits: 8 | 16 | 32 | 64; signed: boolean }
  | { id: TypeId; kind: "bits"; bits: 8 | 16 | 32 | 64 }
  | { id: TypeId; kind: "float"; bits: 32 | 64 }
  | { id: TypeId; kind: "duration" }
  | { id: TypeId; kind: "calendar"; domain: "date" | "timeOfDay" | "dateTime" }
  | { id: TypeId; kind: "string"; capacity: number; encoding: "utf8" | "utf16" }
  | { id: TypeId; kind: "array"; element: TypeId; length: number; lowerBound: number }
  | { id: TypeId; kind: "record"; fields: readonly Field[] }
  | { id: TypeId; kind: "enum"; base: TypeId; members: readonly { name: string; value: string }[] }
  | { id: TypeId; kind: "block"; block: SymbolId; output?: TypeId };

export const primitiveTypes: readonly PlcType[] = [
  { id: "BOOL", kind: "bool" },
  ...(
    [
      ["SINT", "USINT", "BYTE", 8],
      ["INT", "UINT", "WORD", 16],
      ["DINT", "UDINT", "DWORD", 32],
      ["LINT", "ULINT", "LWORD", 64],
    ] as const
  ).flatMap(([signed, unsigned, bitstring, bits]) => [
    { id: signed, kind: "integer" as const, bits, signed: true },
    { id: unsigned, kind: "integer" as const, bits, signed: false },
    { id: bitstring, kind: "bits" as const, bits },
  ]),
  { id: "REAL", kind: "float", bits: 32 },
  { id: "LREAL", kind: "float", bits: 64 },
  { id: "TIME", kind: "duration" },
  { id: "DATE", kind: "calendar", domain: "date" },
  { id: "TIME_OF_DAY", kind: "calendar", domain: "timeOfDay" },
  { id: "DATE_AND_TIME", kind: "calendar", domain: "dateTime" },
];

export function integerRange(
  type: Extract<PlcType, { kind: "integer" | "bits" }>,
): readonly [bigint, bigint] {
  const signed = type.kind === "integer" && type.signed;
  const limit = 1n << BigInt(type.bits - (signed ? 1 : 0));
  return signed ? [-limit, limit - 1n] : [0n, limit - 1n];
}
