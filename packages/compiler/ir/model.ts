import type { SourceSpan, Diagnostic } from "./diagnostics.ts";
import type { PlcType, SymbolId, TypeId } from "./types.ts";

export type Constant =
  | { kind: "bool"; value: boolean }
  | { kind: "integer"; value: string }
  | { kind: "float"; value: number }
  | { kind: "duration"; nanoseconds: string }
  | { kind: "calendar"; value: string }
  | { kind: "string"; value: string }
  | { kind: "array"; items: readonly Constant[] }
  | { kind: "record"; fields: Readonly<Record<string, Constant>> };

export interface Variable {
  id: SymbolId;
  name: string;
  type: TypeId;
  storage:
    | "module"
    | "local"
    | "parameter"
    | "input"
    | "output"
    | "field"
    | "instance"
    | "constant"
    | "blockOutput";
  mutable: boolean;
  retain: boolean;
  mode?: "inOut";
  initial?: Constant;
  span: SourceSpan;
}

export interface Place {
  root: SymbolId;
  path: readonly ({ kind: "field"; name: string } | { kind: "index"; value: Expression })[];
}

export type BinaryOperator =
  | "add"
  | "subtract"
  | "multiply"
  | "divide"
  | "remainder"
  | "equal"
  | "notEqual"
  | "less"
  | "lessEqual"
  | "greater"
  | "greaterEqual"
  | "and"
  | "or"
  | "bitAnd"
  | "bitOr"
  | "bitXor"
  | "shiftLeft"
  | "shiftRight";

export const comparisonOperators: ReadonlySet<BinaryOperator> = new Set([
  "equal",
  "notEqual",
  "less",
  "lessEqual",
  "greater",
  "greaterEqual",
]);

export type Expression = { type: TypeId; span: SourceSpan } & (
  | { kind: "constant"; value: Constant }
  | { kind: "load"; place: Place }
  | {
      kind: "unary";
      operator: "not" | "negate" | "bitNot" | "timeToMilliseconds";
      operand: Expression;
    }
  | {
      kind: "binary";
      operator: BinaryOperator;
      left: Expression;
      right: Expression;
      policy?: "wrap" | "saturate";
    }
  | { kind: "call"; function: SymbolId; arguments: readonly Expression[] }
  | { kind: "conditional"; condition: Expression; then: Expression; else: Expression }
  | { kind: "convert"; operand: Expression; policy: "exact" | "wrap" | "saturate" }
  | { kind: "borrow"; place: Place }
  | { kind: "length"; operand: Expression }
  | { kind: "copy"; operand: Expression }
  | { kind: "record"; fields: Readonly<Record<string, Expression>> }
  | { kind: "array"; items: readonly Expression[] }
);

export type Statement = { span: SourceSpan } & (
  | { kind: "assign"; destination: Place; value: Expression }
  | { kind: "if"; condition: Expression; then: readonly Statement[]; else: readonly Statement[] }
  | {
      kind: "switch";
      value: Expression;
      cases: readonly { values: readonly Constant[]; body: readonly Statement[] }[];
      fallback: readonly Statement[];
    }
  | {
      kind: "for";
      counter: SymbolId;
      /** Existing storage remains observable after the loop exits. */
      counterScope?: "existing";
      start: Expression;
      limit: Expression;
      step: string;
      maxIterations: number;
      body: readonly Statement[];
    }
  | { kind: "invoke"; function: SymbolId; arguments: readonly Expression[]; destination?: Place }
  | { kind: "blockUpdate"; instance: SymbolId; inputs: Readonly<Record<string, Expression>> }
  | { kind: "return"; value?: Expression }
  | { kind: "break" | "continue" }
);

export interface PlcFunction {
  id: SymbolId;
  name: string;
  parameters: readonly Variable[];
  locals: readonly Variable[];
  result?: TypeId;
  body: readonly Statement[];
  span: SourceSpan;
}

// Canonical standard block interfaces as [name, type] pairs. Every output
// starts FALSE or T#0s, matching the vendor library blocks.
const timerBlock = {
  inputs: [
    ["IN", "BOOL"],
    ["PT", "TIME"],
  ],
  outputs: [
    ["Q", "BOOL"],
    ["ET", "TIME"],
  ],
} as const;
const triggerBlock = { inputs: [["CLK", "BOOL"]], outputs: [["Q", "BOOL"]] } as const;
export const standardBlocks = {
  TON: timerBlock,
  TOF: timerBlock,
  TP: timerBlock,
  R_TRIG: triggerBlock,
  F_TRIG: triggerBlock,
  BLINK: {
    inputs: [
      ["ENABLE", "BOOL"],
      ["TIMELOW", "TIME"],
      ["TIMEHIGH", "TIME"],
    ],
    outputs: [["OUT", "BOOL"]],
  },
} as const;
export type StandardBlock = keyof typeof standardBlocks;

export interface FunctionBlock {
  id: SymbolId;
  name: string;
  inputs: readonly Variable[];
  outputs: readonly Variable[];
  state: readonly Variable[];
  locals: readonly Variable[];
  body: readonly Statement[];
  result?: TypeId;
  standard?: StandardBlock;
  span: SourceSpan;
}

export interface PlcProgram {
  id: SymbolId;
  name: string;
  entry: SymbolId;
}

export interface PlcModule {
  types: readonly PlcType[];
  variables: readonly Variable[];
  functions: readonly PlcFunction[];
  blocks: readonly FunctionBlock[];
  programs: readonly PlcProgram[];
}

export interface Task {
  name: string;
  intervalNanoseconds: string;
  priority: number;
  programs: readonly string[];
}

export interface Deployment {
  tasks: readonly Task[];
}

export interface Artifact {
  path: string;
  content: string;
}

export interface GeneratedObject {
  sourcePath?: string;
  id: SymbolId;
  kind: "program" | "function" | "functionBlock" | "globalList" | "dataType";
  name: string;
  declaration: string;
  implementation?: string;
}

export interface EmitResult {
  artifacts: readonly Artifact[];
  objects: readonly GeneratedObject[];
  diagnostics: readonly Diagnostic[];
}
