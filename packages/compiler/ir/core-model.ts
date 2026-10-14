import type { SourceSpan } from "./diagnostics.ts";
import type { Variable, Constant, BinaryOperator, FunctionBlock, PlcProgram } from "./model.ts";
import type { PlcType } from "./types.ts";

// Core expressions contain no source-level calls. Their effects have already
// become ordered statements, and every place has passed storage/bounds checks.
export type CorePath = readonly (
  | { readonly kind: "field"; readonly name: string }
  | { readonly kind: "index"; readonly value: CoreExpression }
)[];
export interface CheckedPlace {
  readonly root: string;
  readonly path: CorePath;
}
export type CoreExpression = { readonly type: string; readonly span: SourceSpan } & (
  | { readonly kind: "borrow"; readonly place: CheckedPlace }
  | { readonly kind: "constant"; readonly value: Constant }
  | { readonly kind: "load"; readonly root: string; readonly path?: CorePath }
  | {
      readonly kind: "unary";
      readonly operator: "not" | "negate" | "bitNot" | "timeToMilliseconds";
      readonly operand: CoreExpression;
    }
  | {
      readonly kind: "binary";
      readonly operator: BinaryOperator;
      readonly left: CoreExpression;
      readonly right: CoreExpression;
      readonly policy?: "wrap" | "saturate";
    }
  | {
      readonly kind: "convert";
      readonly operand: CoreExpression;
      readonly policy: "exact" | "wrap" | "saturate";
    }
);
export type CoreStatement = { readonly span: SourceSpan } & (
  | {
      readonly kind: "assign";
      readonly root: string;
      readonly path?: CorePath;
      readonly value: CoreExpression;
    }
  | {
      readonly kind: "if";
      readonly condition: CoreExpression;
      readonly then: readonly CoreStatement[];
      readonly else: readonly CoreStatement[];
    }
  | {
      readonly kind: "switch";
      readonly value: CoreExpression;
      readonly cases: readonly { values: readonly Constant[]; body: readonly CoreStatement[] }[];
      readonly fallback: readonly CoreStatement[];
    }
  | {
      readonly kind: "for";
      readonly counter: string;
      readonly counterScope?: "existing";
      readonly start: Constant;
      readonly limit: Constant;
      readonly step: string;
      readonly maxIterations: number;
      readonly body: readonly CoreStatement[];
    }
  | {
      readonly kind: "invoke";
      readonly function: string;
      readonly arguments: readonly CoreExpression[];
      readonly destination?: string;
    }
  | {
      readonly kind: "blockUpdate";
      readonly instance: string;
      readonly inputs: Readonly<Record<string, CoreExpression>>;
    }
  | { readonly kind: "return"; readonly value?: CoreExpression }
  | { readonly kind: "break" | "continue" }
);
export interface CoreFunction {
  readonly id: string;
  readonly name: string;
  readonly parameters: readonly Variable[];
  readonly result?: string;
  readonly locals: readonly Variable[];
  readonly body: readonly CoreStatement[];
  readonly span: SourceSpan;
}
export interface CoreFunctionBlock extends Readonly<Omit<FunctionBlock, "body">> {
  readonly body: readonly CoreStatement[];
}
export const verified: unique symbol = Symbol("verified core");
export interface VerifiedCoreModule {
  readonly [verified]: true;
  readonly types: readonly PlcType[];
  readonly variables: readonly Variable[];
  readonly functions: readonly CoreFunction[];
  readonly blocks: readonly CoreFunctionBlock[];
  readonly programs: readonly PlcProgram[];
}
