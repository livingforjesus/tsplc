import type {
  CoreExpression,
  CoreFunction,
  CorePath,
  CoreStatement,
  VerifiedCoreModule,
} from "@tsplc/compiler/ir";

// Follow both helper calls and instance updates. Borrow addresses count as storage
// access, so scheduling cannot accidentally give one mutable record two owners.
export function accessedStorage(fn: CoreFunction, core: VerifiedCoreModule): Set<string> {
  const result = new Set<string>(),
    seen = new Set<string>();
  const functions = new Map(core.functions.map((item) => [item.id, item]));
  const blocks = new Map(core.blocks.map((item) => [item.id, item]));
  const types = new Map(core.types.map((item) => [item.id, item]));
  const variables = new Map(
    [
      ...core.variables,
      ...core.functions.flatMap((item) => [...item.parameters, ...item.locals]),
      ...core.blocks.flatMap((item) => [
        ...item.inputs,
        ...item.outputs,
        ...item.state,
        ...item.locals,
      ]),
    ].map((item) => [item.id, item]),
  );

  const path = (segments: CorePath = []): void => {
    segments.forEach((segment) => {
      if (segment.kind === "index") expression(segment.value);
    });
  };

  const expression = (value: CoreExpression): void => {
    if (value.kind === "load") {
      result.add(value.root);
      path(value.path);
    }
    if (value.kind === "borrow") {
      result.add(value.place.root);
      path(value.place.path);
    }
    if (value.kind === "unary" || value.kind === "convert") expression(value.operand);
    if (value.kind === "binary") {
      expression(value.left);
      expression(value.right);
    }
  };

  const body = (items: readonly CoreStatement[]): void => {
    for (const item of items) {
      if (item.kind === "assign") {
        result.add(item.root);
        path(item.path);
        expression(item.value);
      }
      if (item.kind === "if") {
        expression(item.condition);
        body(item.then);
        body(item.else);
      }
      if (item.kind === "switch") {
        expression(item.value);
        for (const branch of item.cases) body(branch.body);
        body(item.fallback);
      }
      if (item.kind === "for") {
        result.add(item.counter);
        body(item.body);
      }
      if (item.kind === "return" && item.value) expression(item.value);
      if (item.kind === "invoke") {
        item.arguments.forEach(expression);
        if (item.destination) result.add(item.destination);
        const called = functions.get(item.function);
        if (called && !seen.has(called.id)) {
          seen.add(called.id);
          body(called.body);
        }
      }
      if (item.kind === "blockUpdate") {
        result.add(item.instance);
        Object.values(item.inputs).forEach(expression);
        const variable = variables.get(item.instance);
        if (!variable) throw new Error("Missing verified instance during task planning.");
        const type = types.get(variable.type);
        const block = type?.kind === "block" ? blocks.get(type.block) : undefined;
        if (block && !seen.has(block.id)) {
          seen.add(block.id);
          body(block.body);
        }
      }
    }
  };

  seen.add(fn.id);
  body(fn.body);
  return result;
}
