import {
  type Constant,
  type CoreExpression,
  type GeneratedObject,
  integerRange,
  floatMaximum,
  integerType,
  type PlcType,
} from "@vplc/compiler/ir";

export function scalarLiteral(value: Constant, type: string): string {
  if (value.kind === "bool") return value.value ? "TRUE" : "FALSE";
  if (value.kind === "integer") return `${type}#${value.value}`;
  if (value.kind === "float") {
    // String(-0) loses the IEEE sign; keep it explicit in target float literals.
    const text = Object.is(value.value, -0) ? "-0.0" : String(value.value).replace(/e/i, "E");
    return `${type}#${text}`;
  }
  throw new Error("Expected verified scalar constant");
}

export class NumericLowering {
  readonly objects: GeneratedObject[] = [];
  private readonly helpers = new Map<string, string>();

  constructor(
    private readonly types: ReadonlyMap<string, PlcType>,
    private readonly allocate: (label: string) => string,
  ) {}

  prepare(value: CoreExpression): void {
    if (value.kind === "load") {
      value.path?.forEach((segment) => {
        if (segment.kind === "index") this.prepare(segment.value);
      });
    }
    if (value.kind === "borrow") {
      value.place.path.forEach((segment) => {
        if (segment.kind === "index") this.prepare(segment.value);
      });
    }
    if (value.kind === "binary") {
      this.prepare(value.left);
      this.prepare(value.right);
      if (value.policy) this.arithmetic(value.type, value.operator, value.policy);
    }
    if (value.kind === "unary") this.prepare(value.operand);
    if (value.kind === "convert") {
      this.prepare(value.operand);
      if (value.policy === "saturate") this.saturation(value.operand.type, value.type);
    }
  }

  render(value: CoreExpression, operands: readonly string[]): string {
    if (value.kind === "convert") {
      return value.policy === "saturate"
        ? `${this.saturation(value.operand.type, value.type)}(${operands[0]})`
        : `TO_${value.type}(${operands[0]})`;
    }
    if (value.kind === "unary") {
      // Avoid signed intermediate casts: TIME spans the complete UDINT range.
      if (value.operator === "timeToMilliseconds") return `TIME_TO_UDINT(${operands[0]})`;
      return value.operator === "not"
        ? `(NOT ${operands[0]})`
        : `TO_${value.type}(${value.operator === "negate" ? "-" : "NOT "}${operands[0]})`;
    }
    if (value.kind !== "binary") throw new Error("Expected numeric operation");
    if (value.policy) {
      return `${this.arithmetic(value.type, value.operator, value.policy)}(${operands.join(", ")})`;
    }
    if (value.operator === "shiftLeft" || value.operator === "shiftRight") {
      const shift = value.operator === "shiftLeft" ? "SHL" : "SHR";
      return `TO_${value.type}(${shift}(${operands.join(", ")}))`;
    }
    const tokens: Readonly<Record<string, string>> = {
      add: "+",
      subtract: "-",
      multiply: "*",
      divide: "/",
      remainder: "MOD",
      equal: "=",
      notEqual: "<>",
      less: "<",
      lessEqual: "<=",
      greater: ">",
      greaterEqual: ">=",
      bitAnd: "AND",
      bitOr: "OR",
      bitXor: "XOR",
    };
    const token = tokens[value.operator];
    if (!token) throw new Error("Boolean short-circuit operation was not normalized");
    const text =
      value.operator === "remainder"
        ? `(${operands[0]} - (${operands[0]} / ${operands[1]}) * ${operands[1]})`
        : `(${operands[0]} ${token} ${operands[1]})`;
    return value.type === "BOOL" ? text : `TO_${value.type}(${text})`;
  }

  private helper(
    key: string,
    type: string,
    inputs: readonly [string, string][],
    body: (name: string) => string,
    locals = "",
  ): string {
    const existing = this.helpers.get(key);
    if (existing) return existing;
    const name = this.allocate(`numeric_${key}`);
    this.helpers.set(key, name);
    const parameters = inputs
      .map(([input, inputType]) => `    ${input} : ${inputType};`)
      .join("\n");
    const variables = locals
      ? `VAR
${locals}
END_VAR
`
      : "";
    const declaration = `FUNCTION ${name} : ${type}
VAR_INPUT
${parameters}
END_VAR
${variables}`;
    this.objects.push({
      id: `numeric:${key}`,
      kind: "function",
      name,
      declaration,
      implementation: body(name),
    });
    return name;
  }

  private add64(): string {
    // XOR forms the sum bits; each carry moves left until it exits the 64-bit word.
    // This gives modulo 2^64 addition without relying on target integer overflow.
    return this.helper(
      "add64",
      "LWORD",
      [
        ["a", "LWORD"],
        ["b", "LWORD"],
      ],
      (name) => `x := a;
y := b;
FOR i := 1 TO 64 DO
    carry := SHL(x AND y, 1);
    x := x XOR y;
    y := carry;
END_FOR;
${name} := x;
`,
      `    x, y, carry : LWORD;
    i : UINT;`,
    );
  }

  private wrap64(operator: string): string {
    const add = this.add64();
    if (operator === "add") return add;
    if (operator === "subtract") {
      // Two's complement negation and addition use the same modulo word operation.
      return this.helper(
        "subtract64",
        "LWORD",
        [
          ["a", "LWORD"],
          ["b", "LWORD"],
        ],
        (name) => `${name} := ${add}(a, ${add}(NOT b, LWORD#1));
`,
      );
    }
    if (operator !== "multiply") throw new Error("Unsupported verified wrapping operation");
    // Shift-and-add retains exactly the low 64 product bits.
    return this.helper(
      "multiply64",
      "LWORD",
      [
        ["a", "LWORD"],
        ["b", "LWORD"],
      ],
      (name) => `x := a;
y := b;
result := LWORD#0;
FOR i := 1 TO 64 DO
    IF (y AND LWORD#1) <> LWORD#0 THEN
        result := ${add}(result, x);
    END_IF;
    x := SHL(x, 1);
    y := SHR(y, 1);
END_FOR;
${name} := result;
`,
      `    x, y, result : LWORD;
    i : UINT;`,
    );
  }

