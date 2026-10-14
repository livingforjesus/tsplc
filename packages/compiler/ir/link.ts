import type { PlcModule } from "./model.ts";
import type { CoreFunction, CoreFunctionBlock, CoreStatement } from "./core-model.ts";
import type { ModuleDeclarations } from "./declarations.ts";
import { reject } from "./normalization-error.ts";

// Validate the complete authored call graph before pruning unreachable code.
// Static instances keep their child layouts even when a child has no scan call.
export function linkModule(
  module: PlcModule,
  declarations: ModuleDeclarations,
  functions: CoreFunction[],
  normalizedBlocks: CoreFunctionBlock[],
  edges: ReadonlyMap<string, ReadonlySet<string>>,
) {
  const { signatures, blocks, types } = declarations;
  const names = new Set<string>(),
    entries = new Set<string>();
  for (const program of module.programs) {
    declarations.claimId(program.id);
    const entry = signatures.get(program.entry);
    if (!entry || entry.parameters.length || entry.result)
      reject("Program entry must be a parameterless void helper.");
    if (names.has(program.name)) reject(`Duplicate program ${program.name}.`);
    names.add(program.name);
    entries.add(program.entry);
  }
  if (!module.programs.length) reject("At least one program is required.");

  // Authored execution cycles are invalid even in unreachable routines. Static
  // allocation has its own cycle check because it does not depend on scan calls.
  const visited = new Set<string>(),
    active = new Set<string>();
  const visit = (id: string): void => {
    if (active.has(id)) reject("Recursive scan calls are prohibited.", signatures.get(id)?.span);
    if (visited.has(id)) return;
    active.add(id);
    for (const child of edges.get(id) ?? []) {
      if (entries.has(child))
        reject("Program entries cannot be called as ordinary helpers.", signatures.get(id)?.span);
      visit(child);
    }
    active.delete(id);
    visited.add(id);
  };
  for (const fn of [...functions, ...normalizedBlocks]) visit(fn.id);

  // A bounded loop can only reconstruct its counter if called helpers leave
  // that storage alone. Include transitive calls, not just direct assignments.
  const routines = new Map([...functions, ...normalizedBlocks].map((fn) => [fn.id, fn]));
  const variables = new Map(
    [
      ...module.variables,
      ...functions.flatMap((fn) => [...fn.parameters, ...fn.locals]),
      ...normalizedBlocks.flatMap((block) => [
        ...block.inputs,
        ...block.outputs,
        ...block.state,
        ...block.locals,
      ]),
    ].map((variable) => [variable.id, variable]),
  );
  const calledRoutine = (item: CoreStatement): string | undefined => {
    if (item.kind === "invoke") return item.function;
    if (item.kind !== "blockUpdate") return undefined;
    const variable = variables.get(item.instance);
    const type = variable && types.get(variable.type);
    return type?.kind === "block" ? type.block : undefined;
  };
  const nestedBodies = (item: CoreStatement): readonly (readonly CoreStatement[])[] => {
    if (item.kind === "for") return [item.body];
    if (item.kind === "if") return [item.then, item.else];
    if (item.kind === "switch") return [...item.cases.map((branch) => branch.body), item.fallback];
    return [];
  };
  const writes = new Map<string, Set<string>>();
  const routineWrites = (id: string): Set<string> => {
    const cached = writes.get(id);
    if (cached) return cached;
    const result = new Set<string>();
    const inspect = (body: readonly CoreStatement[]) => {
      for (const item of body) {
        if (item.kind === "assign") result.add(item.root);
        if (item.kind === "for") result.add(item.counter);
        if (item.kind === "invoke" && item.destination) result.add(item.destination);
        if (item.kind === "blockUpdate")
          for (const input of Object.values(item.inputs))
            if (input.kind === "borrow") result.add(input.place.root);
        for (const nested of nestedBodies(item)) inspect(nested);
      }
    };
    inspect(routines.get(id)!.body);
    for (const child of edges.get(id) ?? [])
      for (const root of routineWrites(child)) result.add(root);
    writes.set(id, result);
    return result;
  };
  const checkCalls = (body: readonly CoreStatement[], counters: ReadonlySet<string>) => {
    for (const item of body) {
      const called = calledRoutine(item);
      if (called && [...counters].some((counter) => routineWrites(called).has(counter)))
        reject("A called routine may mutate an active loop counter.", item.span);
      const nestedCounters = item.kind === "for" ? new Set([...counters, item.counter]) : counters;
      for (const nested of nestedBodies(item)) checkCalls(nested, nestedCounters);
    }
  };
  for (const routine of routines.values()) checkCalls(routine.body, new Set());

  // Only after the complete graph is valid may emission discard unused helpers.
  const reachable = new Set<string>();
  const link = (id: string): void => {
    if (reachable.has(id)) return;
    reachable.add(id);
    for (const child of edges.get(id) ?? []) link(child);
    for (const instance of blocks
      .get(id)
      ?.state.filter((variable) => variable.storage === "instance") ?? []) {
      const type = types.get(instance.type)!;
      if (type.kind === "block") link(type.block);
    }
  };
  for (const entry of entries) link(entry);
  for (const variable of module.variables) {
    const type = types.get(variable.type)!;
    if (type.kind === "block") link(type.block);
  }
  const linkedFunctions = functions.filter((fn) => reachable.has(fn.id)),
    linkedBlocks = normalizedBlocks.filter((block) => reachable.has(block.id));

  // Admission has already validated every referenced type; these lookups are
  // closed over the declaration registry, including dependencies kept by DUTs.
  const usedTypes = new Set<string>();
  const useType = (id: string): void => {
    if (usedTypes.has(id)) return;
    usedTypes.add(id);
    const type = types.get(id)!;
    if (type.kind === "record") {
      for (const field of type.fields) useType(field.type);
    }
    if (type.kind === "array") useType(type.element);
    if (type.kind === "enum") useType(type.base);
    if (type.kind === "block" && type.output) useType(type.output);
  };
  // Primitive definitions also support backend-generated numeric helpers.
  types.forEach((type) => {
    if (["bool", "integer", "bits", "float", "duration", "calendar"].includes(type.kind))
      useType(type.id);
  });
  for (const variable of module.variables) useType(variable.type);
  for (const fn of linkedFunctions) {
    if (fn.result) useType(fn.result);
    for (const variable of [...fn.parameters, ...fn.locals]) useType(variable.type);
  }
  for (const block of linkedBlocks) {
    if (block.result) useType(block.result);
    for (const variable of [...block.inputs, ...block.outputs, ...block.state, ...block.locals]) {
      useType(variable.type);
    }
  }
  return {
    types: module.types.filter((type) => usedTypes.has(type.id)),
    variables: module.variables,
    functions: linkedFunctions,
    blocks: linkedBlocks,
    programs: module.programs,
  };
}
