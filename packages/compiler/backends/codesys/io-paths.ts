import type { PlcType, Variable, VerifiedCoreModule } from "@tsplc/compiler/ir";
import { type IoTarget, ioLayout } from "@tsplc/typegen/hardware";
import { moduleName } from "./storage.ts";

type StorageSegment =
  { kind: "field"; record: string; name: string } | { kind: "index"; value: number };

/** An `io` key that names a field of authored module storage, e.g. `PlantIO.Motor.Output.Run`. */
export interface StorageBinding {
  key: string;
  root: Variable;
  segments: readonly StorageSegment[];
  type: PlcType;
}

const pathPattern = /^([A-Za-z_]\w*)\.([A-Za-z_]\w*)((?:\.[A-Za-z_]\w*|\[-?\d+\])*)$/;

export const isStoragePath = (key: string): boolean => key.includes(".") || key.includes("[");

/** Resolve a storage path against verified types; the error explains the first unresolvable segment. */
export function resolveStoragePath(
  core: VerifiedCoreModule,
  key: string,
): StorageBinding | { error: string } {
  const match = pathPattern.exec(key);
  if (!match) return { error: `${key}: expected Module.variable followed by .field or [index].` };
  const [, module, name, rest] = match;
  const roots = core.variables.filter(
    (item) => item.storage === "module" && item.name === name && moduleName(item) === module,
  );
  if (roots.length !== 1)
    return {
      error: roots.length
        ? `${key}: ${module}.${name} is declared by more than one module named ${module}.`
        : `${key}: no mutable module variable ${module}.${name}.`,
    };
  const root = roots[0]!;
  const types = new Map(core.types.map((type) => [type.id, type]));
  let type = types.get(root.type)!;
  const segments: StorageSegment[] = [];
  for (const [, field, index] of rest!.matchAll(/\.([A-Za-z_]\w*)|\[(-?\d+)\]/g)) {
    if (field !== undefined) {
      const member = type.kind === "record" ? type.fields.find((f) => f.name === field) : undefined;
      if (!member) return { error: `${key}: no field ${field}.` };
      segments.push({ kind: "field", record: type.id, name: field });
      type = types.get(member.type)!;
    } else {
      const value = Number(index);
      if (type.kind !== "array") return { error: `${key}: ${index} indexes a non-array value.` };
      if (value < type.lowerBound || value >= type.lowerBound + type.length)
        return {
          error: `${key}: index ${value} is outside ${type.lowerBound}..${type.lowerBound + type.length - 1}.`,
        };
      segments.push({ kind: "index", value });
      type = types.get(type.element)!;
    }
  }
  return { key, root, segments, type };
}

/** IEC spelling of a bindable type, as typegen spells channels; undefined for records, enums, strings. */
export function iecSpelling(
  type: PlcType,
  types: ReadonlyMap<string, PlcType>,
): string | undefined {
  if (
    type.kind === "bool" ||
    type.kind === "integer" ||
    type.kind === "bits" ||
    type.kind === "float"
  )
    return type.id;
  if (type.kind !== "array") return undefined;
  const element = iecSpelling(types.get(type.element)!, types);
  const upper = type.lowerBound + type.length - 1;
  return element && !element.startsWith("ARRAY")
    ? `ARRAY[${type.lowerBound}..${upper}] OF ${element}`
    : undefined;
}

/** Every key an `io` mapping may use: logical IO names and paths into mutable module storage. */
export function ioTargets(core: VerifiedCoreModule): IoTarget[] {
  const types = new Map(core.types.map((type) => [type.id, type]));
  const targets: IoTarget[] = [];
  const add = (key: string, type: PlcType) => {
    const layout = ioLayout(iecSpelling(type, types) ?? "");
    if (layout) targets.push({ key, layout });
  };
  const visit = (key: string, type: PlcType): void => {
    add(key, type);
    if (type.kind === "record")
      for (const field of type.fields) visit(`${key}.${field.name}`, types.get(field.type)!);
    // Typegen writes keys as template literal types, so any index matches here.
    if (type.kind === "array") visit(`${key}[` + "${number}" + "]", types.get(type.element)!);
  };
  for (const variable of core.variables) {
    if (variable.storage === "input" || variable.storage === "output")
      add(variable.name, types.get(variable.type)!);
    else if (variable.storage === "module")
      visit(`${moduleName(variable)}.${variable.name}`, types.get(variable.type)!);
  }
  return targets;
}
