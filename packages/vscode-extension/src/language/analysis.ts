import {
  type Expr,
  key,
  namedType,
  type ParsedFile,
  type Span,
  type StSymbol,
  type TypeNode,
  unknownType,
  voidType,
} from "./model";
import type { Project } from "./project";
import {
  integerLiteral,
  integerRange,
  literalType,
  type Primitive,
  primitives,
  typeLabel,
} from "./types";

export type Use = Span & {
  symbol: StSymbol;
  declaration: boolean;
  write: boolean;
};
export type Info = {
  type: TypeNode;
  writable: boolean;
  addressable: boolean;
  symbol?: StSymbol;
  integer?: bigint;
  isType?: boolean;
  bit?: boolean;
};
const unknown: Info = {
  type: unknownType,
  writable: false,
  addressable: false,
};
const parameters = (symbol: StSymbol) =>
  symbol.members.filter((member) =>
    ["VAR_INPUT", "VAR_OUTPUT", "VAR_IN_OUT"].includes(member.section),
  );

export { parameters };

export class Analysis {
  readonly uses = new Map<string, Use[]>();
  readonly expressions = new Map<Expr, Info>();
  private readonly evaluating = new Set<string>();
  private depth = 0;
  constructor(readonly project: Project) {
    for (const symbol of project.allSymbols.values()) {
      this.use(project.file(symbol.uri), symbol.nameSpan, symbol, true);
    }
    for (const file of project.files.values()) {
      if (file.document.uri.startsWith("codesys-st:")) {
        continue;
      }
      for (const type of file.typeUses) {
        const symbol = project.typeSymbol(type);
        if (symbol) {
          this.use(file, type, symbol);
        }
        if (!project.validType(type)) {
          this.report(
            file,
            type,
            "unknown-type",
            `Unknown type ${typeLabel(type)}. Add its declaration or a vendor library signature.`,
          );
        }
      }
      const unit = project.owner(file);
      for (const symbol of [...(file.symbol?.members ?? []), ...file.locals]) {
        this.declaration(file, symbol);
      }
      if (file.symbol) {
        if (file.symbol.kind === "alias") {
          this.validateType(file, file.symbol.type);
        }
        this.checkCycles(file, file.symbol);
        this.inheritance(file, file.symbol);
      }
      for (const statement of file.statements) {
        switch (statement.kind) {
          case "assign": {
            const target = this.infer(file, statement.target, true);
            const value = this.infer(file, statement.value);
            this.requireWritable(file, statement.target, target);
            if (statement.operator.upper === "REF=") {
              const type = project.resolveType(target.type);
              if (type.kind !== "reference") {
                this.report(
                  file,
                  statement.target,
                  "reference-assignment",
                  "REF= requires a REFERENCE TO variable.",
                );
              } else {
                this.byReference(file, statement.value, type.target, value, false);
              }
            } else {
              this.assign(file, statement.value, target.type, value);
              if (["S=", "R="].includes(statement.operator.upper)) {
                this.requireBool(file, statement.target, target);
                this.requireBool(file, statement.value, value);
              }
            }
            break;
          }
          case "condition":
            this.requireBool(file, statement.expression, this.infer(file, statement.expression));
            break;
          case "expression": {
            this.infer(file, statement.expression);
            if (!["call", "missing"].includes(statement.expression.kind)) {
              this.report(
                file,
                statement.expression,
                "unused-expression",
                "Expected an assignment or a POU call.",
              );
            }
            break;
          }
          case "for": {
            const counter = this.infer(file, statement.variable, true);
            this.requireWritable(file, statement.variable, counter);
            this.requireInteger(file, statement.variable, counter);
            for (const expr of [statement.from, statement.to, statement.step].filter(
              (item): item is Expr => !!item,
            )) {
              const info = this.infer(file, expr);
              this.requireInteger(file, expr, info);
              this.assign(file, expr, counter.type, info);
            }
            if (statement.step && this.infer(file, statement.step).integer === 0n) {
              this.report(file, statement.step, "zero-step", "FOR loop step must not be zero.");
            }
            break;
          }
          case "case": {
            const selector = this.infer(file, statement.expression);
            for (const label of statement.labels) {
              if (label.kind === "binary" && label.operator.upper === "..") {
                this.assign(file, label.left, selector.type, this.infer(file, label.left));
                this.assign(file, label.right, selector.type, this.infer(file, label.right));
              } else {
                this.assign(file, label, selector.type, this.infer(file, label));
              }
            }
            break;
          }
        }
      }
      if (
        unit?.symbol.kind === "property" &&
        unit.parent?.symbol.kind !== "interface" &&
        !unit.files.some((f) => /\/(get|set)\.(?:st|iecst)$/i.test(f.document.uri))
      ) {
        this.report(
          file,
          unit.symbol.nameSpan,
          "missing-accessor",
          "A concrete property needs get.st or set.st.",
        );
      }
    }
  }
  private report(file: ParsedFile, span: Span, code: string, message: string, severity: 1 | 2 = 1) {
    const list = this.project.diagnostics.get(file.document.uri);
    if (list && list.length < 200) {
      this.project.addDiagnostic(file, span, code, message, severity);
    }
  }
  private use(file: ParsedFile, span: Span, symbol: StSymbol, declaration = false, write = false) {
    if (!file || span.start === span.end) {
      return;
    }
    const uses = this.uses.get(file.document.uri) ?? [];
    if (
      !uses.some(
        (use) => use.start === span.start && use.end === span.end && use.symbol.id === symbol.id,
      )
    ) {
      uses.push({ ...span, symbol, declaration, write });
    }
    this.uses.set(file.document.uri, uses);
  }
  private declaration(file: ParsedFile, symbol: StSymbol) {
    this.validateType(file, symbol.type, symbol.section);
    if (symbol.initializer) {
      const target =
        symbol.kind === "enumMember"
          ? (this.project.bySymbol.get(symbol.id)?.symbol.bases[0] ?? namedType("INT"))
          : symbol.type;
      this.assign(file, symbol.initializer, target, this.infer(file, symbol.initializer));
    }
    if (
      symbol.modifiers.includes("CONSTANT") &&
      !symbol.initializer &&
      !["VAR_INPUT", "VAR_IN_OUT", "VAR_EXTERNAL"].includes(symbol.section)
    ) {
      this.report(
        file,
        symbol.nameSpan,
        "constant-initializer",
        `Constant ${symbol.name} requires an initializer.`,
      );
    }
  }
  private validateType(file: ParsedFile, type: TypeNode, section = "TYPE") {
    if (type.kind === "array") {
      const element = this.project.resolveType(type.element);
      if (element.kind === "named" && key(element.name) === "BIT") {
        this.report(
          file,
          type,
          "invalid-bit-type",
          "An ARRAY cannot contain BIT elements; use BOOL or a packed STRUCT.",
        );
      }
      if (this.project.resolveType(type.element).kind === "reference") {
        this.report(
          file,
          type,
          "invalid-reference-type",
          "An ARRAY cannot contain REFERENCE TO elements.",
        );
      }
      for (const bound of type.bounds) {
        if ((!bound.low || !bound.high) && section !== "VAR_IN_OUT") {
          this.report(
            file,
            type,
            "open-array-scope",
            "ARRAY[*] is allowed only in VAR_IN_OUT parameters.",
          );
        }
        if (bound.low && bound.high) {
          const low = this.infer(file, bound.low);
          const high = this.infer(file, bound.high);
          this.requireInteger(file, bound.low, low);
          this.requireInteger(file, bound.high, high);
          if (
            (low.integer === undefined && low.type.kind !== "unknown") ||
            (high.integer === undefined && high.type.kind !== "unknown")
          ) {
            this.report(
              file,
              type,
              "array-constant-bound",
              "Array bounds must be constant integer expressions.",
            );
          }
          if (
            low.integer !== undefined &&
            high.integer !== undefined &&
            low.integer > high.integer
          ) {
            this.report(file, type, "array-bounds", "Array lower bound exceeds its upper bound.");
          }
        }
      }
      this.validateType(file, type.element, section);
    } else if (type.kind === "pointer" || type.kind === "reference") {
      const target = this.project.resolveType(type.target);
      if (target.kind === "named" && key(target.name) === "BIT") {
        this.report(
          file,
          type,
          "invalid-bit-type",
          "BIT storage cannot be a pointer or reference target.",
        );
      }
      if (this.project.resolveType(type.target).kind === "reference") {
        this.report(
          file,
          type,
          "invalid-reference-type",
          "POINTER TO / REFERENCE TO cannot target another REFERENCE TO type.",
        );
      }
      this.validateType(file, type.target, section);
    } else if (type.kind === "string" && type.length) {
      const size = this.infer(file, type.length);
      this.requireInteger(file, type.length, size);
      if (size.integer !== undefined && size.integer < 1n) {
        this.report(file, type.length, "string-length", "String capacity must be positive.");
      }
    } else if (type.kind === "subrange") {
      this.assign(file, type.low, type.base, this.infer(file, type.low));
      this.assign(file, type.high, type.base, this.infer(file, type.high));
    }
  }
  private checkCycles(file: ParsedFile, symbol: StSymbol) {
    const visit = (current: StSymbol, path: Set<string>): boolean => {
      if (path.has(current.id)) {
        return true;
      }
      if (path.size > 96) {
        return true;
      }
      const next = new Set(path);
      next.add(current.id);
      const types = [
        ...current.bases,
        ...(current.kind === "alias"
          ? [current.type]
          : current.members.filter((m) => m.kind === "variable").map((m) => m.type)),
      ];
      return types.some((type) => {
        let item = type;
        while (item.kind === "array") {
          item = item.element;
        }
        if (item.kind !== "named") {
          return false;
        }
        const target = this.project.typeSymbol(item);
        return target ? visit(target, next) : false;
      });
    };
    if (visit(symbol, new Set())) {
      this.report(
        file,
        symbol.nameSpan,
        "recursive-type",
        `Cyclic inheritance or recursive value type involving ${symbol.name}. Use a pointer/reference for recursive data.`,
      );
    }
  }
  private inheritance(file: ParsedFile, symbol: StSymbol) {
    for (const baseType of symbol.bases) {
      const base = this.project.typeSymbol(baseType);
      if (!base) {
        continue;
      }
      if (base.modifiers.includes("FINAL")) {
        this.report(file, baseType, "final-base", `Cannot extend FINAL ${base.name}.`);
      }
      if (base.kind !== symbol.kind) {
        this.report(
          file,
          baseType,
          "invalid-base",
          `${symbol.name} cannot extend ${base.kind} ${base.name}.`,
        );
      }
      for (const member of symbol.members) {
        if (
          base.members.some(
            (item) => key(item.name) === key(member.name) && item.section !== "VAR_TEMP",
          )
        ) {
          this.report(
            file,
            member.nameSpan,
            "inherited-name",
            `${member.name} duplicates an inherited variable.`,
          );
        }
      }
    }
    if (symbol.kind === "functionBlock" && symbol.bases.length > 1) {
      this.report(
        file,
        symbol.nameSpan,
        "multiple-inheritance",
        "Function blocks can extend only one base block.",
      );
    }
    for (const interfaceType of symbol.interfaces) {
      const contract = this.project.typeSymbol(interfaceType);
      if (!contract) {
        continue;
      }
      if (contract.kind !== "interface") {
        this.report(
          file,
          interfaceType,
          "invalid-interface",
          `${contract.name} is not an interface.`,
        );
        continue;
      }
      for (const requirement of this.project.allMembers(contract)) {
        const member = this.project
          .allMembers(symbol)
          .find((item) => key(item.name) === key(requirement.name));
        if (!member) {
          this.report(
            file,
            interfaceType,
            "interface-member",
            `${symbol.name} must implement ${contract.name}.${requirement.name}.`,
          );
          continue;
        }
        if (
          member.kind !== requirement.kind ||
          !this.same(member.type, requirement.type) ||
          member.modifiers.some((m) => ["PRIVATE", "PROTECTED"].includes(m)) ||
          !this.sameParameters(member, requirement)
        ) {
          this.report(
            file,
            interfaceType,
            "interface-signature",
            `${symbol.name}.${requirement.name} does not match the interface signature.`,
          );
        }
      }
    }
    if (symbol.kind === "method" || symbol.kind === "property") {
      const owner = this.project.bySymbol.get(symbol.id)?.parent;
      const inherited = owner?.symbol.bases
        .flatMap((type) => {
          const base = this.project.typeSymbol(type);
          return base ? this.project.allMembers(base) : [];
        })
        .find((member) => key(member.name) === key(symbol.name));
      if (
        inherited &&
        (inherited.modifiers.includes("FINAL") ||
          !this.same(inherited.type, symbol.type) ||
          !this.sameParameters(inherited, symbol))
      ) {
        this.report(
          file,
          symbol.nameSpan,
          "override-signature",
          `${symbol.name} cannot override the base member with this signature.`,
        );
      }
      if (!inherited && symbol.modifiers.includes("OVERRIDE")) {
        this.report(
          file,
          symbol.nameSpan,
          "missing-override",
          `${symbol.name} has no matching inherited member to override.`,
        );
      }
    }
  }
  private sameParameters(a: StSymbol, b: StSymbol): boolean {
    const left = parameters(a);
    const right = parameters(b);
    return (
      left.length === right.length &&
      left.every((p, i) => {
        const q = right[i];
        return (
          !!q && key(p.name) === key(q.name) && p.section === q.section && this.same(p.type, q.type)
        );
      })
    );
  }
  private fromSymbol(file: ParsedFile, symbol: StSymbol): Info {
    const own = this.project.owner(file)?.symbol.id === symbol.id;
    const info: Info = {
      type: this.project.symbolType(symbol),
      symbol,
      writable:
        !symbol.modifiers.includes("CONSTANT") &&
        (symbol.kind === "variable" ||
          (own && ["function", "method", "property"].includes(symbol.kind))),
      addressable: symbol.kind === "variable",
      isType: ["struct", "union", "alias", "enum", "functionBlock", "interface"].includes(
        symbol.kind,
      ),
    };
    if (symbol.kind === "property") {
      info.writable = own || this.project.propertyAccess(symbol).write;
    }
    if (symbol.address) {
      if (/^%[IQM]X|^%[IQM]\d/i.test(symbol.address.text)) {
        info.addressable = false;
        info.bit = true;
      }
      if (/^%I/i.test(symbol.address.text)) {
        info.writable = false;
      }
    }
    if (symbol.kind === "enumMember") {
      info.writable = false;
    }
    if (this.evaluating.has(symbol.id)) {
      this.report(
        file,
        symbol.nameSpan,
        "cyclic-constant",
        `Cyclic constant initializer involving ${symbol.name}.`,
      );
    }
    if (
      symbol.initializer &&
      (symbol.modifiers.includes("CONSTANT") || symbol.kind === "enumMember") &&
      !this.evaluating.has(symbol.id)
    ) {
      this.evaluating.add(symbol.id);
      const value = this.infer(this.project.file(symbol.uri), symbol.initializer);
      this.evaluating.delete(symbol.id);
      if (value.integer !== undefined) {
        info.integer = value.integer;
      }
    }
    return info;
  }
  infer(file: ParsedFile, expr: Expr, write = false): Info {
    const cached = this.expressions.get(expr);
    if (cached && !write) {
      return cached;
    }
    if (++this.depth > 192) {
      this.depth--;
      this.report(
        file,
        expr,
        "analysis-depth",
        "Expression exceeds the editor's analysis depth (192). Split it into intermediate expressions.",
      );
      return unknown;
    }
    const info = this.inferInner(file, expr, write);
    this.depth--;
    this.expressions.set(expr, info);
    return info;
  }
  private inferInner(file: ParsedFile, expr: Expr, write: boolean): Info {
    switch (expr.kind) {
      case "missing":
        return unknown;
      case "name": {
        if (["THIS", "SUPER"].includes(expr.token.upper)) {
          const container = this.project.container(file);
          const thisType = container ? namedType(container.symbol.name) : unknownType;
          const type =
            expr.token.upper === "THIS" ? thisType : (container?.symbol.bases[0] ?? unknownType);
          if (container?.symbol.kind !== "functionBlock" || type.kind === "unknown") {
            this.report(
              file,
              expr,
              "invalid-self",
              `${expr.token.text} is not available in this scope.`,
            );
          }
          return {
            type: {
              kind: "pointer",
              target: type,
              start: expr.start,
              end: expr.end,
            },
            writable: false,
            addressable: false,
          };
        }
        const symbol = this.project.lookup(file, expr.token.text);
        if (!symbol) {
          this.report(file, expr.token, "unknown-symbol", `Unknown symbol ${expr.token.text}.`);
          return unknown;
        }
        this.use(file, expr.token, symbol, false, write);
        return this.fromSymbol(file, symbol);
      }
      case "literal": {
        const type = literalType(expr);
        const integer = integerLiteral(expr.token.text);
        const result: Info = {
          type,
          writable: expr.token.kind === "address",
          addressable: expr.token.kind === "address",
          ...(integer !== undefined ? { integer } : {}),
        };
        if (expr.token.kind === "address" && /^%I/i.test(expr.token.text)) {
          result.writable = false;
        }
        if (expr.token.kind === "address" && /^%[IQM]X|^%[IQM]\d/i.test(expr.token.text)) {
          result.addressable = false;
          result.bit = true;
        }
        if (/^(?:[A-Z_]+#)?(?:2|8|16)#/i.test(expr.token.text) && integer === undefined) {
          this.report(file, expr, "invalid-literal", `Invalid digits in ${expr.token.text}.`);
        }
        if (
          type.kind === "named" &&
          !["__INTEGER_LITERAL", "__REAL_LITERAL"].includes(type.name) &&
          !this.project.validType(type)
        ) {
          this.report(file, expr, "invalid-literal", `Unknown literal type ${type.name}.`);
        }
        const range = integerRange(type);
        if (
          /^BOOL#/i.test(expr.token.text) &&
          !/^BOOL#(?:TRUE|FALSE|0|1)$/i.test(expr.token.text)
        ) {
          this.report(
            file,
            expr,
            "invalid-bool-literal",
            "BOOL literals must be TRUE, FALSE, 0 or 1.",
          );
        }
        if (integer !== undefined && range && (integer < range[0] || integer > range[1])) {
          this.report(
            file,
            expr,
            "literal-range",
            `${expr.token.text} is outside ${typeLabel(type)} range ${range[0]}..${range[1]}.`,
          );
        }
        return result;
      }
      case "member": {
        if (expr.object.kind === "name" && expr.object.token.upper === "STANDARD") {
          const symbol = this.project.global(`Standard.${expr.member.text}`);
          if (symbol) {
            this.use(file, expr.member, symbol);
            return this.fromSymbol(file, symbol);
          }
        }
        const object = this.infer(file, expr.object, write);
        const type = this.project.valueType(object.type);
        if (expr.member.kind === "number" && this.isInteger(object.type)) {
          const index = integerLiteral(expr.member.text);
          const bits = type.kind === "named" ? primitives[key(type.name)]?.bits : undefined;
          if (index === undefined || index < 0n || (bits && index >= BigInt(bits))) {
            this.report(
              file,
              expr.member,
              "bit-index",
              "Bit index is outside the value's bit width.",
            );
          }
          return {
            type: namedType("BOOL"),
            writable: object.writable,
            addressable: false,
            bit: true,
          };
        }
        const member = this.project
          .members(type, file, true)
          .find((symbol) => key(symbol.name) === expr.member.upper);
        if (!member) {
          if (type.kind !== "unknown" && expr.member.text) {
            this.report(
              file,
              expr.member,
              "unknown-member",
              `${typeLabel(type)} has no member ${expr.member.text}.`,
            );
          }
          return unknown;
        }
        if (object.isType && !["enum", "gvl"].includes(object.symbol?.kind ?? "")) {
          this.report(
            file,
            expr.object,
            "instance-required",
            `Access ${member.name} through an instance.`,
          );
        }
        if (!this.project.accessible(member, file)) {
          this.report(
            file,
            expr.member,
            "inaccessible-member",
            `${member.name} is not accessible from this scope.`,
          );
        }
        this.use(file, expr.member, member, false, write);
        const info = this.fromSymbol(file, member);
        if (
          member.kind === "variable" &&
          object.symbol?.kind !== "gvl" &&
          object.symbol?.kind !== "program"
        ) {
          info.writable = info.writable && object.writable;
        }
        if (member.kind === "property" && !write && !this.project.propertyAccess(member).read) {
          this.report(file, expr.member, "write-only-property", `${member.name} has no getter.`);
        }
        return info;
      }
      case "deref": {
        const object = this.infer(file, expr.object);
        const type = this.project.valueType(object.type);
        if (type.kind !== "pointer") {
          if (type.kind !== "unknown") {
            this.report(file, expr, "not-pointer", `Cannot dereference ${typeLabel(type)}.`);
          }
          return unknown;
        }
        return { type: type.target, writable: true, addressable: true };
      }
      case "index": {
        const object = this.infer(file, expr.object, write);
        const type = this.project.valueType(object.type);
        const indices = expr.indices.map((index) => {
          const value = this.infer(file, index);
          this.requireInteger(file, index, value);
          return value;
        });
        if (type.kind === "array") {
          if (indices.length !== type.bounds.length) {
            this.report(
              file,
              expr,
              "array-dimensions",
              `Expected ${type.bounds.length} array indices, received ${indices.length}.`,
            );
          }
          type.bounds.forEach((bound, i) => {
            const value = indices[i]?.integer;
            if (value === undefined || !bound.low || !bound.high) {
              return;
            }
            const ownerFile = this.fileForType(type, file);
            const low = this.infer(ownerFile, bound.low).integer;
            const high = this.infer(ownerFile, bound.high).integer;
            if (low !== undefined && high !== undefined && (value < low || value > high)) {
              this.report(
                file,
                expr.indices[i] ?? expr,
                "index-range",
                `Index ${value} is outside ${low}..${high}.`,
              );
            }
          });
          return {
            type: type.element,
            writable: object.writable,
            addressable: object.addressable,
          };
        }
        if (type.kind === "pointer") {
          return { type: type.target, writable: true, addressable: true };
        }
        if (type.kind === "string") {
          return {
            type: namedType(type.wide ? "WORD" : "BYTE"),
            writable: object.writable,
            addressable: object.addressable,
          };
        }
        if (type.kind !== "unknown") {
          this.report(file, expr.object, "not-indexable", `${typeLabel(type)} cannot be indexed.`);
        }
        return unknown;
      }
      case "call":
        return this.call(file, expr);
      case "unary": {
        const operand = this.infer(file, expr.operand);
        if (expr.operator.upper === "NOT") {
          if (
            !this.isBool(operand.type) &&
            !this.isInteger(operand.type) &&
            operand.type.kind !== "unknown"
          ) {
            this.report(file, expr, "operator-type", "NOT requires BOOL or an integer/bit string.");
          }
          return { type: operand.type, writable: false, addressable: false };
        }
        if (
          !this.isNumeric(operand.type) &&
          !this.isTemporal(operand.type) &&
          operand.type.kind !== "unknown"
        ) {
          this.report(
            file,
            expr,
            "operator-type",
            `Unary ${expr.operator.text} requires a numeric operand.`,
          );
        }
        const integer =
          operand.integer === undefined
            ? undefined
            : operand.integer * (expr.operator.upper === "-" ? -1n : 1n);
        return {
          type: operand.type,
          writable: false,
          addressable: false,
          ...(integer !== undefined ? { integer } : {}),
        };
      }
      case "binary":
        return this.binary(file, expr);
      case "aggregate":
        // Initializers need the declared target type to resolve fields and repetition.
        return unknown;
    }
  }
  private fileForType(type: TypeNode, fallback: ParsedFile): ParsedFile {
    for (const symbol of this.project.allSymbols.values()) {
      if (symbol.type === type) {
        return this.project.files.get(symbol.uri) ?? fallback;
      }
    }
    return fallback;
  }
  private callable(info: Info): StSymbol | undefined {
    if (info.symbol && ["function", "method", "action", "program"].includes(info.symbol.kind)) {
      return info.symbol;
    }
    const type = this.project.valueType(info.type);
    const symbol = this.project.typeSymbol(type);
    return symbol?.kind === "functionBlock" ? symbol : undefined;
  }
  callTarget(file: ParsedFile, expr: Expr): StSymbol | undefined {
    return this.callable(this.infer(file, expr));
  }
  private call(file: ParsedFile, expr: Extract<Expr, { kind: "call" }>): Info {
    const callee = this.infer(file, expr.callee);
    const target = this.callable(callee);
    if (!target) {
      for (const arg of expr.args) {
        this.infer(file, arg.value);
      }
      if (callee.type.kind !== "unknown") {
        this.report(
          file,
          expr.callee,
          "not-callable",
          `${typeLabel(callee.type)} is not callable.`,
        );
      }
      return unknown;
    }
    if (target.kind === "functionBlock" && callee.isType) {
      this.report(
        file,
        expr.callee,
        "instance-required",
        `Declare an instance of ${target.name} before calling it.`,
      );
    }
    const params = parameters(target);
    const positional = params.filter((param) => param.section !== "VAR_OUTPUT");
    const supplied = new Set<string>();
    const infos: Info[] = [];
    const genericValues: Info[] = [];
    let named = false;
    const builtin = target.uri.startsWith("codesys-st:");
    const functionName = key(target.name);
    const variadic = builtin && ["MIN", "MAX", "CONCAT", "MUX"].includes(functionName);
    for (const [index, arg] of expr.args.entries()) {
      const parameter = arg.name
        ? params.find((param) => key(param.name) === arg.name?.upper)
        : (positional[index] ?? (variadic ? positional.at(-1) : undefined));
      const value = this.infer(file, arg.value, arg.direction === "=>");
      infos.push(value);
      if (!parameter) {
        this.report(
          file,
          arg.name ?? arg,
          "unknown-argument",
          arg.name
            ? `${target.name} has no parameter ${arg.name.text}.`
            : `Too many arguments for ${target.name}.`,
        );
        continue;
      }
      if (
        target.type.kind === "named" &&
        target.type.name.startsWith("ANY") &&
        parameter.type.kind === "named" &&
        parameter.type.name === target.type.name
      ) {
        genericValues.push(value);
      }
      if (arg.name) {
        named = true;
        this.use(file, arg.name, parameter);
      } else if (named) {
        this.report(
          file,
          arg,
          "argument-order",
          "Positional arguments must precede named arguments.",
        );
      }
      if (supplied.has(parameter.id) && !(!arg.name && variadic)) {
        this.report(
          file,
          arg,
          "duplicate-argument",
          `${parameter.name} was supplied more than once.`,
        );
      }
      supplied.add(parameter.id);
      if (parameter.section === "VAR_OUTPUT") {
        if (arg.direction !== "=>") {
          this.report(file, arg, "argument-direction", `${parameter.name} is an output; use =>.`);
        }
        this.requireWritable(file, arg.value, value);
        this.assign(file, arg.value, value.type, {
          ...unknown,
          type: parameter.type,
        });
      } else {
        if (arg.direction === "=>") {
          this.report(file, arg, "argument-direction", `${parameter.name} is an input; use :=.`);
        }
        if (parameter.section === "VAR_IN_OUT") {
          this.byReference(
            file,
            arg.value,
            parameter.type,
            value,
            parameter.modifiers.includes("CONSTANT"),
          );
        } else {
          this.assign(file, arg.value, parameter.type, value);
        }
      }
    }
    for (const parameter of params) {
      const required =
        parameter.section === "VAR_IN_OUT" ||
        (parameter.section === "VAR_INPUT" &&
          !["functionBlock", "program"].includes(target.kind) &&
          !parameter.initializer);
      if (required && !supplied.has(parameter.id)) {
        this.report(
          file,
          expr.callee,
          "missing-argument",
          `Missing required parameter ${parameter.name} for ${target.name}.`,
        );
      }
    }
    if (builtin && functionName === "ADR") {
      const value = infos[0];
      const arg = expr.args[0];
      if (
        value &&
        arg &&
        !value.addressable &&
        !["function", "program", "functionBlock"].includes(value.symbol?.kind ?? "")
      ) {
        this.report(
          file,
          arg.value,
          "address-required",
          "ADR requires an addressable variable or POU.",
        );
      }
      return {
        type: {
          kind: "pointer",
          target: value?.type ?? unknownType,
          start: expr.start,
          end: expr.end,
        },
        writable: false,
        addressable: false,
      };
    }
    let type = target.type;
    if (target.kind === "method" && type.kind === "named" && type.name === "VOID") {
      type = target.members.find((member) => member.section === "VAR_OUTPUT")?.type ?? voidType;
    }
    if (builtin && type.kind === "named" && type.name.startsWith("ANY")) {
      const candidates = genericValues;
      type = candidates[0]?.type ?? unknownType;
      for (const candidate of candidates.slice(1)) {
        if (!this.compatible(type, candidate.type)) {
          this.report(
            file,
            expr,
            "generic-arguments",
            `${target.name} arguments must have compatible types.`,
          );
        }
        if (this.numericRank(candidate.type) > this.numericRank(type)) {
          type = candidate.type;
        }
      }
    }
    return { type, writable: false, addressable: false };
  }
  private binary(file: ParsedFile, expr: Extract<Expr, { kind: "binary" }>): Info {
    const left = this.infer(file, expr.left);
    const right = this.infer(file, expr.right);
    const operator = expr.operator.upper;
    const compare = ["=", "<>", "<", ">", "<=", ">="].includes(operator);
    if (compare) {
      if (
        !this.compatible(left.type, right.type) &&
        !(this.project.valueType(left.type).kind === "pointer" && right.integer === 0n) &&
        !(this.project.valueType(right.type).kind === "pointer" && left.integer === 0n)
      ) {
        this.report(
          file,
          expr,
          "comparison-type",
          `Cannot compare ${typeLabel(left.type)} with ${typeLabel(right.type)}.`,
        );
      }
      return { type: namedType("BOOL"), writable: false, addressable: false };
    }
    if (["AND", "OR", "XOR", "AND_THEN", "OR_ELSE", "&"].includes(operator)) {
      const valid =
        (this.isBool(left.type) && this.isBool(right.type)) ||
        (!["AND_THEN", "OR_ELSE"].includes(operator) &&
          this.isInteger(left.type) &&
          this.isInteger(right.type));
      if (!valid && left.type.kind !== "unknown" && right.type.kind !== "unknown") {
        this.report(
          file,
          expr,
          "operator-type",
          `${operator} requires matching BOOL or integer/bit-string operands.`,
        );
      }
    } else {
      if (
        (!this.isNumeric(left.type) || !this.isNumeric(right.type)) &&
        !(
          this.isTemporal(left.type) &&
          (this.isNumeric(right.type) || this.same(left.type, right.type))
        ) &&
        left.type.kind !== "unknown" &&
        right.type.kind !== "unknown"
      ) {
        this.report(
          file,
          expr,
          "operator-type",
          `Arithmetic ${operator} is invalid for ${typeLabel(left.type)} and ${typeLabel(right.type)}.`,
        );
      }
      if (operator === "MOD") {
        this.requireInteger(file, expr.left, left);
        this.requireInteger(file, expr.right, right);
      }
    }
    if (["/", "MOD"].includes(operator) && right.integer === 0n) {
      this.report(file, expr.right, "division-zero", "Division by zero.");
    }
    let integer: bigint | undefined;
    if (left.integer !== undefined && right.integer !== undefined) {
      const a = left.integer;
      const b = right.integer;
      switch (operator) {
        case "+":
          integer = a + b;
          break;
        case "-":
          integer = a - b;
          break;
        case "*":
          integer = a * b;
          break;
        case "/":
          if (b) {
            integer = a / b;
          }
          break;
        case "MOD":
          if (b) {
            integer = a % b;
          }
          break;
        case "**":
          if (b >= 0 && b < 1024 && a.toString(2).length * Number(b) < 8192) {
            integer = a ** b;
          }
          break;
      }
    }
    return {
      type: this.numericRank(left.type) >= this.numericRank(right.type) ? left.type : right.type,
      writable: false,
      addressable: false,
      ...(integer !== undefined ? { integer } : {}),
    };
  }
  private primitive(type: TypeNode): Primitive | undefined {
    const resolved = this.project.valueType(type);
    if (resolved.kind === "subrange") {
      return this.primitive(resolved.base);
    }
    return resolved.kind === "named" ? primitives[key(resolved.name)] : undefined;
  }
  isBool(type: TypeNode): boolean {
    return this.primitive(type)?.family === "bool";
  }
  isInteger(type: TypeNode): boolean {
    const resolved = this.project.valueType(type);
    return (
      ["integer", "bits"].includes(this.primitive(resolved)?.family ?? "") ||
      (resolved.kind === "named" && resolved.name === "__INTEGER_LITERAL")
    );
  }
  private isNumeric(type: TypeNode): boolean {
    const resolved = this.project.valueType(type);
    return (
      this.isInteger(type) ||
      this.primitive(type)?.family === "real" ||
      (resolved.kind === "named" && resolved.name === "__REAL_LITERAL")
    );
  }
  private isTemporal(type: TypeNode): boolean {
    return ["time", "date", "tod", "datetime"].includes(this.primitive(type)?.family ?? "");
  }
  private numericRank(type: TypeNode): number {
    const primitive = this.primitive(type);
    return (primitive?.bits ?? 0) + (primitive?.family === "real" ? 128 : 0);
  }
  same(a: TypeNode, b: TypeNode): boolean {
    const left = this.project.resolveType(a);
    const right = this.project.resolveType(b);
    return key(typeLabel(left)) === key(typeLabel(right));
  }
  private compatible(a: TypeNode, b: TypeNode): boolean {
    const left = this.project.valueType(a);
    const right = this.project.valueType(b);
    if (left.kind === "unknown" || right.kind === "unknown") {
      return true;
    }
    if (left.kind === "subrange") {
      return this.compatible(left.base, right);
    }
    if (right.kind === "subrange") {
      return this.compatible(left, right.base);
    }
    if (this.same(left, right)) {
      return true;
    }
    if (left.kind === "named" && left.name.startsWith("ANY")) {
      if (["ANY_NUM", "ANY_MAGNITUDE"].includes(left.name)) {
        return this.isNumeric(right);
      }
      if (left.name === "ANY_INT") {
        return this.isInteger(right);
      }
      if (left.name === "ANY_REAL") {
        return this.primitive(right)?.family === "real";
      }
      if (left.name === "ANY_STRING") {
        return right.kind === "string";
      }
      if (left.name === "ANY_BIT") {
        return this.isInteger(right) || this.isBool(right);
      }
      return true;
    }
    if (this.isNumeric(left) && this.isNumeric(right)) {
      return true;
    }
    if (this.isBool(left) && this.isBool(right)) {
      return true;
    }
    if (left.kind === "string" && right.kind === "string") {
      return left.wide === right.wide;
    }
    if (left.kind === "pointer" && right.kind === "pointer") {
      return this.same(left.target, right.target);
    }
    if (left.kind === "array" && right.kind === "array") {
      return (
        left.bounds.length === right.bounds.length &&
        left.bounds.every((bound, index) => {
          const other = right.bounds[index];
          return (
            !!other &&
            (!bound.low ||
              typeLabel({ ...left, bounds: [bound] }) === typeLabel({ ...right, bounds: [other] }))
          );
        }) &&
        this.same(left.element, right.element)
      );
    }
    const expected = this.project.typeSymbol(left);
    const actual = this.project.typeSymbol(right);
    return (
      !!expected &&
      !!actual &&
      expected.kind === "interface" &&
      this.project.isDescendant(actual, expected)
    );
  }
  private requireBool(file: ParsedFile, expr: Expr, info: Info) {
    if (info.type.kind !== "unknown" && !this.isBool(info.type)) {
      this.report(file, expr, "condition-type", `Expected BOOL, found ${typeLabel(info.type)}.`);
    }
  }
  private requireInteger(file: ParsedFile, expr: Expr, info: Info) {
    if (info.type.kind !== "unknown" && !this.isInteger(info.type)) {
      this.report(
        file,
        expr,
        "integer-required",
        `Expected an integer, found ${typeLabel(info.type)}.`,
      );
    }
  }
  private requireWritable(file: ParsedFile, expr: Expr, info: Info) {
    if (info.type.kind !== "unknown" && !info.writable) {
      this.report(
        file,
        expr,
        "not-writable",
        `${info.symbol?.name ?? "This expression"} is read-only, constant, or not a writable variable.`,
      );
    }
  }
  private byReference(
    file: ParsedFile,
    expr: Expr,
    expected: TypeNode,
    actual: Info,
    constant: boolean,
  ) {
    if (actual.type.kind === "unknown") {
      return;
    }
    const expectedValue = this.project.valueType(expected);
    const actualValue = this.project.valueType(actual.type);
    if (
      constant &&
      expectedValue.kind === "string" &&
      actualValue.kind === "string" &&
      expectedValue.wide === actualValue.wide &&
      (actual.addressable || expr.kind === "literal")
    ) {
      return;
    }
    if (
      (!actual.addressable || (!constant && !actual.writable)) &&
      !(constant && this.project.valueType(expected).kind === "string" && expr.kind === "literal")
    ) {
      this.report(
        file,
        expr,
        "in-out-variable",
        "VAR_IN_OUT / REF= requires an addressable variable; literals, expressions, properties and bits cannot be passed by writable reference.",
      );
    }
    if (
      !this.same(this.project.valueType(expected), this.project.valueType(actual.type)) &&
      !(this.project.valueType(expected).kind === "array" && this.compatible(expected, actual.type))
    ) {
      this.report(
        file,
        expr,
        "in-out-type",
        `By-reference parameter requires exactly ${typeLabel(expected)}, found ${typeLabel(actual.type)}.`,
      );
    }
  }
  private assign(file: ParsedFile, expr: Expr, expected: TypeNode, actual: Info) {
    const target = this.project.valueType(expected);
    if (expr.kind === "aggregate") {
      this.aggregate(file, expr, target);
      return;
    }
    if (target.kind === "unknown" || actual.type.kind === "unknown") {
      return;
    }
    if (target.kind === "pointer" && actual.integer === 0n) {
      return;
    }
    if (!this.compatible(target, actual.type)) {
      this.report(
        file,
        expr,
        "type-mismatch",
        `Cannot assign ${typeLabel(actual.type)} to ${typeLabel(expected)}.`,
      );
      return;
    }
    const range = integerRange(target.kind === "subrange" ? target.base : target);
    if (
      actual.integer !== undefined &&
      range &&
      (actual.integer < range[0] || actual.integer > range[1])
    ) {
      this.report(
        file,
        expr,
        "value-range",
        `Value ${actual.integer} is outside ${typeLabel(expected)} range ${range[0]}..${range[1]}.`,
      );
    } else if (range && actual.integer === undefined && this.isNumeric(actual.type)) {
      const sourceRange = integerRange(this.project.valueType(actual.type));
      if (!sourceRange || sourceRange[0] < range[0] || sourceRange[1] > range[1]) {
        this.report(
          file,
          expr,
          "narrowing-conversion",
          `Potentially lossy conversion from ${typeLabel(actual.type)} to ${typeLabel(expected)}. Use an explicit conversion after validating the range.`,
          2,
        );
      }
    }
    if (target.kind === "subrange" && actual.integer !== undefined) {
      const source = this.fileForType(target, file);
      const low = this.infer(source, target.low).integer;
      const high = this.infer(source, target.high).integer;
      if (
        low !== undefined &&
        high !== undefined &&
        (actual.integer < low || actual.integer > high)
      ) {
        this.report(file, expr, "subrange", `Value ${actual.integer} is outside ${low}..${high}.`);
      }
    }
    if (target.kind === "string" && target.length && expr.kind === "literal") {
      const size = this.infer(this.fileForType(target, file), target.length).integer;
      const content = expr.token.text
        .replace(/^(?:W?STRING#)?['"]|['"]$/gi, "")
        .replace(/\$(?:[0-9a-f]{4}|[0-9a-f]{2}|.)/gi, "_");
      if (size !== undefined && BigInt(content.length) > size) {
        this.report(file, expr, "string-truncation", `String literal exceeds capacity ${size}.`);
      }
    }
  }
  private aggregate(
    file: ParsedFile,
    expr: Extract<Expr, { kind: "aggregate" }>,
    target: TypeNode,
  ) {
    if (target.kind === "array") {
      let count = 0n;
      for (const arg of expr.values) {
        if (arg.value.kind === "call" && arg.value.callee.kind === "literal") {
          const repetitions = this.infer(file, arg.value.callee).integer;
          if (repetitions === undefined || repetitions < 0n) {
            this.report(
              file,
              arg.value.callee,
              "array-repeat",
              "Array initializer repetition must be a nonnegative integer constant.",
            );
          } else {
            count += repetitions * BigInt(arg.value.args.length);
          }
          for (const value of arg.value.args) {
            this.assign(file, value.value, target.element, this.infer(file, value.value));
          }
        } else {
          count++;
          this.assign(file, arg.value, target.element, this.infer(file, arg.value));
        }
      }
      const source = this.fileForType(target, file);
      const sizes = target.bounds.map((bound) => {
        if (!bound.low || !bound.high) {
          return undefined;
        }
        const low = this.infer(source, bound.low).integer;
        const high = this.infer(source, bound.high).integer;
        return low !== undefined && high !== undefined ? high - low + 1n : undefined;
      });
      if (sizes.every((size): size is bigint => size !== undefined)) {
        const capacity = sizes.reduce((product, size) => product * size, 1n);
        if (count > capacity) {
          this.report(
            file,
            expr,
            "array-initializer-size",
            `Too many array initializer values: ${count} for ${capacity} elements.`,
          );
        }
      }
      return;
    }
    const symbol = this.project.typeSymbol(target);
    if (symbol && ["struct", "union", "functionBlock"].includes(symbol.kind)) {
      for (const arg of expr.values) {
        const field = this.project
          .allMembers(symbol)
          .find((member) => key(member.name) === arg.name?.upper);
        if (!field) {
          this.report(
            file,
            arg.name ?? arg,
            "initializer-field",
            `Unknown initializer field ${arg.name?.text ?? "<unnamed>"} in ${symbol.name}.`,
          );
        } else {
          if (arg.name) {
            this.use(file, arg.name, field);
          }
          this.assign(file, arg.value, field.type, this.infer(file, arg.value));
        }
      }
      return;
    }
    this.report(
      file,
      expr,
      "initializer-type",
      `An aggregate initializer is not valid for ${typeLabel(target)}.`,
    );
  }
}
