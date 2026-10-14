import type { SourceSpan } from "./diagnostics.ts";
import type {
  Variable,
  Expression,
  Statement,
  Place,
  PlcFunction,
  FunctionBlock,
} from "./model.ts";
import type {
  CoreExpression,
  CoreStatement,
  CorePath,
  CoreFunction,
  CoreFunctionBlock,
} from "./core-model.ts";
import { fold, scalarIssue, interval, type IntegerInterval } from "./scalars.ts";
import { domainIssue } from "./domains.ts";
import { aggregate, aggregateIssue, placeType, valueFits } from "./aggregates.ts";
import { reject } from "./normalization-error.ts";
import type { ModuleDeclarations } from "./declarations.ts";

type Flow = "fallthrough" | "return" | "loop" | "mixed";
interface BodyResult {
  body: CoreStatement[];
  initialized: Set<string>;
  flow: Flow;
}

// All mutable lowering state belongs to one invocation of one authored routine.
// sourceScope admits authored places; scope additionally contains captured temps.
export class RoutineNormalizer {
  private readonly fn: PlcFunction;

  private readonly block: FunctionBlock | undefined;

  private readonly scope: Map<string, Variable>;

  private readonly sourceScope: Map<string, Variable>;

  private readonly locals: Variable[];

  private readonly ranges = new Map<string, IntegerInterval>();

  private readonly counters = new Set<string>();

  private readonly callees = new Set<string>();

  private temporaryCount = 0;

  constructor(
    routine: PlcFunction | FunctionBlock,
    private readonly declarations: ModuleDeclarations,
  ) {
    this.block = "inputs" in routine ? routine : undefined;
    const parameters = "parameters" in routine ? routine.parameters : routine.inputs;
    this.fn = {
      id: routine.id,
      name: routine.name,
      parameters,
      locals: routine.locals,
      body: routine.body,
      span: routine.span,
      ...(routine.result && { result: routine.result }),
    };
    this.scope = new Map(declarations.globals);
    for (const item of [
      ...parameters,
      ...(this.block ? [...this.block.state, ...this.block.outputs] : []),
      ...routine.locals,
    ])
      this.scope.set(item.id, item);
    this.sourceScope = new Map(this.scope);
    this.locals = [...routine.locals];
  }

  normalize(): { routine: CoreFunction | CoreFunctionBlock; callees: ReadonlySet<string> } {
    if (this.block?.standard)
      return { routine: { ...this.block, body: [] }, callees: this.callees };
    const normalized = this.body(this.fn.body, new Set(this.fn.parameters.map((item) => item.id)));
    if (this.fn.result && normalized.flow !== "return")
      reject("A typed helper must return on every path.", this.fn.span);
    const routine = this.block
      ? { ...this.block, locals: this.locals, body: normalized.body }
      : { ...this.fn, locals: this.locals, body: normalized.body };
    return { routine, callees: this.callees };
  }

  private temporary(type: string, span: SourceSpan): Variable {
    let id: string;
    do {
      id = `${this.fn.id}:temporary:${this.temporaryCount++}`;
    } while (this.declarations.hasId(id));
    this.declarations.claimId(id);
    const item: Variable = {
      id,
      name: `temporary_${this.temporaryCount}`,
      type,
      storage: "local",
      mutable: true,
      retain: false,
      span,
    };
    this.scope.set(id, item);
    this.locals.push(item);
    return item;
  }

  private load(variable: Variable, span: SourceSpan): CoreExpression {
    return { kind: "load", root: variable.id, type: variable.type, span };
  }

  private verifyCall(id: string, arguments_: readonly Expression[], span: SourceSpan): PlcFunction {
    const called = this.declarations.signatures.get(id);
    if (!called || called.parameters.length !== arguments_.length)
      reject("Unknown helper or wrong argument count.", span);
    this.callees.add(id);
    arguments_.forEach((argument, index) => {
      if (argument.type !== called.parameters[index]?.type)
        reject("Helper argument has the wrong PLC type.", argument.span);
    });
    return called;
  }

