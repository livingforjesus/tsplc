import ts from "typescript";
import { dirname, relative } from "node:path";
import { primitiveTypes, parseInteger, type PlcType, type Field } from "@tsplc/compiler/ir";

export interface ResolvedType {
  type: string;
  io?: "input" | "output";
  mode?: "inOut";
}
export type TypeArgument =
  { kind: "type"; value: ResolvedType } | { kind: "integer"; value: number };
export type TypeEnvironment = ReadonlyMap<ts.Symbol, TypeArgument>;
export type Fail = (node: ts.Node, code: string, message: string) => never;

// The statically named callee of `name(...)` or `namespace.name(...)`.
export function calleeName(node: ts.Expression): ts.MemberName | undefined {
  if (ts.isIdentifier(node)) return node;
  return ts.isPropertyAccessExpression(node) ? node.name : undefined;
}

// This is the sole owner of TypeScript annotation substitution and PLC layouts.
// The checker resolves declarations; it never supplies erased numeric widths.
export class TypeResolver {
  readonly types = new Map<string, PlcType>(primitiveTypes.map((type) => [type.id, type]));
  readonly blockTypes = new Map<ts.Symbol, string>();
  readonly standardTypes = new Map<string, string>();
  private readonly active = new Set<string>();
  constructor(
    private readonly checker: ts.TypeChecker,
    private readonly root: string,
    private readonly sdk: string,
    private readonly fail: Fail,
  ) {}
  symbol(node: ts.Node): ts.Symbol {
    // An object shorthand has a property symbol and a separate value binding.
    // PLC loads and intrinsic provenance must follow the value, including imports.
    let symbol =
      ts.isShorthandPropertyAssignment(node.parent) && node.parent.name === node
        ? this.checker.getShorthandAssignmentValueSymbol(node.parent)
        : this.checker.getSymbolAtLocation(node);
    if (!symbol) this.fail(node, "PLC1002", "This name has no PLC declaration.");
    while (symbol.flags & ts.SymbolFlags.Alias) symbol = this.checker.getAliasedSymbol(symbol);
    return symbol;
  }

  sdkName(node: ts.Node): string | undefined {
    const symbol = this.symbol(node);
    return symbol.declarations?.some((declaration) =>
      declaration.getSourceFile().fileName.startsWith(`${dirname(this.sdk)}/`),
    )
      ? symbol.getName()
      : undefined;
  }

  id(node: ts.Node, name: string): string {
    return `${relative(this.root, node.getSourceFile().fileName).replaceAll("\\", "/")}:${node.getStart()}:${name}`;
  }

  argument(node: ts.TypeNode, environment: TypeEnvironment): TypeArgument {
    if (ts.isTypeReferenceNode(node)) {
      const bound = environment.get(this.symbol(node.typeName));
      if (bound && !node.typeArguments?.length) return bound;
    }
    if (
      ts.isLiteralTypeNode(node) &&
      (ts.isNumericLiteral(node.literal) || ts.isPrefixUnaryExpression(node.literal))
    ) {
      let value: bigint;
      try {
        value = parseInteger(node.literal.getText());
      } catch {
        this.fail(node, "PLC2001", "Layout arguments must be exact integer literals.");
      }
      if (value < -2147483648n || value > 2147483647n)
        this.fail(node, "PLC2001", "Layout argument is outside signed DINT range.");
      return { kind: "integer", value: Number(value) };
    }
    return { kind: "type", value: this.resolve(node, environment) };
  }

  bindings(
    parameters: readonly ts.TypeParameterDeclaration[] | undefined,
    arguments_: readonly ts.TypeNode[] | undefined,
    outer: TypeEnvironment,
    node: ts.Node,
  ): Map<ts.Symbol, TypeArgument> {
    const result = new Map(outer),
      params = parameters ?? [],
      args = arguments_ ?? [];
    if (args.length > params.length)
      this.fail(node, "PLC2001", "Too many concrete type arguments.");
    params.forEach((parameter, index) => {
      const argument = args[index] ?? parameter.default;
      if (!argument)
        this.fail(
          node,
          "PLC2001",
          "Generic PLC declarations require explicit concrete type arguments.",
        );
      result.set(this.symbol(parameter.name), this.argument(argument, result));
    });
    return result;
  }

