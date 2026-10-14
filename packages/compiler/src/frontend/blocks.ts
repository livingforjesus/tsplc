import ts from "typescript";
import {
  defaultValue,
  type FunctionBlock,
  type Variable,
  type SourceSpan,
  type PlcType,
} from "@vplc/compiler/ir";
import type { TypeResolver } from "./types.ts";

type Fail = (node: ts.Node, code: string, message: string) => never;
export interface BlockSource {
  block: FunctionBlock;
  method: ts.MethodDeclaration;
  inputSymbol: ts.Symbol;
  inputBindings: ReadonlyMap<string, Variable>;
  fieldBindings: ReadonlyMap<ts.Symbol, Variable>;
  initializers: ReadonlyMap<Variable, ts.Expression>;
}
export function storageInitializer(
  node: ts.Expression,
  types: TypeResolver,
  fail: Fail,
): { value: ts.Expression; retain: boolean } {
  if (
    !ts.isCallExpression(node) ||
    !(ts.isIdentifier(node.expression) || ts.isPropertyAccessExpression(node.expression)) ||
    types.sdkName(
      ts.isPropertyAccessExpression(node.expression) ? node.expression.name : node.expression,
    ) !== "retain"
  )
    return { value: node, retain: false };
  if (node.arguments.length !== 1 || (node.typeArguments?.length ?? 0) > 1)
    fail(node, "PLC3004", "retain requires one static storage initializer.");
  return { value: node.arguments[0]!, retain: true };
}

export class BlockResolver {
  readonly definitions = new Map<string, FunctionBlock>();
  readonly sources = new Map<ts.Symbol, BlockSource>();
  private readonly declarations = new Map<ts.Symbol, ts.ClassDeclaration>();
  private readonly active = new Set<ts.Symbol>();
  constructor(
    private readonly types: TypeResolver,
    private readonly origin: (node: ts.Node) => SourceSpan,
    private readonly fail: Fail,
    sdkSpan: SourceSpan,
  ) {
    for (const name of ["TON", "TOF", "TP", "R_TRIG", "F_TRIG", "BLINK"] as const) {
      const timer = ["TON", "TOF", "TP"].includes(name),
        id = `stdlib:${name}`,
        output = `${id}:out`;
      const inputTypes: readonly [string, string][] = timer
        ? [
            ["IN", "BOOL"],
            ["PT", "TIME"],
          ]
        : name === "BLINK"
          ? [
              ["ENABLE", "BOOL"],
              ["TIMELOW", "TIME"],
              ["TIMEHIGH", "TIME"],
            ]
          : [["CLK", "BOOL"]];
      const outputTypes: readonly [string, string][] = timer
        ? [
            ["Q", "BOOL"],
            ["ET", "TIME"],
          ]
        : [[name === "BLINK" ? "OUT" : "Q", "BOOL"]];
      const variable = (label: string, type: string, storage: Variable["storage"]): Variable => ({
        id: `${id}:${label}`,
        name: label,
        type,
        storage,
        mutable: false,
        retain: false,
        span: sdkSpan,
        ...(storage === "blockOutput" && { initial: defaultValue(type, types.types) }),
      });
      const block: FunctionBlock = {
        id,
        name,
        inputs: inputTypes.map(([label, type]) => variable(label, type, "parameter")),
        outputs: outputTypes.map(([label, type]) => variable(label, type, "blockOutput")),
        state: [],
        locals: [],
        body: [],
        result: output,
        standard: name,
        span: sdkSpan,
      };
      this.definitions.set(id, block);
      types.types.set(output, {
        id: output,
        kind: "record",
        fields: block.outputs.map((field) => ({
          name: field.name,
          type: field.type,
          readonly: true,
        })),
      });
      const type: PlcType = { id: `block:${id}`, kind: "block", block: id, output };
      types.types.set(type.id, type);
      types.standardTypes.set(name, type.id);
    }
  }

  index(nodes: readonly ts.ClassDeclaration[]): void {
    for (const node of nodes) {
      if (!node.name) this.fail(node, "PLC1001", "Function block classes need names.");
      this.declarations.set(this.types.symbol(node.name), node);
    }
  }