  private expression(
    value: Expression,
    initialized: Set<string>,
    output: CoreStatement[],
    allowAggregateLoad = false,
  ): CoreExpression {
    const type = this.declarations.types.get(value.type);
    if (!type || !this.declarations.isValueType(value.type))
      reject("Unknown or non-value expression type.", value.span);
    if (value.kind === "borrow")
      reject("Borrowed places are only valid in block update arguments.", value.span);
    const common = { type: value.type, span: value.span };
    if (value.kind === "length") {
      const array = this.declarations.types.get(value.operand.type);
      if (array?.kind !== "array" || value.type !== "DINT")
        reject("Length requires a fixed array and DINT result.", value.span);
      if (value.operand.kind === "load") {
        const source = this.sourceScope.get(value.operand.place.root),
          checked = placeType(
            value.operand.place,
            this.declarations.types,
            this.sourceScope,
            this.ranges,
          );
        if (
          !source ||
          checked.issue ||
          checked.type !== value.operand.type ||
          (source.storage === "local" && !initialized.has(source.id))
        )
          reject(checked.issue ?? "Invalid array receiver.", value.span);
        this.normalizePath(value.operand.place, initialized, output);
      } else this.expression(value.operand, initialized, output, true);
      return {
        ...common,
        kind: "constant",
        value: { kind: "integer", value: String(array.length) },
      };
    }
    if (value.kind === "conditional") {
      if (
        value.condition.type !== "BOOL" ||
        value.then.type !== value.type ||
        value.else.type !== value.type
      )
        reject("Invalid conditional types.", value.span);
      const condition = this.expression(value.condition, initialized, output),
        result = this.temporary(value.type, value.span);
      const branch = (operand: Expression): CoreStatement[] => {
        const statements: CoreStatement[] = [];
        const evaluated = this.expression(operand, new Set(initialized), statements);
        statements.push({ kind: "assign", root: result.id, value: evaluated, span: value.span });
        return statements;
      };
      output.push({
        kind: "if",
        condition,
        // biome-ignore lint/suspicious/noThenProperty: PLC branch data is an array, not a thenable callback.
        then: branch(value.then),
        else: branch(value.else),
        span: value.span,
      });
      initialized.add(result.id);
      return this.load(result, value.span);
    }
    if (value.kind === "call") {
      const called = this.verifyCall(value.function, value.arguments, value.span);
      if (!called?.result || called.result !== value.type)
        reject("Expression call requires a matching result type.", value.span);
      const arguments_ = value.arguments.map((argument) =>
        this.expression(argument, initialized, output, true),
      );
      const result = this.temporary(value.type, value.span);
      output.push({
        kind: "invoke",
        function: value.function,
        arguments: arguments_,
        destination: result.id,
        span: value.span,
      });
      initialized.add(result.id);
      return this.load(result, value.span);
    }
    const composite =
      ["copy", "record", "array"].includes(value.kind) ||
      ["record", "array", "enum", "string"].includes(type.kind) ||
      (value.kind === "binary" &&
        ["record", "array", "enum", "string"].includes(
          this.declarations.types.get(value.left.type)?.kind ?? "",
        ));
    const domain =
      ["duration", "calendar"].includes(type.kind) ||
      (value.kind === "binary" &&
        ["duration", "calendar"].includes(
          this.declarations.types.get(value.left.type)?.kind ?? "",
        ));
    const issue = domain
      ? domainIssue(value, this.declarations.types)
      : composite
        ? aggregateIssue(value, this.declarations.types)
        : scalarIssue(value, this.declarations.types, this.scope, this.ranges);
    if (issue) reject(issue, value.span);
    switch (value.kind) {
      case "copy":
        return this.expression(value.operand, initialized, output, true);
      case "record":
      case "array": {
        const result = this.temporary(value.type, value.span);
        if (value.kind === "record") {
          for (const [name, operand] of Object.entries(value.fields))
            output.push({
              kind: "assign",
              root: result.id,
              path: [{ kind: "field", name }],
              value: this.expression(operand, initialized, output),
              span: operand.span,
            });
        } else {
          const array = this.declarations.types.get(value.type)!;
          if (array.kind !== "array") reject("Invalid array construction.", value.span);
          value.items.forEach((operand, index) => {
            output.push({
              kind: "assign",
              root: result.id,
              path: [
                {
                  kind: "index",
                  value: {
                    kind: "constant",
                    type: "DINT",
                    value: { kind: "integer", value: String(array.lowerBound + index) },
                    span: operand.span,
                  },
                },
              ],
              value: this.expression(operand, initialized, output),
              span: operand.span,
            });
          });
        }
        initialized.add(result.id);
        return this.load(result, value.span);
      }
      case "constant": {
        if (!aggregate(type)) return { ...common, kind: "constant", value: value.value };
        const result = this.temporary(value.type, value.span);
        output.push({
          kind: "assign",
          root: result.id,
          value: { ...common, kind: "constant", value: value.value },
          span: value.span,
        });
        initialized.add(result.id);
        return this.load(result, value.span);
      }
      case "load": {
        const source = this.sourceScope.get(value.place.root),
          checked = placeType(value.place, this.declarations.types, this.sourceScope, this.ranges);
        if (!source || checked.issue || checked.type !== value.type)
          reject(checked.issue ?? "Invalid PLC load.", value.span);
        if (aggregate(type) && !allowAggregateLoad)
          reject("Aggregate loads require explicit copy or a readonly value argument.", value.span);
        if (source.storage === "local" && !initialized.has(source.id))
          reject("Local read before initialization.", value.span);
        // The virtual .out view is not a vendor record value. Snapshot its
        // declared fields, rather than copying the whole FB instance.
        const first = value.place.path[0];
        if (
          source.storage === "instance" &&
          value.place.path.length === 1 &&
          first?.kind === "field" &&
          first.name === "out" &&
          type.kind === "record"
        ) {
          const result = this.temporary(value.type, value.span);
          for (const field of type.fields) {
            const selected: Expression = {
              kind: "load",
              type: field.type,
              place: {
                root: source.id,
                path: [...value.place.path, { kind: "field", name: field.name }],
              },
              span: value.span,
            };
            const captured = this.expression(selected, initialized, output, true);
            output.push({
              kind: "assign",
              root: result.id,
              path: [{ kind: "field", name: field.name }],
              value: captured,
              span: value.span,
            });
          }
          initialized.add(result.id);
          return this.load(result, value.span);
        }
        const path = this.normalizePath(value.place, initialized, output);
        if (source.storage === "constant" && source.initial && !path.length)
          return { ...common, kind: "constant", value: source.initial };
        // Capture now, before a later operand can invoke an effectful helper.
        const result = this.temporary(value.type, value.span);
        output.push({
          kind: "assign",
          root: result.id,
          value: { ...common, kind: "load", root: source.id, ...(path.length && { path }) },
          span: value.span,
        });
        const bound = interval(value, this.declarations.types, this.scope, this.ranges);
        if (bound) this.ranges.set(result.id, bound);
        initialized.add(result.id);
        return this.load(result, value.span);
      }
      case "unary": {
        const operand = this.expression(value.operand, initialized, output),
          constant = fold(value, this.scope, this.declarations.types);
        return constant
          ? { ...common, kind: "constant", value: constant }
          : { ...common, kind: "unary", operator: value.operator, operand };
      }
      case "convert": {
        const operand = this.expression(value.operand, initialized, output),
          constant = fold(value, this.scope, this.declarations.types);
        if (value.type === value.operand.type) return operand;
        return constant
          ? { ...common, kind: "constant", value: constant }
          : { ...common, kind: "convert", operand, policy: value.policy };
      }
      case "binary": {
        const left = this.expression(value.left, initialized, output);
        if (value.operator === "and" || value.operator === "or") {
          const result = this.temporary("BOOL", value.span),
            branch: CoreStatement[] = [];
          output.push({ kind: "assign", root: result.id, value: left, span: value.span });
          const right = this.expression(value.right, new Set(initialized), branch);
          branch.push({ kind: "assign", root: result.id, value: right, span: value.span });
          const condition: CoreExpression =
            value.operator === "and"
              ? this.load(result, value.span)
              : {
                  kind: "unary",
                  operator: "not",
                  operand: this.load(result, value.span),
                  type: "BOOL",
                  span: value.span,
                };
          output.push({
            kind: "if",
            condition,
            // biome-ignore lint/suspicious/noThenProperty: PLC branch data is an array, not a thenable callback.
            then: branch,
            else: [],
            span: value.span,
          });
          initialized.add(result.id);
          return this.load(result, value.span);
        }
        const right = this.expression(value.right, initialized, output),
          constant = fold(value, this.scope, this.declarations.types);
        if (constant) return { ...common, kind: "constant", value: constant };
        return {
          ...common,
          kind: "binary",
          operator: value.operator,
          left,
          right,
          ...(value.policy && { policy: value.policy }),
        };
      }
    }
  }