  resolve(node: ts.TypeNode, environment: TypeEnvironment = new Map()): ResolvedType {
    if (node.kind === ts.SyntaxKind.BooleanKeyword) return { type: "BOOL" };
    if (ts.isParenthesizedTypeNode(node)) return this.resolve(node.type, environment);
    if (ts.isTypeLiteralNode(node)) {
      // Environment keys are admitted, declared type parameters with concrete bindings.
      const arguments_ = [...environment]
        .map(
          ([symbol, value]) =>
            `${this.id(symbol.declarations![0]!, symbol.name)}=${this.key(value)}`,
        )
        .sort()
        .join(",");
      return this.record(
        node,
        `${this.id(node, "record")}${arguments_ ? `<${arguments_}>` : ""}`,
        node.members,
        environment,
      );
    }
    if (!ts.isTypeReferenceNode(node))
      this.fail(
        node,
        "PLC2001",
        "Use an explicit supported PLC type; optional, union and dynamic layouts are unsupported.",
      );
    const symbol = this.symbol(node.typeName),
      bound = environment.get(symbol);
    if (bound) {
      if (bound.kind !== "type" || node.typeArguments?.length)
        this.fail(node, "PLC2001", "An integer layout argument is not a storage type.");
      return bound.value;
    }
    const official = this.sdkName(node.typeName);
    const block =
      this.blockTypes.get(symbol) ?? (official ? this.standardTypes.get(official) : undefined);
    if (block) {
      if (node.typeArguments?.length)
        this.fail(
          node,
          "PLC2001",
          "Function block classes are concrete and take no type arguments.",
        );
      return { type: block };
    }
    if (official === "InOut") {
      if (node.typeArguments?.length !== 1)
        this.fail(node, "PLC2001", "InOut requires one concrete value type.");
      const inner = this.resolve(node.typeArguments[0]!, environment);
      if (inner.io || !this.isValue(inner))
        this.fail(node, "PLC2001", "InOut cannot nest or borrow a block instance.");
      return { type: inner.type, mode: "inOut" };
    }
    if (official && this.types.has(official)) {
      if (node.typeArguments?.length)
        this.fail(node, "PLC2001", "Scalar types take no type arguments.");
      return { type: official };
    }
    if (official === "Input" || official === "Output") {
      if (node.typeArguments?.length !== 1)
        this.fail(node, "PLC2001", "I/O types need exactly one PLC type argument.");
      const inner = this.resolve(node.typeArguments[0]!, environment);
      if (inner.io || inner.mode || this.hasReferences(inner.type))
        this.fail(node, "PLC2001", "I/O type wrappers cannot be nested.");
      return { type: inner.type, io: official === "Input" ? "input" : "output" };
    }
    if (official === "FixedArray") {
      const args = node.typeArguments;
      if (!args || args.length < 2 || args.length > 3)
        this.fail(node, "PLC2001", "FixedArray needs element, length and optional lower bound.");
      const element = this.resolve(args[0]!, environment);
      const length = this.argument(args[1]!, environment),
        lower = args[2]
          ? this.argument(args[2], environment)
          : { kind: "integer" as const, value: 0 };
      if (
        element.io ||
        !this.isValue(element) ||
        length.kind !== "integer" ||
        lower.kind !== "integer" ||
        length.value < 1 ||
        length.value > 1_000_000 ||
        lower.value + length.value - 1 > 2147483647
      )
        this.fail(
          node,
          "PLC2001",
          "Fixed arrays need a supported element, positive bounded length and signed DINT bounds.",
        );
      const id = `array<${element.type},${length.value},${lower.value}>`;
      this.types.set(id, {
        id,
        kind: "array",
        element: element.type,
        length: length.value,
        lowerBound: lower.value,
      });
      this.checkSize(id, node);
      return { type: id };
    }
    if (official === "STRING" || official === "WSTRING") {
      if (node.typeArguments?.length !== 1)
        this.fail(node, "PLC2001", "Bounded strings require one capacity argument.");
      const capacity = this.argument(node.typeArguments[0]!, environment);
      if (capacity.kind !== "integer" || capacity.value < 1 || capacity.value > 65535)
        this.fail(node, "PLC2001", "String capacity must be 1..65535.");
      const id = `${official}<${capacity.value}>`;
      this.types.set(id, {
        id,
        kind: "string",
        capacity: capacity.value,
        encoding: official === "STRING" ? "utf8" : "utf16",
      });
      return { type: id };
    }
    return this.declaration(symbol, node.typeArguments, environment, node);
  }