  instanceType(node: ts.NewExpression): string {
    if (
      node.arguments?.length ||
      node.typeArguments?.length ||
      !(ts.isIdentifier(node.expression) || ts.isPropertyAccessExpression(node.expression))
    )
      this.fail(
        node,
        "PLC1007",
        "Block instances use a concrete zero-argument constructor at static storage declarations.",
      );
    const name = ts.isPropertyAccessExpression(node.expression)
      ? node.expression.name
      : node.expression;
    const official = this.types.sdkName(name),
      standard = official && this.types.standardTypes.get(official);
    if (standard) return standard;
    const symbol = this.types.symbol(name),
      declaration = this.declarations.get(symbol);
    if (!declaration)
      this.fail(node, "PLC1007", "Only recognized static function block allocation is supported.");
    this.collect(declaration);
    // Successful collection registers this class identity before publishing its source.
    return this.types.blockTypes.get(symbol)!;
  }

  collect(node: ts.ClassDeclaration): void {
    if (!node.name) this.fail(node, "PLC1001", "Function block classes need names.");
    const symbol = this.types.symbol(node.name);
    if (this.sources.has(symbol)) return;
    if (this.active.has(symbol) || this.active.size >= 64)
      this.fail(node, "PLC1007", "Recursive or excessively nested block instance layout.");
    if (
      node.typeParameters?.length ||
      node.modifiers?.some(
        (modifier) =>
          modifier.kind === ts.SyntaxKind.Decorator ||
          modifier.kind === ts.SyntaxKind.AbstractKeyword,
      )
    )
      this.fail(
        node,
        "PLC1001",
        "Block classes are concrete; generic classes and decorators are unsupported.",
      );
    const heritage = node.heritageClauses;
    if (
      heritage?.length !== 1 ||
      heritage[0]?.token !== ts.SyntaxKind.ExtendsKeyword ||
      heritage[0].types.length !== 1
    )
      this.fail(
        node,
        "PLC1001",
        "Function block classes extend the canonical FunctionBlock marker only.",
      );
    const base = heritage[0].types[0]!;
    if (
      this.types.sdkName(base.expression) !== "FunctionBlock" ||
      !base.typeArguments ||
      base.typeArguments.length < 1 ||
      base.typeArguments.length > 2
    )
      this.fail(base, "PLC1001", "Extend FunctionBlock<Inputs, Outputs> with concrete schemas.");
    // Register identity before nested fields; the active set rejects recursive allocation.
    this.active.add(symbol);
    const id = this.types.id(node, node.name.text),
      typeId = `block:${id}`;
    this.types.types.set(typeId, { id: typeId, kind: "block", block: id });
    this.types.blockTypes.set(symbol, typeId);
    try {
      const inputFields = this.types.inputFields(base.typeArguments[0]!);
      let result: string | undefined;
      const outputNode = base.typeArguments[1];
      if (outputNode && !(ts.isTypeLiteralNode(outputNode) && !outputNode.members.length)) {
        const resolved = this.types.resolve(outputNode),
          layout = this.types.types.get(resolved.type);
        if (
          resolved.io ||
          resolved.mode ||
          this.types.hasReferences(resolved.type) ||
          layout?.kind !== "record"
        )
          this.fail(outputNode, "PLC2001", "Block outputs require a closed value record.");
        result = resolved.type;
      }
      const fieldBindings = new Map<ts.Symbol, Variable>(),
        initializers = new Map<Variable, ts.Expression>(),
        state: Variable[] = [];
      let method: ts.MethodDeclaration | undefined;
      for (const member of node.members) {
        if (ts.isMethodDeclaration(member)) {
          if (
            method ||
            !ts.isIdentifier(member.name) ||
            member.name.text !== "execute" ||
            !member.body ||
            member.asteriskToken ||
            member.modifiers?.some(
              (modifier) =>
                ![ts.SyntaxKind.ProtectedKeyword, ts.SyntaxKind.OverrideKeyword].includes(
                  modifier.kind,
                ),
            ) ||
            !member.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ProtectedKeyword)
          )
            this.fail(
              member,
              "PLC1001",
              "A block implements one protected execute method; other methods are unsupported.",
            );
          method = member;
          continue;
        }
        const field = this.collectStateField(member, id);
        state.push(field.variable);
        fieldBindings.set(field.symbol, field.variable);
        if (field.initializer) initializers.set(field.variable, field.initializer);
      }
      if (method?.parameters.length !== 1 || method.typeParameters?.length)
        this.fail(node, "PLC1001", "Block execute requires one concrete input record parameter.");
      const parameter = method.parameters[0]!;
      if (
        !ts.isIdentifier(parameter.name) ||
        !parameter.type ||
        parameter.initializer ||
        parameter.questionToken ||
        parameter.dotDotDotToken
      )
        this.fail(
          parameter,
          "PLC2001",
          "Block execute requires one named, explicitly typed input parameter.",
        );
      const methodFields = this.types.inputFields(parameter.type);
      if (JSON.stringify(methodFields) !== JSON.stringify(inputFields))
        this.fail(
          parameter,
          "PLC2001",
          "execute input schema differs from its FunctionBlock marker.",
        );
      if (
        !method.type ||
        (result
          ? this.types.resolve(method.type).type !== result
          : method.type.kind !== ts.SyntaxKind.VoidKeyword)
      )
        this.fail(
          method,
          "PLC2001",
          "execute return annotation must match the complete output record, or void when there are no outputs.",
        );
      const inputs = inputFields.map((field) => ({
        id: `${id}:input:${field.name}`,
        name: field.name,
        type: field.type,
        storage: "parameter" as const,
        mutable: field.mode === "inOut",
        retain: false,
        span: this.origin(parameter),
        ...(field.mode && { mode: field.mode }),
      }));
      const outputType = result && this.types.types.get(result),
        outputs: Variable[] =
          outputType && outputType.kind === "record"
            ? outputType.fields.map((field) => ({
                id: `${id}:output:${field.name}`,
                name: field.name,
                type: field.type,
                storage: "blockOutput",
                mutable: false,
                retain: false,
                initial: defaultValue(field.type, this.types.types),
                span: this.origin(method!),
              }))
            : [];
      const block: FunctionBlock = {
        id,
        name: node.name.text,
        inputs,
        outputs,
        state,
        locals: [],
        body: [],
        span: this.origin(node),
        ...(result && { result }),
      };
      this.definitions.set(id, block);
      this.types.types.set(typeId, {
        id: typeId,
        kind: "block",
        block: id,
        ...(result && { output: result }),
      });
      this.sources.set(symbol, {
        block,
        method,
        inputSymbol: this.types.symbol(parameter.name),
        inputBindings: new Map(inputs.map((variable) => [variable.name, variable])),
        fieldBindings,
        initializers,
      });
    } finally {
      this.active.delete(symbol);
    }
  }
  // Private state fields own storage admission, constructor allocation and initializer capture.
  // The enclosing collection keeps schema/execute validation separate from this field policy.
  private collectStateField(
    member: ts.ClassElement,
    id: string,
  ): {
    variable: Variable;
    symbol: ts.Symbol;
    initializer?: ts.Expression;
  } {
    if (
      !ts.isPropertyDeclaration(member) ||
      !ts.isIdentifier(member.name) ||
      !member.initializer ||
      member.questionToken ||
      member.exclamationToken ||
      !member.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.PrivateKeyword) ||
      member.modifiers.some(
        (modifier) =>
          ![ts.SyntaxKind.PrivateKeyword, ts.SyntaxKind.ReadonlyKeyword].includes(modifier.kind),
      )
    )
      this.fail(
        member,
        "PLC1001",
        "Block state uses private initialized instance fields; constructors, static fields and decorators are unsupported.",
      );
    const initial = storageInitializer(member.initializer, this.types, this.fail);
    let type: string;
    if (ts.isNewExpression(initial.value)) type = this.instanceType(initial.value);
    else if (member.type) {
      const annotation = this.types.resolve(member.type);
      if (annotation.io || annotation.mode || this.types.hasReferences(annotation.type))
        this.fail(member, "PLC2001", "Borrow and I/O wrappers cannot be stored in block state.");
      type = annotation.type;
    } else if (
      initial.value.kind === ts.SyntaxKind.TrueKeyword ||
      initial.value.kind === ts.SyntaxKind.FalseKeyword
    )
      type = "BOOL";
    else this.fail(member, "PLC2001", "Annotate private numeric and aggregate state explicitly.");
    if (member.type && this.types.resolve(member.type).type !== type)
      this.fail(member, "PLC2001", "Instance annotation differs from its constructor.");
    const instance = this.types.types.get(type)?.kind === "block";
    if (instance && !ts.isNewExpression(initial.value))
      this.fail(member, "PLC1007", "Block instances require static constructor initialization.");
    const variable: Variable = {
      id: `${id}:field:${member.name.text}`,
      name: member.name.text,
      type,
      storage: instance ? "instance" : "field",
      mutable:
        !instance &&
        !member.modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.ReadonlyKeyword),
      retain: initial.retain,
      span: this.origin(member),
    };
    return {
      variable,
      symbol: this.types.symbol(member.name),
      ...(!instance && { initializer: initial.value }),
    };
  }
}
