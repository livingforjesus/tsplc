import {
  type Constant,
  type CoreExpression,
  type CorePath,
  type CoreStatement,
  type Deployment,
  type Diagnostic,
  isVerifiedCore,
  type PlcType,
  type SourceSpan,
  type VerifiedCoreModule,
} from "@tsplc/compiler/ir";
import { type CodesysOptions, optionsSchema } from "./config.ts";
import { ioLayout } from "@tsplc/typegen/hardware";
import { iecSpelling, isStoragePath, resolveStoragePath, type StorageBinding } from "./io-paths.ts";
import { isIecIdentifier } from "./names.ts";
import { storageLayout } from "./storage.ts";
import { accessedStorage } from "./task-access.ts";

// Only this planner can admit a target configuration for emission. Cloning a
// branded-looking object does not give it membership in this private identity set.
const planned: unique symbol = Symbol("CODESYS plan");
export interface CodesysPlan {
  readonly [planned]: true;
  readonly core: VerifiedCoreModule;
  readonly deployment: Deployment;
  readonly options: CodesysOptions;
  /** `io` keys that name authored storage, resolved against the verified types. */
  readonly storageBindings: readonly StorageBinding[];
}
const plans = new WeakSet<object>();
export function diagnostic(message: string, span?: SourceSpan): Diagnostic {
  return { origin: "backend", code: "PLC7001", severity: "error", message, ...(span && { span }) };
}
export function isCodesysPlan(plan: CodesysPlan): boolean {
  return plans.has(plan);
}

export function planCodesys(
  core: VerifiedCoreModule,
  deployment: Deployment,
  value: unknown,
): { plan?: CodesysPlan; diagnostics: readonly Diagnostic[] } {
  if (!isVerifiedCore(core))
    return { diagnostics: [diagnostic("CODESYS requires a verified, normalized core module.")] };

  const parsed = optionsSchema.safeParse(value);
  if (!parsed.success)
    return {
      diagnostics: parsed.error.issues.map((issue) =>
        diagnostic(`${issue.path.join(".")}: ${issue.message}`),
      ),
    };

  const options = parsed.data;
  const diagnostics: Diagnostic[] = [];
  const report = (message: string, span?: SourceSpan): void => {
    diagnostics.push(diagnostic(message, span));
  };
  const storageBindings = validateIo(core, options, report);
  validateTasks(core, deployment, report);
  validateStorage(core, options, report);
  validateConstants(core, report);

  if (diagnostics.length) return { diagnostics };

  const plan: CodesysPlan = Object.freeze({
    core,
    deployment: structuredClone(deployment),
    options: structuredClone(options),
    storageBindings,
    [planned]: true as const,
  });
  // Parsed options can contain nested engineering settings; detach and freeze the complete plan.
  const freeze = (value: unknown): void => {
    if (typeof value !== "object" || value === null || Object.isFrozen(value)) return;
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  };
  freeze(plan.deployment);
  freeze(plan.options);
  freeze(plan.storageBindings);
  plans.add(plan);
  return { plan, diagnostics: [] };
}

type Report = (message: string, span?: SourceSpan) => void;