  private declaration(
    symbol: ts.Symbol,
    arguments_: readonly ts.TypeNode[] | undefined,
    environment: TypeEnvironment,
    node: ts.Node,
  ): ResolvedType {
    const declarations = symbol.declarations ?? [];
    if (declarations.filter(ts.isInterfaceDeclaration).length > 1)
      this.fail(
        node,
        "PLC2001",
        "Interface declaration merging is unsupported; use one closed layout declaration.",
      );
    const declaration = declarations.find(
      (item) =>
        ts.isTypeAliasDeclaration(item) ||
        ts.isInterfaceDeclaration(item) ||
        ts.isEnumDeclaration(item),
    );
    if (!declaration)
      this.fail(node, "PLC2001", "This type is not implemented by the PLC frontend.");
    if (ts.isEnumDeclaration(declaration)) {
      if (arguments_?.length) this.fail(node, "PLC2001", "Enums take no type arguments.");
      return this.enumeration(declaration);
    }
    const bindings = this.bindings(declaration.typeParameters, arguments_, environment, node);
    const suffix = (declaration.typeParameters ?? [])
      .map((parameter) => this.key(bindings.get(this.symbol(parameter.name))!))
      .join(",");
    const id = `${this.id(declaration, declaration.name.text)}${suffix ? `<${suffix}>` : ""}`;
    if (this.active.has(id))
      this.fail(node, "PLC2001", "Recursive by-value PLC layouts are unsupported.");
    if (this.types.has(id)) return { type: id };
    if (this.active.size >= 64)
      this.fail(
        node,
        "PLC2001",
        "Type substitution exceeds 64 levels; recursive expansion is unsupported.",
      );
    this.active.add(id);
    try {
      if (ts.isTypeAliasDeclaration(declaration)) {
        if (ts.isTypeLiteralNode(declaration.type))
          return this.record(declaration, id, declaration.type.members, bindings);
        return this.resolve(declaration.type, bindings);
      }
      const inherited: Field[] = [];
      for (const heritage of declaration.heritageClauses ?? []) {
        for (const base of heritage.types) {
          const baseSymbol = this.symbol(base.expression);
          const baseType = this.declaration(baseSymbol, base.typeArguments, bindings, base);
          const layout = this.types.get(baseType.type);
          if (layout?.kind !== "record")
            this.fail(base, "PLC2001", "Inherited layout must be a record.");
          inherited.push(...layout.fields);
        }
      }
      return this.record(declaration, id, declaration.members, bindings, inherited);
    } finally {
      this.active.delete(id);
    }
  }
  // Specialization identity includes I/O and InOut modes: equal value widths alone
  // must not merge a readonly value parameter with a mutable borrowed input.
  key(argument: TypeArgument): string {
    if (argument.kind === "integer") return String(argument.value);
    const { type, io, mode } = argument.value;
    return `${type}${io ? `:${io}` : ""}${mode ? `:${mode}` : ""}`;
  }

