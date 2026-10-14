import {
  comparisonOperators,
  type Constant,
  type Expression,
  type Variable,
  type Place,
} from "./model.ts";
import { constantFits, interval, scalarIssue, type IntegerInterval } from "./scalars.ts";
import { domainConstantFits, domainIssue } from "./domains.ts";
import { primitiveTypes, type PlcType } from "./types.ts";

export function aggregate(type: PlcType | undefined): boolean {
  return type?.kind === "record" || type?.kind === "array";
}
export function valueFits(
  value: Constant,
  type: PlcType,
  types: ReadonlyMap<string, PlcType>,
): boolean {
  if (type.kind === "duration" || type.kind === "calendar") return domainConstantFits(value, type);
  if (type.kind === "enum")
    return value.kind === "integer" && type.members.some((member) => member.value === value.value);
  if (type.kind === "string")
    return (
      value.kind === "string" &&
      !value.value.includes("\0") &&
      (type.encoding === "utf8"
        ? new TextEncoder().encode(value.value).length <= type.capacity
        : value.value.length <= type.capacity)
    );
  if (type.kind === "array")
    return (
      value.kind === "array" &&
      value.items.length === type.length &&
      value.items.every((item) => valueFits(item, types.get(type.element)!, types))
    );
  if (type.kind === "record")
    return (
      value.kind === "record" &&
      Object.keys(value.fields).length === type.fields.length &&
      type.fields.every(
        (field) =>
          Object.hasOwn(value.fields, field.name) &&
          valueFits(value.fields[field.name]!, types.get(field.type)!, types),
      )
    );
  return constantFits(value, type);
}
export function defaultValue(typeId: string, types: ReadonlyMap<string, PlcType>): Constant {
  const type = types.get(typeId);
  if (!type) throw new Error("Unknown default-value type");
  if (type.kind === "bool") return { kind: "bool", value: false };
  if (type.kind === "float") return { kind: "float", value: 0 };
  if (type.kind === "string") return { kind: "string", value: "" };
  if (type.kind === "enum")
    return {
      kind: "integer",
      value: type.members.find((member) => member.value === "0")?.value ?? type.members[0]!.value,
    };
  if (type.kind === "array")
    return {
      kind: "array",
      items: Array.from({ length: type.length }, () => defaultValue(type.element, types)),
    };
  if (type.kind === "record")
    return {
      kind: "record",
      fields: Object.fromEntries(
        type.fields.map((field) => [field.name, defaultValue(field.type, types)]),
      ),
    };
  if (type.kind === "duration") return { kind: "duration", nanoseconds: "0" };
  if (type.kind === "calendar")
    return {
      kind: "calendar",
      value:
        type.domain === "date"
          ? "1970-01-01"
          : type.domain === "timeOfDay"
            ? "00:00:00.000"
            : "1970-01-01T00:00:00",
    };
  if (type.kind === "integer" || type.kind === "bits") return { kind: "integer", value: "0" };
  throw new Error("Unsupported default-value type");
}
export function placeType(
  place: Place,
  types: ReadonlyMap<string, PlcType>,
  variables: ReadonlyMap<string, Variable>,
  ranges: ReadonlyMap<string, IntegerInterval> = new Map(),
  writable = false,
): { type?: string; issue?: string } {
  const root = variables.get(place.root);
  if (!root) return { issue: "Unknown storage root." };
  if (
    writable &&
    (root.storage === "input" ||
      root.storage === "constant" ||
      root.storage === "blockOutput" ||
      (root.storage === "parameter" && root.mode !== "inOut") ||
      (!place.path.length && !root.mutable))
  )
    return { issue: "This storage is read-only." };
  let id = root.type;
  for (const segment of place.path) {
    const type = types.get(id);
    if (segment.kind === "field") {
      if (type?.kind === "block" && segment.name === "out" && type.output) {
        if (writable) return { issue: "Function block output views are read-only." };
        id = type.output;
        continue;
      }
      if (type?.kind !== "record") return { issue: "Field access requires a record." };
      const field = type.fields.find((field) => field.name === segment.name);
      if (!field) return { issue: "Unknown record field." };
      if (writable && field.readonly) return { issue: "This field is read-only." };
      id = field.type;
    } else {
      if (type?.kind !== "array") return { issue: "Index access requires a fixed array." };
      const indexType = types.get(segment.value.type),
        bounds = interval(segment.value, types, variables, ranges);
      if (
        indexType?.kind !== "integer" ||
        !bounds ||
        bounds[0] < BigInt(type.lowerBound) ||
        bounds[1] >= BigInt(type.lowerBound + type.length)
      )
        return { issue: "Array index must be proved within the declared bounds." };
      id = type.element;
    }
  }
  return { type: id };
}
export function aggregateIssue(
  value: Expression,
  types: ReadonlyMap<string, PlcType>,
): string | undefined {
  const type = types.get(value.type);
  if (!type) return "Unknown expression type.";
  if (value.kind === "constant")
    return valueFits(value.value, type, types)
      ? undefined
      : "Constant does not fit its closed PLC layout.";
  if (value.kind === "record")
    return type.kind === "record" &&
      Object.keys(value.fields).length === type.fields.length &&
      type.fields.every(
        (field) =>
          Object.hasOwn(value.fields, field.name) && value.fields[field.name]?.type === field.type,
      )
      ? undefined
      : "Record expression differs from its layout.";
  if (value.kind === "array")
    return type.kind === "array" &&
      value.items.length === type.length &&
      value.items.every((item) => item.type === type.element)
      ? undefined
      : "Array expression differs from its layout.";
  if (value.kind === "copy")
    return aggregate(type) && value.operand.type === value.type
      ? undefined
      : "Copy requires one matching fixed aggregate.";
  if (value.kind === "convert") {
    const source = types.get(value.operand.type);
    return type.kind === "string" &&
      source?.kind === "string" &&
      source.encoding === type.encoding &&
      source.capacity <= type.capacity &&
      value.policy === "exact"
      ? undefined
      : "Unsupported aggregate/domain conversion.";
  }
  if (value.kind === "load" || value.kind === "call" || value.kind === "conditional")
    return undefined;
  if (value.kind === "binary" && comparisonOperators.has(value.operator)) {
    const left = types.get(value.left.type);
    return value.type === "BOOL" &&
      left &&
      ["enum", "string"].includes(left.kind) &&
      value.left.type === value.right.type &&
      (left.kind !== "enum" || ["equal", "notEqual"].includes(value.operator))
      ? undefined
      : "Comparison requires compatible scalar domains; object identity is unsupported.";
  }
  return "Operation is unsupported for this PLC domain.";
}

