import type { Constant, Expression, Variable } from "./model.ts";
import { integerRange, type PlcType } from "./types.ts";

export type ScalarType = Extract<PlcType, { kind: "bool" | "integer" | "bits" | "float" }>;
export function integerType(type: PlcType): type is Extract<PlcType, { kind: "integer" | "bits" }> {
  return type.kind === "integer" || type.kind === "bits";
}
export function floatMaximum(type: Extract<PlcType, { kind: "float" }>): number {
  return type.bits === 32 ? Math.fround((2 - 2 ** -23) * 2 ** 127) : Number.MAX_VALUE;
}

export function saturateFloat(value: number, type: Extract<PlcType, { kind: "float" }>): number {
  // Clamp before target rounding so a finite source cannot round to infinity.
  // Comparisons leave signed zero intact; min/max substitution is unnecessary.
  const maximum = floatMaximum(type);
  const clipped = value < -maximum ? -maximum : value > maximum ? maximum : value;
  return type.bits === 32 ? Math.fround(clipped) : clipped;
}

export function parseInteger(text: string): bigint {
  const clean = text.replaceAll("_", "").replace(/n$/, "");
  const negative = clean.startsWith("-");
  const unsigned = negative ? clean.slice(1) : clean;
  if (/^0[xob]/i.test(unsigned)) return (negative ? -1n : 1n) * BigInt(unsigned);
  const match = /^(\d+)(?:\.(\d*))?(?:e([+-]?\d+))?$/i.exec(unsigned);
  if (!match) throw new Error("Expected an exact integer literal.");
  const fraction = match[2] ?? "";
  const exponent = Number(match[3] ?? 0) - fraction.length;
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 400)
    throw new Error("Integer literal exponent is out of range.");
  let value = BigInt(match[1]! + fraction);
  if (exponent >= 0) value *= 10n ** BigInt(exponent);
  else {
    const divisor = 10n ** BigInt(-exponent);
    if (value % divisor) throw new Error("Integer literals cannot have a fractional part.");
    value /= divisor;
  }
  return negative ? -value : value;
}
export function constantFits(value: Constant, type: PlcType): boolean {
  if (type.kind === "bool") return value.kind === "bool" && typeof value.value === "boolean";
  if (integerType(type)) {
    if (value.kind !== "integer" || !/^(?:0|-?[1-9][0-9]*)$/.test(value.value)) return false;
    const [minimum, maximum] = integerRange(type),
      number = BigInt(value.value);
    return number >= minimum && number <= maximum;
  }
  if (type.kind === "float")
    return (
      value.kind === "float" &&
      Number.isFinite(value.value) &&
      (type.bits === 64 || Object.is(Math.fround(value.value), value.value))
    );
  return false;
}
export function canAssign(source: PlcType, destination: PlcType, value?: Constant): boolean {
  if (value) {
    if (source.kind !== destination.kind || !constantFits(value, destination)) return false;
    if (
      source.kind === "float" &&
      destination.kind === "float" &&
      source.bits > destination.bits &&
      value.kind === "float"
    )
      return Object.is(Math.fround(value.value), value.value);
    return true;
  }
  if (source.id === destination.id) return true;
  if (source.kind === "integer" && destination.kind === "integer") {
    const [fromMin, fromMax] = integerRange(source),
      [toMin, toMax] = integerRange(destination);
    return fromMin >= toMin && fromMax <= toMax;
  }
  return source.kind === "float" && destination.kind === "float" && source.bits <= destination.bits;
}
export function fold(
  expression: Expression,
  variables: ReadonlyMap<string, Variable>,
  types?: ReadonlyMap<string, PlcType>,
): Constant | undefined {
  if (expression.kind === "constant") return expression.value;
  if (expression.kind === "copy") return fold(expression.operand, variables, types);
  if (expression.kind === "length") {
    const type = types?.get(expression.operand.type);
    const receiver =
      expression.operand.kind === "load" ? variables.get(expression.operand.place.root) : undefined;
    const pure =
      expression.operand.kind === "load" &&
      expression.operand.place.path.every((segment) => segment.kind === "field") &&
      Boolean(receiver?.initial || receiver?.storage === "input" || receiver?.storage === "output");
    if (type?.kind === "array" && (pure || fold(expression.operand, variables, types)))
      return { kind: "integer", value: String(type.length) };
    return undefined;
  }
  if (expression.kind === "record") {
    const fields: Record<string, Constant> = Object.create(null);
    for (const [name, operand] of Object.entries(expression.fields)) {
      const value = fold(operand, variables, types);
      if (!value) return undefined;
      fields[name] = value;
    }
    return { kind: "record", fields };
  }
  if (expression.kind === "array") {
    const items = expression.items.map((item) => fold(item, variables, types));
    return items.every((item): item is Constant => item !== undefined)
      ? { kind: "array", items }
      : undefined;
  }
  if (expression.kind === "load" && !expression.place.path.length) {
    const variable = variables.get(expression.place.root);
    return variable?.storage === "constant" ? variable.initial : undefined;
  }
  if (expression.kind === "convert") {
    const value = fold(expression.operand, variables, types);
    const target = types?.get(expression.type);
    if (value?.kind === "integer" && target) {
      if (integerType(target))
        return {
          kind: "integer",
          value: String(
            expression.policy === "exact"
              ? BigInt(value.value)
              : applyIntegerPolicy(BigInt(value.value), target, expression.policy),
          ),
        };
      if (target.kind === "float")
        return {
          kind: "float",
          value: target.bits === 32 ? Math.fround(Number(value.value)) : Number(value.value),
        };
    }
    if (value?.kind === "float" && target?.kind === "float")
      return {
        kind: "float",
        value:
          expression.policy === "saturate"
            ? saturateFloat(value.value, target)
            : target.bits === 32
              ? Math.fround(value.value)
              : value.value,
      };
    return undefined;
  }
  if (expression.kind === "unary") {
    const value = fold(expression.operand, variables, types);
    if (value?.kind === "duration" && expression.operator === "timeToMilliseconds")
      return { kind: "integer", value: String(BigInt(value.nanoseconds) / 1_000_000n) };
    if (value?.kind === "bool" && expression.operator === "not")
      return { kind: "bool", value: !value.value };
    if (value?.kind === "integer" && expression.operator === "bitNot") {
      const target = types?.get(expression.type);
      if (target?.kind === "bits")
        return {
          kind: "integer",
          value: String(applyIntegerPolicy(~BigInt(value.value), target, "wrap")),
        };
    }
    if (value?.kind === "integer" && expression.operator === "negate")
      return { kind: "integer", value: String(-BigInt(value.value)) };
    if (value?.kind === "float" && expression.operator === "negate")
      return { kind: "float", value: -value.value };
  }
  if (expression.kind === "binary") {
    const left = fold(expression.left, variables, types),
      right = fold(expression.right, variables, types);
    if (!left || !right || left.kind !== right.kind) return undefined;
    if (left.kind === "bool" && right.kind === "bool") {
      if (expression.operator === "and") return { kind: "bool", value: left.value && right.value };
      if (expression.operator === "or") return { kind: "bool", value: left.value || right.value };
      if (expression.operator === "equal")
        return { kind: "bool", value: left.value === right.value };
      if (expression.operator === "notEqual")
        return { kind: "bool", value: left.value !== right.value };
    }
    if (
      (left.kind === "integer" && right.kind === "integer") ||
      (left.kind === "float" && right.kind === "float") ||
      (left.kind === "duration" && right.kind === "duration") ||
      (left.kind === "calendar" && right.kind === "calendar") ||
      (left.kind === "string" && right.kind === "string")
    ) {
      const a =
        left.kind === "integer"
          ? BigInt(left.value)
          : left.kind === "duration"
            ? BigInt(left.nanoseconds)
            : left.value;
      const b =
        right.kind === "integer"
          ? BigInt(right.value)
          : right.kind === "duration"
            ? BigInt(right.nanoseconds)
            : right.value;
      switch (expression.operator) {
        case "equal":
          return { kind: "bool", value: a === b };
        case "notEqual":
          return { kind: "bool", value: a !== b };
        case "less":
          return { kind: "bool", value: a < b };
        case "lessEqual":
          return { kind: "bool", value: a <= b };
        case "greater":
          return { kind: "bool", value: a > b };
        case "greaterEqual":
          return { kind: "bool", value: a >= b };
      }
      if (left.kind !== "integer" && left.kind !== "float") return undefined;
      if (typeof a === "bigint" && typeof b === "bigint") {
        let value: bigint;
        switch (expression.operator) {
          case "add":
            value = a + b;
            break;
          case "subtract":
            value = a - b;
            break;
          case "multiply":
            value = a * b;
            break;
          case "divide":
            if (b === 0n) return undefined;
            value = a / b;
            break;
          case "remainder":
            if (b === 0n) return undefined;
            value = a % b;
            break;
          case "bitAnd":
            value = a & b;
            break;
          case "bitOr":
            value = a | b;
            break;
          case "bitXor":
            value = a ^ b;
            break;
          case "shiftLeft":
            if (b < 0n || b > 63n) return undefined;
            value = a << b;
            break;
          case "shiftRight":
            if (b < 0n || b > 63n) return undefined;
            value = a >> b;
            break;
          default:
            return undefined;
        }
        const target = types?.get(expression.type);
        if (target && integerType(target) && (expression.policy || target.kind === "bits"))
          value = applyIntegerPolicy(value, target, expression.policy ?? "wrap");
        return { kind: "integer", value: String(value) };
      }
      if (typeof a === "number" && typeof b === "number") {
        let value: number;
        switch (expression.operator) {
          case "add":
            value = a + b;
            break;
          case "subtract":
            value = a - b;
            break;
          case "multiply":
            value = a * b;
            break;
          case "divide":
            value = a / b;
            break;
          case "remainder":
            value = a % b;
            break;
          default:
            return undefined;
        }
        return {
          kind: "float",
          value:
            types?.get(expression.type)?.kind === "float" && expression.type === "REAL"
              ? Math.fround(value)
              : value,
        };
      }
    }
  }
  return undefined;
}
export type IntegerInterval = readonly [bigint, bigint];
export function interval(
  expression: Expression,
  types: ReadonlyMap<string, PlcType>,
  variables: ReadonlyMap<string, Variable>,
  ranges: ReadonlyMap<string, IntegerInterval> = new Map(),
): IntegerInterval | undefined {
  if (expression.kind === "length") {
    const array = types.get(expression.operand.type);
    if (array?.kind === "array") return [BigInt(array.length), BigInt(array.length)];
  }
  const value = fold(expression, variables, types);
  if (value?.kind === "integer") return [BigInt(value.value), BigInt(value.value)];
  const type = types.get(expression.type);
  if (!type || !integerType(type)) return undefined;
  if (expression.kind === "load") return ranges.get(expression.place.root) ?? integerRange(type);
  if (expression.kind === "convert")
    return expression.policy === "exact"
      ? interval(expression.operand, types, variables, ranges)
      : integerRange(type);
  if (expression.kind === "unary" && expression.operator === "negate") {
    const operand = interval(expression.operand, types, variables, ranges);
    return operand && [-operand[1], -operand[0]];
  }
  if (expression.kind === "binary" && !expression.policy) {
    const a = interval(expression.left, types, variables, ranges),
      b = interval(expression.right, types, variables, ranges);
    if (!a || !b) return undefined;
    switch (expression.operator) {
      case "add":
        return [a[0] + b[0], a[1] + b[1]];
      case "subtract":
        return [a[0] - b[1], a[1] - b[0]];
      case "multiply": {
        const values = [a[0] * b[0], a[0] * b[1], a[1] * b[0], a[1] * b[1]];
        return [values.reduce((x, y) => (x < y ? x : y)), values.reduce((x, y) => (x > y ? x : y))];
      }
      case "divide": {
        if (b[0] <= 0n && b[1] >= 0n) return undefined;
        const values = [a[0] / b[0], a[0] / b[1], a[1] / b[0], a[1] / b[1]];
        return [values.reduce((x, y) => (x < y ? x : y)), values.reduce((x, y) => (x > y ? x : y))];
      }
      case "remainder": {
        if (b[0] <= 0n && b[1] >= 0n) return undefined;
        const maximum =
          [b[0], b[1]].map((n) => (n < 0n ? -n : n)).reduce((x, y) => (x > y ? x : y)) - 1n;
        return [a[0] < 0n ? -maximum : 0n, a[1] > 0n ? maximum : 0n];
      }
    }
  }
  return integerRange(type);
}
export function applyIntegerPolicy(
  value: bigint,
  type: Extract<PlcType, { kind: "integer" | "bits" }>,
  policy: "wrap" | "saturate",
): bigint {
  const [minimum, maximum] = integerRange(type);
  if (policy === "saturate") return value < minimum ? minimum : value > maximum ? maximum : value;
  return type.kind === "integer" && type.signed
    ? BigInt.asIntN(type.bits, value)
    : BigInt.asUintN(type.bits, value);
}