  private record(
    node: ts.Node,
    id: string,
    members: readonly ts.TypeElement[],
    environment: TypeEnvironment,
    inherited: readonly Field[] = [],
  ): ResolvedType {
    const fields = [...inherited],
      names = new Set(fields.map((field) => field.name));
    for (const member of members) {
      if (
        !ts.isPropertySignature(member) ||
        !member.type ||
        member.questionToken ||
        !member.name ||
        !ts.isIdentifier(member.name)
      )
        this.fail(
          member,
          "PLC2001",
          "PLC records have named, required, explicitly typed fields; methods and index signatures are unsupported.",
        );
      if (names.has(member.name.text)) this.fail(member, "PLC2001", "Duplicate record field.");
      const type = this.resolve(member.type, environment);
      if (this.types.get(type.type)?.kind === "block")
        this.fail(
          member,
          "PLC2001",
          "Block instances belong in module or private block fields, not value records.",
        );
      if (type.io)
        this.fail(
          member,
          "PLC2001",
          "Logical I/O wrappers belong on ambient bindings, not fields.",
        );
      fields.push({
        name: member.name.text,
        type: type.type,
        ...(type.mode && { mode: type.mode }),
        readonly: Boolean(
          member.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ReadonlyKeyword),
        ),
      });
      names.add(member.name.text);
    }
    if (!fields.length) this.fail(node, "PLC2001", "PLC records require at least one field.");
    this.types.set(id, { id, kind: "record", fields });
    this.checkSize(id, node);
    return { type: id };
  }

  inputFields(node: ts.TypeNode): readonly Field[] {
    if (ts.isTypeLiteralNode(node) && !node.members.length) return [];
    const resolved = this.resolve(node),
      type = this.types.get(resolved.type);
    if (resolved.io || resolved.mode || type?.kind !== "record")
      this.fail(node, "PLC2001", "Block inputs require one closed record schema.");
    if (type.fields.some((field) => this.hasReferences(field.type)))
      this.fail(node, "PLC2001", "InOut belongs directly on input fields, not nested records.");
    return type.fields;
  }

  // A plain value layout: no InOut borrow, nested borrow schema or block instance.
  isValue(resolved: ResolvedType): boolean {
    return (
      !resolved.mode &&
      !this.hasReferences(resolved.type) &&
      this.types.get(resolved.type)?.kind !== "block"
    );
  }

  hasReferences(id: string, seen = new Set<string>()): boolean {
    if (seen.has(id)) return false;
    seen.add(id);
    const type = this.types.get(id);
    return type?.kind === "record"
      ? type.fields.some((field) => field.mode || this.hasReferences(field.type, seen))
      : type?.kind === "array"
        ? this.hasReferences(type.element, seen)
        : false;
  }

  enumeration(node: ts.EnumDeclaration): ResolvedType {
    const id = this.id(node, node.name.text);
    if (this.types.has(id)) return { type: id };
    if (!node.members.length) this.fail(node, "PLC2001", "PLC enums cannot be empty.");
    const members = node.members.map((member) => {
      if (!ts.isIdentifier(member.name))
        this.fail(member, "PLC2001", "Enum members require identifier names.");
      const value = this.checker.getConstantValue(member);
      if (
        typeof value !== "number" ||
        !Number.isInteger(value) ||
        value < -2147483648 ||
        value > 2147483647
      )
        this.fail(member, "PLC2001", "PLC enum values must be compile-time DINT integers.");
      return { name: member.name.text, value: String(value) };
    });
    if (new Set(members.map((member) => member.value)).size !== members.length)
      this.fail(node, "PLC2001", "PLC enum members require distinct values.");
    this.types.set(id, { id, kind: "enum", base: "DINT", members });
    return { type: id };
  }

  private checkSize(id: string, node: ts.Node): void {
    const count = (typeId: string, depth: number): number => {
      if (depth > 64) this.fail(node, "PLC2001", "PLC layout nesting exceeds 64 levels.");
      const type = this.types.get(typeId)!;
      const size =
        type.kind === "array"
          ? type.length * count(type.element, depth + 1)
          : type.kind === "record"
            ? type.fields.reduce((total, field) => total + count(field.type, depth + 1), 0)
            : 1;
      if (size > 1_000_000)
        this.fail(node, "PLC2001", "PLC layout exceeds one million scalar elements.");
      return size;
    };
    count(id, 0);
  }
}