// Route a reduced expression to the checker that owns its PLC domain. A binary
// operation belongs to its operand domain, e.g. a TIME comparison yields BOOL.
export function expressionIssue(
  value: Expression,
  types: ReadonlyMap<string, PlcType>,
  variables: ReadonlyMap<string, Variable>,
  ranges: ReadonlyMap<string, IntegerInterval>,
): string | undefined {
  const kinds = [value.type, ...(value.kind === "binary" ? [value.left.type] : [])].map(
    (id) => types.get(id)?.kind ?? "",
  );
  if (kinds.some((kind) => ["duration", "calendar"].includes(kind)))
    return domainIssue(value, types);
  if (
    ["copy", "record", "array"].includes(value.kind) ||
    kinds.some((kind) => ["record", "array", "enum", "string"].includes(kind))
  )
    return aggregateIssue(value, types);
  return scalarIssue(value, types, variables, ranges);
}

// Validate all layout edges once before constants or places can traverse them.
export function layoutIssue(types: ReadonlyMap<string, PlcType>): string | undefined {
  for (const type of types.values()) {
    const canonical = primitiveTypes.find((item) => item.id === type.id);
    if (canonical) {
      if (
        type.kind !== canonical.kind ||
        ("bits" in canonical && (!("bits" in type) || type.bits !== canonical.bits)) ||
        ("signed" in canonical && (!("signed" in type) || type.signed !== canonical.signed)) ||
        ("domain" in canonical && (!("domain" in type) || type.domain !== canonical.domain))
      )
        return `Conflicting primitive type ${type.id}`;
      continue;
    }
    if (type.kind === "record") {
      if (
        !type.fields.length ||
        new Set(type.fields.map((field) => field.name)).size !== type.fields.length ||
        type.fields.some(
          (field) =>
            !field.name ||
            typeof field.readonly !== "boolean" ||
            (field.mode && field.mode !== "inOut") ||
            !types.has(field.type),
        )
      )
        return `Invalid closed record layout ${type.id}`;
    } else if (type.kind === "array") {
      if (
        !types.has(type.element) ||
        !Number.isSafeInteger(type.length) ||
        type.length < 1 ||
        type.length > 1_000_000 ||
        !Number.isInteger(type.lowerBound) ||
        type.lowerBound < -2147483648 ||
        type.lowerBound + type.length - 1 > 2147483647
      )
        return `Invalid fixed array layout ${type.id}`;
    } else if (type.kind === "enum") {
      if (
        type.base !== "DINT" ||
        types.get(type.base)?.kind !== "integer" ||
        !type.members.length ||
        new Set(type.members.map((member) => member.name)).size !== type.members.length ||
        new Set(type.members.map((member) => member.value)).size !== type.members.length ||
        type.members.some(
          (member) =>
            !member.name ||
            !constantFits({ kind: "integer", value: member.value }, types.get(type.base)!),
        )
      )
        return `Invalid enum layout ${type.id}`;
    } else if (type.kind === "string") {
      if (
        !Number.isInteger(type.capacity) ||
        type.capacity < 1 ||
        type.capacity > 65535 ||
        !["utf8", "utf16"].includes(type.encoding)
      )
        return `Invalid bounded string layout ${type.id}`;
    } else if (type.kind === "block") {
      if (!type.block || (type.output && types.get(type.output)?.kind !== "record"))
        return `Invalid block type ${type.id}`;
    } else return `Unsupported core type definition ${type.id}`;
  }
  const active = new Set<string>(),
    layouts = new Map<string, { size: number; height: number }>();
  const count = (id: string, depth: number): { size: number; height: number } => {
    if (active.has(id) || depth > 64)
      throw new Error(`Recursive or excessively nested by-value layout ${id}`);
    const cached = layouts.get(id);
    if (cached) {
      if (depth + cached.height > 64) throw new Error(`Layout nesting exceeds 64 levels ${id}`);
      return cached;
    }
    active.add(id);
    const type = types.get(id)!;
    const children =
      type.kind === "array"
        ? [count(type.element, depth + 1)]
        : type.kind === "record"
          ? type.fields.map((field) => count(field.type, depth + 1))
          : [];
    const size =
      type.kind === "array"
        ? type.length * children[0]!.size
        : type.kind === "record"
          ? children.reduce((sum, child) => sum + child.size, 0)
          : 1;
    const height = children.length
      ? 1 + children.reduce((maximum, child) => Math.max(maximum, child.height), 0)
      : 0;
    active.delete(id);
    if (size > 1_000_000) throw new Error(`Layout exceeds one million scalar elements ${id}`);
    if (depth + height > 64) throw new Error(`Layout nesting exceeds 64 levels ${id}`);
    const layout = { size, height };
    layouts.set(id, layout);
    return layout;
  };
  try {
    for (const id of types.keys()) count(id, 0);
  } catch (cause) {
    return cause instanceof Error ? cause.message : "Invalid layout";
  }
  return undefined;
}