export function scalarIssue(
  expression: Expression,
  types: ReadonlyMap<string, PlcType>,
  variables: ReadonlyMap<string, Variable>,
  ranges: ReadonlyMap<string, IntegerInterval> = new Map(),
): string | undefined {
  const type = types.get(expression.type);
  if (!type || !["bool", "integer", "bits", "float"].includes(type.kind))
    return "Unknown scalar expression type.";
  if (expression.kind === "constant")
    return constantFits(expression.value, type)
      ? undefined
      : "Literal is outside its PLC type or has the wrong domain.";
  if (expression.kind === "load" || expression.kind === "call") return undefined;
  if (
    ("operand" in expression && !types.has(expression.operand.type)) ||
    ("left" in expression &&
      (!types.has(expression.left.type) || !types.has(expression.right.type)))
  )
    return "Unknown operand type.";
  const operand = (value: Expression): PlcType => {
    const result = types.get(value.type);
    if (!result) throw new Error("Missing checked operand type");
    return result;
  };
  if (expression.kind === "convert") {
    if (!["exact", "wrap", "saturate"].includes(expression.policy))
      return "Unknown numeric conversion policy.";
    const source = operand(expression.operand),
      value = fold(expression.operand, variables, types);
    if (source.kind === "bool" || type.kind === "bool")
      return "Numeric conversions cannot use BOOL.";
    if (expression.policy === "exact") {
      if (
        canAssign(source, type, value) ||
        (value && integerType(source) && integerType(type) && constantFits(value, type))
      )
        return undefined;
      if (integerType(source) && type.kind === "float") {
        if (value?.kind === "integer") {
          const converted =
            type.bits === 32 ? Math.fround(Number(value.value)) : Number(value.value);
          if (
            Number.isFinite(converted) &&
            Number.isInteger(converted) &&
            BigInt(converted) === BigInt(value.value)
          )
            return undefined;
        }
        const [minimum, maximum] =
          interval(expression.operand, types, variables, ranges) ?? integerRange(source);
        const limit = 1n << BigInt(type.bits === 32 ? 24 : 53);
        if (minimum >= -limit && maximum <= limit) return undefined;
      }
      if (integerType(source) && integerType(type)) {
        const [fromMin, fromMax] =
            interval(expression.operand, types, variables, ranges) ?? integerRange(source),
          [toMin, toMax] = integerRange(type);
        if (fromMin >= toMin && fromMax <= toMax) return undefined;
      }
      return "Exact conversion cannot be proved lossless.";
    }
    if (expression.policy === "saturate" && source.kind === "float" && type.kind === "float")
      return undefined;
    return integerType(source) && integerType(type)
      ? undefined
      : expression.policy === "saturate"
        ? "Saturate conversions require two integer/bit-string operands or two floating operands."
        : "Wrap conversions require integer or bit-string operands.";
  }
  if (expression.kind === "unary") {
    const source = operand(expression.operand);
    if (expression.operator === "timeToMilliseconds")
      return source.id === "TIME" && source.kind === "duration" && type.id === "UDINT"
        ? undefined
        : "timeToMilliseconds requires TIME and returns UDINT.";
    if (expression.operator === "not")
      return type.kind === "bool" && source.kind === "bool"
        ? undefined
        : "Logical negation requires BOOL.";
    if (expression.operator === "bitNot")
      return type.kind === "bits" && source.id === type.id
        ? undefined
        : "Bitwise complement requires a bit string.";
    if (source.id !== type.id || !(type.kind === "integer" || type.kind === "float"))
      return "Numeric negation requires one arithmetic type.";
  } else if (expression.kind === "binary") {
    const left = operand(expression.left),
      right = operand(expression.right);
    if (expression.operator === "and" || expression.operator === "or")
      return type.kind === "bool" && left.kind === "bool" && right.kind === "bool"
        ? undefined
        : "Logical operators require BOOL.";
    if (
      ["equal", "notEqual", "less", "lessEqual", "greater", "greaterEqual"].includes(
        expression.operator,
      )
    ) {
      return type.kind === "bool" &&
        left.id === right.id &&
        ["bool", "integer", "bits", "float"].includes(left.kind) &&
        (left.kind !== "bool" || ["equal", "notEqual"].includes(expression.operator))
        ? undefined
        : "Comparison operands need the same PLC domain.";
    }
    if (["bitAnd", "bitOr", "bitXor", "shiftLeft", "shiftRight"].includes(expression.operator)) {
      if (type.kind !== "bits" || left.id !== type.id)
        return "Bitwise operators require bit strings.";
      if (expression.operator === "shiftLeft" || expression.operator === "shiftRight") {
        const count = fold(expression.right, variables, types);
        return count?.kind === "integer" &&
          BigInt(count.value) >= 0n &&
          BigInt(count.value) < BigInt(type.bits)
          ? undefined
          : "Shift count must be a compile-time integer within the bit width.";
      }
      return right.id === type.id ? undefined : "Bit-string widths differ.";
    }
    if (
      left.id !== type.id ||
      right.id !== type.id ||
      (type.kind !== "integer" && type.kind !== "float")
    )
      return "Arithmetic operands need one integer or floating type.";
    if (expression.policy)
      return type.kind === "integer" &&
        ["add", "subtract", "multiply"].includes(expression.operator)
        ? undefined
        : "Explicit arithmetic policies require integer addition, subtraction or multiplication.";
    if (
      (expression.operator === "divide" || expression.operator === "remainder") &&
      type.kind === "integer"
    ) {
      const divisor = interval(expression.right, types, variables, ranges);
      if (!divisor || (divisor[0] <= 0n && divisor[1] >= 0n))
        return "Division requires a proved nonzero divisor.";
      const dividend = interval(expression.left, types, variables, ranges);
      const [minimum] = integerRange(type);
      if (
        type.signed &&
        dividend &&
        dividend[0] <= minimum &&
        divisor[0] <= -1n &&
        divisor[1] >= -1n
      )
        return "Signed minimum divided by -1 cannot be represented.";
    }
  } else return "Expression has not been reduced to a scalar operation.";
  if (integerType(type)) {
    const result = interval(expression, types, variables, ranges),
      [minimum, maximum] = integerRange(type);
    if (!result || result[0] < minimum || result[1] > maximum)
      return "Arithmetic may overflow; widen the result or use an explicit wrap/saturate operation.";
  } else if (type.kind === "float") {
    const result = fold(expression, variables, types);
    if (result)
      return constantFits(result, type)
        ? undefined
        : "Floating result is not finite or representable.";
    if (expression.kind === "binary") {
      const lhs = fold(expression.left, variables, types);
      const rhs = fold(expression.right, variables, types);
      if (
        ["add", "subtract"].includes(expression.operator) &&
        (lhs?.kind === "float" || rhs?.kind === "float")
      ) {
        // Addition/subtraction and nearest rounding are monotone. Checking both
        // finite endpoints proves every finite input without changing its arithmetic.
        const maximum = floatMaximum(type);
        const finite = [-maximum, maximum].every((endpoint) => {
          const a = lhs?.kind === "float" ? lhs.value : endpoint;
          const b = rhs?.kind === "float" ? rhs.value : endpoint;
          const value = expression.operator === "add" ? a + b : a - b;
          return Number.isFinite(type.bits === 32 ? Math.fround(value) : value);
        });
        if (finite) return undefined;
      }
      if (
        rhs?.kind === "float" &&
        rhs.value === 1 &&
        ["multiply", "divide"].includes(expression.operator)
      )
        return undefined;
    } else if (expression.kind === "unary") return undefined;
    return "Floating arithmetic must prove a finite result.";
  }
  return undefined;
}