  private arithmetic(typeId: string, operator: string, policy: "wrap" | "saturate"): string {
    const type = this.types.get(typeId);
    if (type?.kind !== "integer") throw new Error("Expected verified integer arithmetic");
    const token = operator === "add" ? "+" : operator === "subtract" ? "-" : "*";
    const key = `${policy}_${operator}_${typeId}`;
    if (policy === "wrap") {
      if (type.bits === 64) {
        const operation = this.wrap64(operator);
        return this.helper(
          key,
          typeId,
          [
            ["a", typeId],
            ["b", typeId],
          ],
          (
            name,
          ) => `${name} := LWORD_TO_${typeId}(${operation}(${typeId}_TO_LWORD(a), ${typeId}_TO_LWORD(b)));
`,
        );
      }
      const wide = !type.signed && operator !== "subtract" ? "ULINT" : "LINT";
      return this.helper(
        key,
        typeId,
        [
          ["a", typeId],
          ["b", typeId],
        ],
        (
          name,
        ) => `${name} := ${wide}_TO_${typeId}(${typeId}_TO_${wide}(a) ${token} ${typeId}_TO_${wide}(b));
`,
      );
    }

    const [minimum, maximum] = integerRange(type);
    const min = `${typeId}#${minimum}`,
      max = `${typeId}#${maximum}`,
      zero = `${typeId}#0`;
    return this.helper(
      key,
      typeId,
      [
        ["a", typeId],
        ["b", typeId],
      ],
      (name) => {
        const clamp = (
          condition: string,
          endpoint: string,
          depth = "",
        ) => `${depth}IF ${condition} THEN
${depth}    ${name} := ${endpoint};
${depth}    RETURN;
${depth}END_IF;
`;
        let body: string;
        if (!type.signed) {
          // Unsigned subtraction has only underflow; the other operations have only overflow.
          if (operator === "add") body = clamp(`a > ${max} - b`, max);
          else if (operator === "subtract") body = clamp("a < b", zero);
          else
            body = `IF b <> ${zero} THEN
${clamp(`a > ${max} / b`, max, "    ")}END_IF;
`;
        } else if (operator === "add") {
          body = `IF b > ${zero} THEN
${clamp(`a > ${max} - b`, max, "    ")}ELSIF b < ${zero} THEN
${clamp(`a < ${min} - b`, min, "    ")}END_IF;
`;
        } else if (operator === "subtract") {
          body = `IF b < ${zero} THEN
${clamp(`a > ${max} + b`, max, "    ")}ELSIF b > ${zero} THEN
${clamp(`a < ${min} + b`, min, "    ")}END_IF;
`;
        } else {
          // Handle zero first, then divide the endpoint before multiplying. Each sign
          // quadrant tests representability without forming an overflowing product.
          body =
            clamp(`a = ${zero}`, zero) +
            clamp(`b = ${zero}`, zero) +
            `IF a > ${zero} THEN
    IF b > ${zero} THEN
${clamp(`a > ${max} / b`, max, "        ")}    ELSE
${clamp(`b < ${min} / a`, min, "        ")}    END_IF;
ELSE
    IF b > ${zero} THEN
${clamp(`a < ${min} / b`, min, "        ")}    ELSE
${clamp(`a < ${max} / b`, max, "        ")}    END_IF;
END_IF;
`;
        }
        return `${body}${name} := a ${token} b;
`;
      },
    );
  }

  private saturation(sourceId: string, targetId: string): string {
    const source = this.types.get(sourceId),
      target = this.types.get(targetId);
    if (source?.kind === "float" && target?.kind === "float") {
      // Widening cannot exceed the destination's finite range. Identity
      // conversions are removed by normalization; neither needs a helper.
      if (source.bits <= target.bits) return `TO_${targetId}`;
      const maximum = floatMaximum(target);
      const literal = (value: number, type: string): string =>
        scalarLiteral({ kind: "float", value }, type);
      return this.helper(
        `saturate_${sourceId}_${targetId}`,
        targetId,
        [["value", sourceId]],
        (name) => `IF value < ${literal(-maximum, sourceId)} THEN
    ${name} := ${literal(-maximum, targetId)};
    RETURN;
END_IF;
IF value > ${literal(maximum, sourceId)} THEN
    ${name} := ${literal(maximum, targetId)};
    RETURN;
END_IF;
${name} := TO_${targetId}(value);
`,
      );
    }
    if (!source || !target || !integerType(source) || !integerType(target)) {
      throw new Error("Expected verified integer saturation");
    }
    const [fromMin, fromMax] = integerRange(source),
      [toMin, toMax] = integerRange(target);
    return this.helper(
      `saturate_${sourceId}_${targetId}`,
      targetId,
      [["value", sourceId]],
      (name) => {
        let body = "";
        if (fromMin < toMin)
          body += `IF value < ${sourceId}#${toMin} THEN
    ${name} := ${targetId}#${toMin};
    RETURN;
END_IF;
`;
        if (fromMax > toMax)
          body += `IF value > ${sourceId}#${toMax} THEN
    ${name} := ${targetId}#${toMax};
    RETURN;
END_IF;
`;
        return `${body}${name} := TO_${targetId}(value);
`;
      },
    );
  }
}
