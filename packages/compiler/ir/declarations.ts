import type { SourceSpan } from "./diagnostics.ts";
import {
  standardBlocks,
  type PlcModule,
  type Variable,
  type FunctionBlock,
  type PlcFunction,
} from "./model.ts";
import type { PlcType } from "./types.ts";
import { layoutIssue, valueFits } from "./aggregates.ts";
import { reject } from "./normalization-error.ts";

// This index owns the module namespace and storage declarations. Routine
// lowering may claim temporary identifiers, but cannot weaken admission rules.
export class ModuleDeclarations {
  private readonly ids = new Set<string>();
  readonly types = new Map<string, PlcType>();
  readonly globals = new Map<string, Variable>();
  readonly blocks: Map<string, FunctionBlock>;
  readonly signatures: Map<string, PlcFunction>;

  constructor(module: PlcModule) {
    for (const type of module.types) {
      if (this.types.has(type.id)) reject(`Duplicate type ${type.id}.`);
      this.types.set(type.id, type);
    }
    const invalidLayout = layoutIssue(this.types);
    if (invalidLayout) reject(invalidLayout);
    if (this.types.get("BOOL")?.kind !== "bool") reject("Missing canonical BOOL type.");

    this.blocks = new Map(module.blocks.map((block) => [block.id, block]));
    for (const item of module.variables) {
      this.checkVariable(item, ["module", "instance", "input", "output", "constant"]);
      this.globals.set(item.id, item);
    }

    this.signatures = new Map(module.functions.map((fn) => [fn.id, fn]));
    for (const fn of module.functions) {
      this.claimId(fn.id, fn.span);
      if (fn.result && !this.isValueType(fn.result))
        reject("Unknown or non-value function result type.", fn.span);
      for (const parameter of fn.parameters) {
        this.checkVariable(parameter, ["parameter"]);
        if (parameter.mutable) reject("Value parameters are readonly.", parameter.span);
      }
      for (const local of fn.locals) this.checkVariable(local, ["local"]);
    }

    for (const block of module.blocks) {
      this.claimId(block.id, block.span);
      for (const input of block.inputs) {
        this.checkVariable(input, ["parameter"], true);
        if (!input.mode && input.mutable) reject("Value block inputs are readonly.", input.span);
      }
      for (const output of block.outputs) this.checkVariable(output, ["blockOutput"]);
      for (const state of block.state) this.checkVariable(state, ["field", "instance"]);
      for (const local of block.locals) this.checkVariable(local, ["local"]);
      for (const ports of [block.inputs, block.outputs]) {
        if (new Set(ports.map((variable) => variable.name)).size !== ports.length)
          reject(
            "Block input and output names must each be unique within their schema.",
            block.span,
          );
      }
      const result = block.result ? this.types.get(block.result) : undefined;
      if (
        block.outputs.length
          ? result?.kind !== "record" ||
            !this.isValueType(result.id) ||
            result.fields.length !== block.outputs.length ||
            result.fields.some(
              (field) =>
                !block.outputs.some(
                  (output) => output.name === field.name && output.type === field.type,
                ),
            )
          : Boolean(block.result)
      )
        reject("Block output schema differs from its result record.", block.span);
      if (block.standard) {
        const expected = Object.hasOwn(standardBlocks, block.standard)
          ? standardBlocks[block.standard]
          : undefined;
        const matches = (
          variables: readonly Variable[],
          schema: readonly (readonly [string, string])[],
        ): boolean =>
          variables.length === schema.length &&
          schema.every(([name, type]) =>
            variables.some(
              (variable) =>
                variable.name === name &&
                variable.type === type &&
                !variable.mode &&
                !variable.retain,
            ),
          );
        if (
          !expected ||
          block.name !== block.standard ||
          block.body.length ||
          block.state.length ||
          block.locals.length ||
          !matches(block.inputs, expected.inputs) ||
          !matches(block.outputs, expected.outputs) ||
          block.outputs.some((output) =>
            output.type === "BOOL"
              ? output.initial?.kind !== "bool" || output.initial.value !== false
              : output.initial?.kind !== "duration" || output.initial.nanoseconds !== "0",
          )
        )
          reject("Invalid canonical standard block definition.", block.span);
      }
    }

    for (const type of this.types.values())
      if (type.kind === "block") {
        const definition = this.blocks.get(type.block);
        if (!definition || definition.result !== type.output)
          reject("Block type differs from its definition.");
      }
  }

  hasId(id: string): boolean {
    return this.ids.has(id);
  }

  public claimId(id: string, span?: SourceSpan): void {
    if (this.ids.has(id)) reject(`Duplicate symbol ${id}.`, span);
    this.ids.add(id);
  }

  public isValueType(id: string, seen = new Set<string>()): boolean {
    if (seen.has(id)) return true;
    seen.add(id);
    const type = this.types.get(id);
    return Boolean(
      type &&
      type.kind !== "block" &&
      (type.kind !== "record" ||
        type.fields.every((field) => !field.mode && this.isValueType(field.type, seen))) &&
      (type.kind !== "array" || this.isValueType(type.element, seen)),
    );
  }

  private checkVariable(
    item: Variable,
    storage: readonly Variable["storage"][],
    allowBorrow = false,
  ): void {
    this.claimId(item.id, item.span);
    const type = this.types.get(item.type);
    if (!type || !storage.includes(item.storage))
      reject("Invalid storage type or class.", item.span);
    if (
      item.mode &&
      (item.mode !== "inOut" || !allowBorrow || !item.mutable || item.storage !== "parameter")
    )
      reject("InOut belongs only on mutable block input parameters.", item.span);
    const mutableState =
      item.mutable ||
      type.kind === "array" ||
      (type.kind === "record" && type.fields.some((field) => !field.readonly));
    if (
      item.retain &&
      !(item.storage === "instance" || (["module", "field"].includes(item.storage) && mutableState))
    )
      reject("Only mutable static state or block instances may retain.", item.span);
    if (item.storage === "instance") {
      if (type.kind !== "block" || !this.blocks.has(type.block) || item.initial || item.mode)
        reject(
          "Instances require a known static block and cannot have value initializers.",
          item.span,
        );
    } else if (!this.isValueType(item.type))
      reject("Block instances and reference schemas cannot be stored as values.", item.span);
    if (item.storage === "parameter" && item.initial)
      reject(
        "Inputs are supplied at each invocation and cannot have stored initializers.",
        item.span,
      );
    if (item.initial && !valueFits(item.initial, type, this.types))
      reject("Initializer has the wrong type or is out of range.", item.span);
    if (["module", "field", "constant", "blockOutput"].includes(item.storage) && !item.initial)
      reject("Persistent storage requires initialization.", item.span);
    if (["input", "constant", "blockOutput"].includes(item.storage) && item.mutable)
      reject("Readonly storage marked mutable.", item.span);
  }
}