  private normalizePath(place: Place, initialized: Set<string>, output: CoreStatement[]): CorePath {
    // An index is evaluated and captured once, before later arguments can change
    // its source storage. The resulting path denotes that selected cell.
    return place.path.map((segment) =>
      segment.kind === "field"
        ? segment
        : { kind: "index", value: this.expression(segment.value, initialized, output) },
    );
  }

  private destination(
    place: Place,
    type: string,
    initialized: Set<string>,
    span: SourceSpan,
  ): Variable {
    const target = this.sourceScope.get(place.root),
      initializing =
        target?.storage === "local" && !initialized.has(place.root) && !place.path.length;
    const checked = placeType(
      place,
      this.declarations.types,
      this.sourceScope,
      this.ranges,
      !initializing,
    );
    if (!target || checked.issue || checked.type !== type || this.counters.has(place.root))
      reject(checked.issue ?? "Invalid assignment destination.", span);
    if (place.path.length && target.storage === "local" && !initialized.has(target.id))
      reject("Initialize the whole aggregate before assigning fields.", span);
    return target;
  }

  private blockUpdate(
    item: Extract<Statement, { kind: "blockUpdate" }>,
    initialized: Set<string>,
    output: CoreStatement[],
  ): void {
    const instance = this.sourceScope.get(item.instance),
      type = instance && this.declarations.types.get(instance.type);
    const called = type?.kind === "block" && this.declarations.blocks.get(type.block);
    if (instance?.storage !== "instance" || !called)
      reject("Updates require a statically allocated block instance.", item.span);
    const keys = Object.keys(item.inputs);
    if (
      keys.length !== called.inputs.length ||
      called.inputs.some((input) => !Object.hasOwn(item.inputs, input.name))
    )
      reject("Block update must supply every named input exactly once.", item.span);
    this.callees.add(called.id);
    const inputs: Record<string, CoreExpression> = Object.create(null),
      borrowed: Place[] = [];
    // Symbol IDs, not authored names, are canonical storage identities. Prefix
    // paths overlap unless a field or disjoint index interval proves otherwise.
    const overlaps = (a: Place, b: Place): boolean => {
      if (a.root !== b.root) {
        const aRoot = this.sourceScope.get(a.root),
          bRoot = this.sourceScope.get(b.root);
        // Distinct InOut inputs are disjoint at their caller boundary. An
        // input and a global may still designate the same caller memory.
        return Boolean(
          (aRoot?.mode === "inOut" || bRoot?.mode === "inOut") &&
          !(aRoot?.mode === "inOut" && bRoot?.mode === "inOut"),
        );
      }
      for (let index = 0; index < Math.min(a.path.length, b.path.length); index++) {
        const left = a.path[index]!,
          right = b.path[index]!;
        if (left.kind === "field" && right.kind === "field" && left.name !== right.name)
          return false;
        if (left.kind === "index" && right.kind === "index") {
          const x = interval(left.value, this.declarations.types, this.scope, this.ranges),
            y = interval(right.value, this.declarations.types, this.scope, this.ranges);
          if (x && y && (x[1] < y[0] || y[1] < x[0])) return false;
        }
      }
      return true;
    };
    // Keep property order: index selection and value snapshots occur in
    // the same order as the source update argument object.
    for (const name of keys) {
      const input = called.inputs.find((input) => input.name === name)!,
        value = item.inputs[name]!;
      if (value.type !== input.type)
        reject("Block input differs from its concrete PLC type.", value.span);
      if (input.mode === "inOut") {
        if (value.kind !== "borrow")
          reject("InOut arguments require an explicit borrowed place.", value.span);
        const root = this.sourceScope.get(value.place.root),
          checked = placeType(
            value.place,
            this.declarations.types,
            this.sourceScope,
            this.ranges,
            true,
          );
        if (
          !root ||
          checked.issue ||
          checked.type !== value.type ||
          !this.declarations.isValueType(value.type) ||
          this.counters.has(root.id) ||
          (root.storage === "local" && !initialized.has(root.id))
        )
          reject(
            checked.issue ?? "Borrow requires initialized mutable value storage of the exact type.",
            value.span,
          );
        if (borrowed.some((place) => overlaps(place, value.place)))
          reject(
            "Mutable block arguments may overlap; use distinct fields or proved distinct indices.",
            value.span,
          );
        borrowed.push(value.place);
        inputs[name] = {
          kind: "borrow",
          type: value.type,
          place: {
            root: value.place.root,
            path: this.normalizePath(value.place, initialized, output),
          },
          span: value.span,
        };
      } else {
        if (value.kind === "borrow")
          reject("Readonly value inputs cannot receive borrowed references.", value.span);
        inputs[name] = this.expression(value, initialized, output, true);
      }
    }
    output.push({ kind: "blockUpdate", instance: instance.id, inputs, span: item.span });
  }