/** Validate every `io` binding and return the ones that name authored storage. */
function validateIo(
  core: VerifiedCoreModule,
  options: CodesysOptions,
  report: Report,
): StorageBinding[] {
  // Compare physical bindings as bit intervals, regardless of their spelling or
  // the profile's byte/element address unit. Different widths can still overlap.
  const types = new Map(core.types.map((type) => [type.id, type]));
  const targets: {
    name: string;
    binding: CodesysOptions["io"][string];
    type: PlcType;
    region: "I" | "Q";
    span?: SourceSpan;
  }[] = [];
  const names = new Set<string>();
  for (const item of core.variables.filter(
    (item) => item.storage === "input" || item.storage === "output",
  )) {
    if (names.has(item.name))
      report(`Ambiguous I/O name ${item.name}; logical I/O names must be unique.`, item.span);
    names.add(item.name);
    const binding = Object.hasOwn(options.io, item.name) ? options.io[item.name] : undefined;
    if (!binding) {
      report(`Missing I/O binding for ${item.name}.`, item.span);
      continue;
    }
    targets.push({
      name: item.name,
      binding,
      type: types.get(item.type)!,
      region: item.storage === "input" ? "I" : "Q",
      span: item.span,
    });
  }

  const scheduled = new Set<string>();
  for (const program of core.programs) {
    const fn = core.functions.find((item) => item.id === program.entry)!;
    for (const id of accessedStorage(fn, core)) scheduled.add(id);
  }
  const storageBindings: StorageBinding[] = [];
  for (const [name, binding] of Object.entries(options.io)) {
    if (names.has(name)) continue;
    if (!isStoragePath(name)) {
      report(`Unknown I/O binding ${name}.`);
      continue;
    }
    const resolved = resolveStoragePath(core, name);
    if ("error" in resolved) {
      report(resolved.error);
      continue;
    }
    const overlapping = storageBindings.find((other) => nested(other, resolved));
    if (overlapping) report(`${name} overlaps the binding ${overlapping.key}.`);
    if (!scheduled.has(resolved.root.id))
      report(
        `${name}: no scheduled program uses ${resolved.root.name}, so it would never be copied.`,
      );
    storageBindings.push(resolved);
    targets.push({
      name,
      binding,
      type: resolved.type,
      region: binding.address[1] === "I" ? "I" : "Q",
    });
  }

  const addresses: { region: string; start: bigint; end: bigint; name: string }[] = [];
  for (const { name, binding, type, region, span } of targets) {
    // An array binds at its first element; the remaining elements follow at
    // consecutive addresses of the same width, like an EDS byte/word span.
    const array = type.kind === "array" ? type : undefined;
    const element = array ? types.get(array.element) : type;
    // Typegen spells channels as IEC types; equal layouts bind (an EDS UINT flag word into a WORD).
    const layout = ioLayout(iecSpelling(type, types) ?? "");
    if (binding.type && (!layout || ioLayout(binding.type) !== layout))
      report(`I/O type mismatch for ${name}: ${type.id} cannot bind to ${binding.type}.`, span);
    if (!binding.address.startsWith(`%${region}`))
      report(`Wrong address region for ${name}: expected %${region}X.`, span);
    const match = /^%([IQ])([XBWD])([0-9]+)(?:\.([0-7]))?$/.exec(binding.address);
    if (!match) continue;
    if (region === "I" && element?.kind === "float")
      report(
        "Floating logical inputs require an explicit runtime nonfinite policy, which is not supported yet.",
        span,
      );
    if (array && element?.kind === "bool")
      report(
        `BOOL arrays are not bit-packed in CODESYS I/O; bind each element of ${name} separately.`,
        span,
      );
    const size = match[2] === "X" ? 1 : match[2] === "B" ? 8 : match[2] === "W" ? 16 : 32;
    if (ioBits(element) !== size) report(`Address size does not match ${name}:${type.id}.`, span);
    if (size !== 1 && !options.profile.numericAddressing)
      report("Numeric I/O requires an explicit byte or element address-unit profile.", span);
    const unit = size === 1 || options.profile.numericAddressing === "byte" ? 8n : BigInt(size);
    const offset = BigInt(match[3]!);
    const start = offset * unit + BigInt(match[4] ?? 0),
      end = start + BigInt(size) * BigInt(array?.length ?? 1);
    if (size !== 1 && options.profile.numericAddressing === "byte" && offset % BigInt(size / 8))
      report(`Unaligned numeric I/O address ${binding.address}.`, span);
    const collision = addresses.find(
      (address) => address.region === match[1] && address.start < end && start < address.end,
    );
    if (collision)
      report(`Overlapping I/O address ${binding.address} with ${collision.name}.`, span);
    addresses.push({ region: match[1]!, start, end, name });
    if (offset > 0x7fff_ffffn) report(`I/O offset is too large: ${binding.address}.`, span);
  }
  return storageBindings;
}

/** Two storage bindings conflict when one target contains the other. */
function nested(left: StorageBinding, right: StorageBinding): boolean {
  return (
    left.root.id === right.root.id &&
    left.segments.every((a, index) => {
      const b = right.segments[index];
      if (!b) return true;
      return a.kind === "field"
        ? b.kind === "field" && a.name === b.name
        : b.kind === "index" && a.value === b.value;
    })
  );
}

/** Width of one bound element; BOOL is a single bit, numeric scalars their storage width. */
function ioBits(type: PlcType | undefined): number {
  if (type?.kind === "bool") return 1;
  return type && "bits" in type ? type.bits : 0;
}

