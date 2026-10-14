import {
  integerType,
  applyIntegerPolicy,
  saturateFloat,
  defaultValue,
  type VerifiedCoreModule,
  type CoreExpression,
  type CoreStatement,
  type CorePath,
  type Constant,
  type PlcType,
} from "@vplc/compiler/ir";

// A test-only executor checks the normalized language contract; vendor compilation
// separately checks emitted ST. This is deliberately not a product PLC runtime.
export type Value = boolean | bigint | number | string | Value[] | { [key: string]: Value };
export function machine(core: VerifiedCoreModule) {
  const globals = new Map<string, Value>(),
    types = new Map(core.types.map((type) => [type.id, type]));
  const constant = (value: Constant): Value => {
    if (value.kind === "duration") return BigInt(value.nanoseconds);
    if (value.kind === "calendar") return value.value;
    if (value.kind === "integer") return BigInt(value.value);
    if (value.kind === "bool" || value.kind === "float" || value.kind === "string")
      return value.value;
    if (value.kind === "array") return value.items.map(constant);
    if (value.kind === "record")
      return Object.fromEntries(
        Object.entries(value.fields).map(([name, value]) => [name, constant(value)]),
      );
    throw new Error("Expected scalar");
  };
  const instantiate = (typeId: string): Value => {
    const type = types.get(typeId)!;
    if (type.kind !== "block") return constant(defaultValue(typeId, types));
    const block = core.blocks.find((item) => item.id === type.block)!;
    return {
      out: Object.fromEntries(
        block.outputs.map((output) => [
          output.name,
          constant(output.initial ?? defaultValue(output.type, types)),
        ]),
      ),
      ...Object.fromEntries(
        block.state.map((state) => [
          state.id,
          state.initial ? constant(state.initial) : instantiate(state.type),
        ]),
      ),
    };
  };
  for (const variable of core.variables)
    globals.set(
      variable.id,
      variable.initial ? constant(variable.initial) : instantiate(variable.type),
    );
  let now = 0n;
  type Cell = { read(): Value; write(value: Value): void };
  const name = (label: string, module?: string): string => {
    const variable = core.variables.find(
      (item) => item.name === label && (!module || item.span.file.endsWith(`/${module}.ts`)),
    );
    if (!variable) throw new Error("Missing variable");
    return variable.id;
  };
  const cast = (
    value: Value,
    type: PlcType,
    policy: "exact" | "wrap" | "saturate" = "exact",
  ): Value => {
    if (integerType(type) && typeof value === "bigint" && policy !== "exact")
      return applyIntegerPolicy(value, type, policy);
    if (type.kind === "float")
      return policy === "saturate"
        ? saturateFloat(Number(value), type)
        : type.bits === 32
          ? Math.fround(Number(value))
          : Number(value);
    return value;
  };
  const call = (
    id: string,
    arguments_: readonly Value[],
    instance?: { [key: string]: Value },
    references = new Map<string, Cell>(),
  ): Value => {
    const block = instance ? core.blocks.find((item) => item.id === id) : undefined;
    const fn = block
      ? { ...block, parameters: block.inputs }
      : core.functions.find((item) => item.id === id);
    if (!fn) throw new Error("Missing callable");
    if (block?.standard) {
      const outputs = instance!.out as { [key: string]: Value };
      const signal = Boolean(arguments_[0]),
        previous = Boolean(instance!.$previous);
      if (block.standard === "BLINK") {
        // The native contract does not define catch-up after missed boundaries,
        // duration changes, or restart timing. Only sample each fixed-duration
        // phase boundary; reject other traces instead of inventing a waveform.
        if (!signal) {
          if (instance!.$blinkBoundary !== undefined) instance!.$blinkStopped = true;
          return true;
        }
        if (instance!.$blinkStopped)
          throw new Error("BLINK restart timing requires native Util execution");
        const low = BigInt(arguments_[1] as bigint),
          high = BigInt(arguments_[2] as bigint);
        if (low <= 0n || high <= 0n)
          throw new Error("BLINK zero-time behavior requires native Util execution");
        if (instance!.$blinkBoundary === undefined) {
          instance!.$blinkLow = low;
          instance!.$blinkHigh = high;
          instance!.$blinkBoundary = now + low;
          return true;
        }
        if (instance!.$blinkLow !== low || instance!.$blinkHigh !== high)
          throw new Error("BLINK duration changes require native Util execution");
        const boundary = BigInt(instance!.$blinkBoundary as bigint);
        if (now > boundary)
          throw new Error("BLINK skipped phase boundaries require native Util execution");
        if (now === boundary) {
          outputs.OUT = !outputs.OUT;
          instance!.$blinkBoundary = boundary + (outputs.OUT ? high : low);
        }
        return true;
      }
      if (block.standard === "R_TRIG" || block.standard === "F_TRIG")
        outputs.Q = block.standard === "R_TRIG" ? signal && !previous : !signal && previous;
      else {
        const preset = BigInt(arguments_[1] as bigint);
        if (block.standard === "TON") {
          if (!signal) {
            instance!.$started = now;
            outputs.ET = 0n;
            outputs.Q = false;
          } else {
            if (!previous) instance!.$started = now;
            const elapsed = now - BigInt(instance!.$started as bigint);
            outputs.ET = elapsed < preset ? elapsed : preset;
            outputs.Q = elapsed >= preset;
          }
        } else if (block.standard === "TOF") {
          if (signal) {
            outputs.Q = true;
            outputs.ET = 0n;
          } else if (previous || outputs.Q) {
            if (previous) instance!.$started = now;
            const elapsed = now - BigInt(instance!.$started as bigint);
            outputs.ET = elapsed < preset ? elapsed : preset;
            outputs.Q = elapsed < preset;
          }
        } else {
          if (signal && !previous && !outputs.Q) instance!.$started = now;
          const started = instance!.$started;
          if (started !== undefined) {
            const elapsed = now - BigInt(started as bigint);
            outputs.ET = elapsed < preset ? elapsed : preset;
            outputs.Q = elapsed < preset;
            if (!signal && elapsed >= preset) {
              delete instance!.$started;
              outputs.ET = 0n;
            }
          }
        }
      }
      instance!.$previous = signal;
      return true;
    }
    const locals = new Map<string, Value>();
    // Locals have declared storage on entry; normalized assignments establish
    // authored initialization before any read reaches this executor.
    for (const variable of fn.locals) {
      locals.set(variable.id, constant(defaultValue(variable.type, types)));
    }
    fn.parameters.forEach((parameter, index) => {
      locals.set(parameter.id, arguments_[index]!);
    });
    if (block) {
      for (const state of block.state)
        references.set(state.id, {
          read: () => instance![state.id]!,
          write: (value) => {
            instance![state.id] = structuredClone(value);
          },
        });
      for (const output of block.outputs)
        references.set(output.id, {
          read: () => (instance!.out as { [key: string]: Value })[output.name]!,
          write: (value) => {
            (instance!.out as { [key: string]: Value })[output.name] = structuredClone(value);
          },
        });
    }
    const read = (id: string): Value => {
      if (references.has(id)) return references.get(id)!.read();
      const value = locals.has(id) ? locals.get(id) : globals.get(id);
      if (value === undefined) throw new Error("Uninitialized test read");
      return value;
    };
    const write = (id: string, value: Value): void => {
      if (references.has(id)) references.get(id)!.write(value);
      else (globals.has(id) ? globals : locals).set(id, structuredClone(value));
    };
    const variableTypes = new Map(
      [
        ...core.variables,
        ...fn.parameters,
        ...fn.locals,
        ...(block ? [...block.state, ...block.outputs] : []),
      ].map((variable) => [variable.id, variable.type]),
    );
    const selected = (
      id: string,
      path: CorePath = [],
    ): { container: Value[] | { [key: string]: Value }; key: string | number } | undefined => {
      if (!path.length) return undefined;
      let value = read(id),
        type = types.get(variableTypes.get(id)!)!;
      let result:
        { container: Value[] | { [key: string]: Value }; key: string | number } | undefined;
      for (const segment of path) {
        if (typeof value !== "object") throw new Error("Expected aggregate");
        let key: string | number, nextType: string;
        if (segment.kind === "field" && type.kind === "block" && segment.name === "out") {
          key = "out";
          nextType = type.output!;
        } else if (segment.kind === "field" && type.kind === "record") {
          key = segment.name;
          nextType = type.fields.find((field) => field.name === key)!.type;
        } else if (segment.kind === "index" && type.kind === "array") {
          key = Number(expression(segment.value)) - type.lowerBound;
          nextType = type.element;
        } else throw new Error("Invalid path");
        result = { container: value, key };
        value = (value as { [key: string]: Value })[key]!;
        type = types.get(nextType)!;
      }
      return result;
    };
    const readPlace = (id: string, path: CorePath = []): Value => {
      const slot = selected(id, path);
      return slot ? (slot.container as { [key: string]: Value })[slot.key]! : read(id);
    };
    const writePlace = (id: string, path: CorePath | undefined, value: Value): void => {
      const slot = selected(id, path);
      if (slot) (slot.container as { [key: string]: Value })[slot.key] = structuredClone(value);
      else write(id, value);
    };
    const expression = (value: CoreExpression): Value => {
      if (value.kind === "constant") return constant(value.value);
      if (value.kind === "load") return readPlace(value.root, value.path);
      if (value.kind === "convert")
        return cast(expression(value.operand), types.get(value.type)!, value.policy);
      if (value.kind === "unary") {
        const operand = expression(value.operand);
        if (value.operator === "timeToMilliseconds") return BigInt(operand as bigint) / 1_000_000n;
        if (value.operator === "not") return !operand;
        if (value.operator === "negate")
          return typeof operand === "bigint" ? -operand : -Number(operand);
        return cast(~BigInt(operand as bigint), types.get(value.type)!, "wrap");
      }
      if (value.kind === "borrow") throw new Error("Borrow evaluated outside a block call");
      const a = expression(value.left),
        b = expression(value.right);
      if (value.operator === "equal") return a === b;
      if (value.operator === "notEqual") return a !== b;
      if (value.operator === "less")
        return (a as bigint | number | string) < (b as bigint | number | string);
      if (value.operator === "lessEqual")
        return (a as bigint | number | string) <= (b as bigint | number | string);
      if (value.operator === "greater")
        return (a as bigint | number | string) > (b as bigint | number | string);
      if (value.operator === "greaterEqual")
        return (a as bigint | number | string) >= (b as bigint | number | string);
      if (typeof a === "number" && typeof b === "number") {
        let result: number;
        switch (value.operator) {
          case "add":
            result = a + b;
            break;
          case "subtract":
            result = a - b;
            break;
          case "multiply":
            result = a * b;
            break;
          case "divide":
            result = a / b;
            break;
          default:
            throw new Error("Unsupported floating test operation");
        }
        // REAL rounds after each typed operation, including intermediate results.
        return cast(result, types.get(value.type)!);
      }
      if (typeof a !== "bigint" || typeof b !== "bigint")
        throw new Error("Expected integer test operation");
      let result: bigint;
      switch (value.operator) {
        case "add":
          result = a + b;
          break;
        case "subtract":
          result = a - b;
          break;
        case "multiply":
          result = a * b;
          break;
        case "divide":
          result = a / b;
          break;
        case "remainder":
          result = a % b;
          break;
        case "bitAnd":
          result = a & b;
          break;
        case "bitOr":
          result = a | b;
          break;
        case "bitXor":
          result = a ^ b;
          break;
        case "shiftLeft":
          result = a << b;
          break;
        case "shiftRight":
          result = a >> b;
          break;
        default:
          throw new Error("Unsupported test operation");
      }
      return cast(
        result,
        types.get(value.type)!,
        value.policy ?? (types.get(value.type)?.kind === "bits" ? "wrap" : "exact"),
      );
    };
    type Control = { kind: "return"; value: Value } | { kind: "break" | "continue" };
    const body = (items: readonly CoreStatement[]): Control | undefined => {
      for (const item of items) {
        let control: Control | undefined;
        if (item.kind === "assign") writePlace(item.root, item.path, expression(item.value));
        if (item.kind === "blockUpdate") {
          const type = types.get(variableTypes.get(item.instance)!)!;
          if (type.kind !== "block") throw new Error("Expected block instance");
          const definition = core.blocks.find((block) => block.id === type.block)!,
            values = new Map<string, Value>(),
            borrowed = new Map<string, Cell>();
          for (const [name, input] of Object.entries(item.inputs)) {
            const parameter = definition.inputs.find((input) => input.name === name)!;
            if (input.kind === "borrow") {
              const slot = selected(input.place.root, input.place.path);
              borrowed.set(
                parameter.id,
                slot
                  ? {
                      read: () => (slot.container as { [key: string]: Value })[slot.key]!,
                      write: (value) => {
                        (slot.container as { [key: string]: Value })[slot.key] =
                          structuredClone(value);
                      },
                    }
                  : {
                      read: () => read(input.place.root),
                      write: (value) => write(input.place.root, value),
                    },
              );
              values.set(name, false);
            } else values.set(name, structuredClone(expression(input)));
          }
          call(
            type.block,
            definition.inputs.map((input) => values.get(input.name)!),
            read(item.instance) as { [key: string]: Value },
            borrowed,
          );
        }
        if (item.kind === "invoke") {
          const result = call(item.function, item.arguments.map(expression));
          if (item.destination) write(item.destination, result);
        }
        if (item.kind === "if") control = body(expression(item.condition) ? item.then : item.else);
        if (item.kind === "switch") {
          const value = expression(item.value);
          control = body(
            item.cases.find((branch) => branch.values.some((label) => constant(label) === value))
              ?.body ?? item.fallback,
          );
        }
        if (item.kind === "for") {
          let ordinal = 0;
          for (; ordinal < item.maxIterations; ordinal++) {
            write(
              item.counter,
              BigInt(constant(item.start) as bigint) + BigInt(item.step) * BigInt(ordinal),
            );
            const nested = body(item.body);
            if (nested?.kind === "return") return nested;
            if (nested?.kind === "break") break;
          }
          if (item.counterScope === "existing")
            write(
              item.counter,
              BigInt(constant(item.start) as bigint) + BigInt(item.step) * BigInt(ordinal),
            );
        }
        if (item.kind === "return")
          return { kind: "return", value: item.value ? expression(item.value) : true };
        if (item.kind === "break" || item.kind === "continue") return { kind: item.kind };
        if (control) return control;
      }
      return undefined;
    };
    // Block return values update the instance outputs even on an early return.
    // Physical output commits belong to the vendor program wrapper epilogue;
    // this executor observes logical storage only.
    const result = body(fn.body);
    if (block && result?.kind === "return" && block.result) {
      for (const output of block.outputs)
        (instance!.out as { [key: string]: Value })[output.name] = structuredClone(
          (result.value as { [key: string]: Value })[output.name]!,
        );
    }
    return result?.kind === "return" ? result.value : true;
  };
  return {
    scan: (elapsedMilliseconds = 20) => {
      now += BigInt(elapsedMilliseconds) * 1_000_000n;
      return call(core.programs[0]!.entry, []);
    },
    get: (label: string, module?: string) => globals.get(name(label, module)),
    set: (label: string, value: Value) => globals.set(name(label), value),
  };
}