  private body(
    statements: readonly Statement[],
    initialized: Set<string>,
    inLoop = false,
  ): BodyResult {
    const output: CoreStatement[] = [];
    let flow: Flow = "fallthrough";
    for (const item of statements) {
      if (flow !== "fallthrough") break;
      switch (item.kind) {
        case "assign": {
          this.destination(item.destination, item.value.type, initialized, item.span);
          const path = this.normalizePath(item.destination, initialized, output);
          const value = this.expression(item.value, initialized, output);
          if (!path.length) initialized.add(item.destination.root);
          output.push({
            kind: "assign",
            root: item.destination.root,
            ...(path.length && { path }),
            value,
            span: item.span,
          });
          break;
        }
        case "blockUpdate": {
          this.blockUpdate(item, initialized, output);
          break;
        }
        case "invoke": {
          const called = this.verifyCall(item.function, item.arguments, item.span);
          if (item.destination) {
            if (item.destination.path.length || !called?.result)
              reject("Invalid helper destination.", item.span);
            this.destination(item.destination, called.result, initialized, item.span);
          }
          // Each argument snapshots its reads before the next argument can invoke
          // a helper that mutates shared state.
          const arguments_ = item.arguments.map((argument) =>
            this.expression(argument, initialized, output, true),
          );
          output.push({
            kind: "invoke",
            function: item.function,
            arguments: arguments_,
            span: item.span,
            ...(item.destination && { destination: item.destination.root }),
          });
          if (item.destination) initialized.add(item.destination.root);
          break;
        }
        case "if": {
          if (item.condition.type !== "BOOL") reject("Conditions require BOOL.", item.span);
          const condition = this.expression(item.condition, initialized, output);
          const yes = this.body(item.then, new Set(initialized), inLoop),
            no = this.body(item.else, new Set(initialized), inLoop);
          // Only paths that reach the next statement participate in the join. A
          // local is definitely initialized when every such path initialized it.
          const fallthrough = [yes, no].filter((branch) => branch.flow === "fallthrough");
          if (!fallthrough.length) flow = yes.flow === no.flow ? yes.flow : "mixed";
          else
            initialized = new Set(
              [...fallthrough[0]!.initialized].filter((id) =>
                fallthrough.every((branch) => branch.initialized.has(id)),
              ),
            );
          output.push({
            kind: "if",
            condition,
            // biome-ignore lint/suspicious/noThenProperty: PLC branch data is an array, not a thenable callback.
            then: yes.body,
            else: no.body,
            span: item.span,
          });
          break;
        }
        case "switch": {
          const value = this.expression(item.value, initialized, output),
            seen = new Set<string>();
          const branches = item.cases.map((branch) => {
            for (const constant of branch.values) {
              if (
                !valueFits(
                  constant,
                  this.declarations.types.get(item.value.type)!,
                  this.declarations.types,
                )
              )
                reject("Invalid case constant.", item.span);
              const key = JSON.stringify(constant);
              if (seen.has(key)) reject("Duplicate case constant.", item.span);
              seen.add(key);
            }
            return {
              values: branch.values,
              result: this.body(branch.body, new Set(initialized), inLoop),
            };
          });
          const fallback = this.body(item.fallback, new Set(initialized), inLoop);
          // Return-only branches do not constrain initialization at the join.
          const all = [...branches.map((branch) => branch.result), fallback],
            falling = all.filter((branch) => branch.flow === "fallthrough");
          if (!falling.length)
            flow = all.every((branch) => branch.flow === "return") ? "return" : "mixed";
          else
            initialized = new Set(
              [...falling[0]!.initialized].filter((id) =>
                falling.every((branch) => branch.initialized.has(id)),
              ),
            );
          output.push({
            kind: "switch",
            value,
            cases: branches.map((branch) => ({ values: branch.values, body: branch.result.body })),
            fallback: fallback.body,
            span: item.span,
          });
          break;
        }
        case "for": {
          const counter = this.sourceScope.get(item.counter),
            start = fold(item.start, this.scope, this.declarations.types),
            limit = fold(item.limit, this.scope, this.declarations.types);
          if (
            !counter ||
            !(item.counterScope === "existing"
              ? ["local", "module", "field"].includes(counter.storage)
              : counter.storage === "local") ||
            !counter.mutable ||
            this.declarations.types.get(counter.type)?.kind !== "integer" ||
            this.counters.has(counter.id) ||
            item.start.type !== counter.type ||
            item.limit.type !== counter.type ||
            start?.kind !== "integer" ||
            limit?.kind !== "integer" ||
            !/^(-?[1-9][0-9]*)$/.test(item.step)
          )
            reject("Invalid bounded loop.", item.span);
          this.expression(item.start, initialized, []);
          this.expression(item.limit, initialized, []);
          const first = BigInt(start.value),
            last = BigInt(limit.value),
            step = BigInt(item.step);
          const count =
            step > 0n
              ? last >= first
                ? (last - first) / step + 1n
                : 0n
              : last <= first
                ? (first - last) / -step + 1n
                : 0n;
          if (
            count > 1_000_000n ||
            Number(count) !== item.maxIterations ||
            !Number.isSafeInteger(item.maxIterations)
          )
            reject("Loop iteration proof differs from its bounds.", item.span);
          if (item.counterScope === "existing") {
            const type = this.declarations.types.get(counter.type)!;
            if (type.kind !== "integer") reject("Invalid loop counter type.", item.span);
            const terminal = first + count * step;
            const minimum = type.signed ? -(1n << BigInt(type.bits - 1)) : 0n;
            const maximum = (1n << BigInt(type.bits - (type.signed ? 1 : 0))) - 1n;
            if (terminal < minimum || terminal > maximum)
              reject("The existing loop counter overflows on termination.", item.span);
          }
          initialized.add(counter.id);
          this.counters.add(counter.id);
          this.ranges.set(counter.id, first <= last ? [first, last] : [last, first]);
          const nested = this.body(item.body, new Set(initialized), true);
          this.counters.delete(counter.id);
          this.ranges.delete(counter.id);
          if (item.counterScope !== "existing") initialized.delete(counter.id);
          output.push({
            kind: "for",
            counter: counter.id,
            ...(item.counterScope && { counterScope: item.counterScope }),
            start,
            limit,
            step: item.step,
            maxIterations: item.maxIterations,
            body: nested.body,
            span: item.span,
          });
          break;
        }
        case "return": {
          if (item.value?.type !== this.fn.result)
            reject("Return differs from the function signature.", item.span);
          const value = item.value && this.expression(item.value, initialized, output);
          output.push({ kind: "return", span: item.span, ...(value && { value }) });
          flow = "return";
          break;
        }
        case "break":
        case "continue":
          if (!inLoop) reject("Loop control appears outside a bounded loop.", item.span);
          output.push({ kind: item.kind, span: item.span });
          flow = "loop";
          break;
        default:
          reject("Unknown PLC statement.");
      }
    }
    return { body: output, initialized, flow };
  }
}