function validateTasks(core: VerifiedCoreModule, deployment: Deployment, report: Report): void {
  // One cyclic task owns each mutable storage root, including transitive calls
  // and borrowed globals. Sharing state within an ordered task remains valid.
  const programs = new Map(core.programs.map((program) => [program.name, program]));
  const assignment = new Map<string, string>();
  const taskNames = new Set<string>();
  const stateOwners = new Map<string, string>();
  const globals = new Map(core.variables.map((item) => [item.id, item]));
  const functions = new Map(core.functions.map((item) => [item.id, item]));
  for (const task of deployment.tasks) {
    if (!isIecIdentifier(task.name)) report(`Invalid task name ${task.name}.`);
    if (taskNames.has(task.name.toUpperCase())) report(`Duplicate task name ${task.name}.`);
    taskNames.add(task.name.toUpperCase());
    if (!Number.isInteger(task.priority) || task.priority < 0 || task.priority > 31)
      report(`Task ${task.name} priority must be 0..31.`);
    if (!/^[1-9][0-9]*$/.test(task.intervalNanoseconds))
      report(`Invalid task interval for ${task.name}.`);
    else {
      const ns = BigInt(task.intervalNanoseconds);
      if (ns % 1_000_000n || ns > 4_294_967_295_000_000n)
        report(`Task ${task.name} requires an exact positive TIME interval in milliseconds.`);
    }
    if (!task.programs.length) report(`Task ${task.name} has no programs.`);
    for (const name of task.programs) {
      const program = programs.get(name);
      if (!program) {
        report(`Unknown task program ${name}.`);
        continue;
      }
      if (assignment.has(name)) report(`Program ${name} must belong to exactly one task.`);
      assignment.set(name, task.name);
      const fn = functions.get(program.entry);
      if (!fn) throw new Error("Verified core has a missing entry.");
      for (const id of accessedStorage(fn, core)) {
        const item = globals.get(id);
        if (!item || item.storage === "constant") continue;
        const owner = stateOwners.get(id);
        if (owner && owner !== task.name)
          report(
            `Storage ${item.name} is shared across cyclic tasks ${owner} and ${task.name}.`,
            item.span,
          );
        stateOwners.set(id, task.name);
      }
    }
  }
  for (const name of programs.keys())
    if (!assignment.has(name)) report(`Program ${name} has no cyclic task.`);
}

function validateStorage(core: VerifiedCoreModule, options: CodesysOptions, report: Report): void {
  const programs = new Map(core.programs.map((program) => [program.name, program]));
  if (core.blocks.some((block) => block.standard === "BLINK")) {
    for (const target of [
      ...Object.values(options.programNames ?? {}),
      ...Object.values(options.globalListNames ?? {}),
    ]) {
      if (target.toUpperCase() === "UTIL")
        report(`IEC object name ${target} shadows the Util library namespace required by BLINK.`);
    }
  }
  const explicitNames = new Set<string>();
  for (const [name, target] of Object.entries(options.programNames ?? {})) {
    if (!programs.has(name)) report(`Unknown program name override ${name}.`);
    if (explicitNames.has(target.toUpperCase())) report(`Duplicate IEC program name ${target}.`);
    explicitNames.add(target.toUpperCase());
  }
  const types = new Map(core.types.map((type) => [type.id, type]));
  const blocks = new Map(core.blocks.map((block) => [block.id, block]));

  // InOut addresses must not survive a retained restart, including nested children.
  const blockHasInOut = (id: string): boolean => {
    const block = blocks.get(id)!;
    return (
      block.inputs.some((input) => input.mode === "inOut") ||
      block.state.some((field) => {
        const type = types.get(field.type);
        return type?.kind === "block" && blockHasInOut(type.block);
      })
    );
  };

  const layout = storageLayout(core);
  for (const [module, target] of Object.entries(options.globalListNames ?? {})) {
    const groups = layout.globalLists.filter((group) => group.module === module);
    if (groups.length !== 1)
      report(
        `Global-list override ${module} requires exactly one source storage group; found ${groups.length}.`,
      );
    if (explicitNames.has(target.toUpperCase())) report(`Duplicate IEC object name ${target}.`);
    explicitNames.add(target.toUpperCase());
    for (const group of groups) {
      const fields = new Set<string>();
      for (const variable of group.variables) {
        if (!isIecIdentifier(variable.name))
          report(
            `Global-list override ${module} cannot preserve invalid IEC variable name ${variable.name}.`,
            variable.span,
          );
        if (fields.has(variable.name.toUpperCase()))
          report(
            `Global-list override ${module} has case-insensitive variable collision ${variable.name}.`,
            variable.span,
          );
        fields.add(variable.name.toUpperCase());
      }
    }
  }

  // Publishing is explicit: internal globals must not acquire external write
  // access just because their IEC namespace was preserved.
  const published = new Set<string>();
  for (const module of options.publishGlobalLists ?? []) {
    if (published.has(module)) report(`Duplicate published global list ${module}.`);
    published.add(module);
    const groups = layout.globalLists.filter((group) => group.module === module);
    if (groups.length !== 1 || groups[0]?.storage === "constants") {
      report(`Published global list ${module} requires exactly one mutable source storage group.`);
    }
  }

  for (const block of core.blocks)
    if (layout.retainedBlocks.has(block.id) && blockHasInOut(block.id))
      report(
        "Retained function blocks cannot contain direct or nested InOut references.",
        block.span,
      );
  for (const variable of core.variables) {
    const type = types.get(variable.type);
    if (variable.retain && type?.kind === "block" && blockHasInOut(type.block))
      report(
        "Retained function blocks cannot contain direct or nested InOut references.",
        variable.span,
      );
  }
}

function validateConstants(core: VerifiedCoreModule, report: Report): void {
  const types = new Map(core.types.map((type) => [type.id, type]));
  const constant = (value: Constant, id: string, span?: SourceSpan): void => {
    const type = types.get(id)!;
    if (type.kind === "string" && value.kind === "string") {
      if (
        type.encoding === "utf8" &&
        [...value.value].some(
          (character) => character.charCodeAt(0) === 0 || character.charCodeAt(0) > 127,
        )
      )
        report(
          "Non-ASCII STRING literals require a verified project-wide UTF8 setting; this profile supports ASCII literals.",
          span,
        );
      if (type.encoding === "utf16" && /[\uD800-\uDFFF]/.test(value.value))
        report("CODESYS WSTRING uses UCS-2 and cannot represent surrogate code units.", span);
    }
    if (type.kind === "array" && value.kind === "array")
      for (const item of value.items) constant(item, type.element, span);
    if (type.kind === "record" && value.kind === "record")
      for (const field of type.fields) constant(value.fields[field.name]!, field.type, span);
  };
  const constantsInPath = (path: CorePath = []): void => {
    for (const segment of path) if (segment.kind === "index") constantsInExpression(segment.value);
  };
  const constantsInExpression = (value: CoreExpression): void => {
    if (value.kind === "constant") constant(value.value, value.type, value.span);
    if (value.kind === "load") constantsInPath(value.path);
    if (value.kind === "borrow") constantsInPath(value.place.path);
    if (value.kind === "unary" || value.kind === "convert") constantsInExpression(value.operand);
    if (value.kind === "binary") {
      constantsInExpression(value.left);
      constantsInExpression(value.right);
    }
  };
  const constantsInBody = (items: readonly CoreStatement[]): void => {
    for (const item of items) {
      if (item.kind === "assign") {
        constantsInExpression(item.value);
        constantsInPath(item.path);
      }
      if (item.kind === "if") {
        constantsInExpression(item.condition);
        constantsInBody(item.then);
        constantsInBody(item.else);
      }
      if (item.kind === "switch") {
        constantsInExpression(item.value);
        item.cases.forEach((branch) => {
          for (const value of branch.values) constant(value, item.value.type, item.span);
          constantsInBody(branch.body);
        });
        constantsInBody(item.fallback);
      }
      if (item.kind === "for") constantsInBody(item.body);
      if (item.kind === "invoke") item.arguments.forEach(constantsInExpression);
      if (item.kind === "blockUpdate") Object.values(item.inputs).forEach(constantsInExpression);
      if (item.kind === "return" && item.value) constantsInExpression(item.value);
    }
  };
  core.variables.forEach((variable) => {
    if (variable.initial) constant(variable.initial, variable.type, variable.span);
  });
  for (const fn of core.functions) constantsInBody(fn.body);
  core.blocks.forEach((block) => {
    [...block.outputs, ...block.state, ...block.locals].forEach((variable) => {
      if (variable.initial) constant(variable.initial, variable.type, variable.span);
    });
    constantsInBody(block.body);
  });
}
