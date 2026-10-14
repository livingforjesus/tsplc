import type {
  Constant,
  CoreExpression,
  CoreFunction,
  CoreFunctionBlock,
  CorePath,
  CoreStatement,
  EmitResult,
  GeneratedObject,
  SourceSpan,
  Variable,
} from "@vplc/compiler/ir";
import { defaultValue } from "@vplc/compiler/ir";
import { Names } from "./names.ts";
import { NumericLowering } from "./numeric.ts";
import { type CodesysPlan, diagnostic, isCodesysPlan } from "./plan.ts";
import { storageLayout } from "./storage.ts";
import { accessedStorage } from "./task-access.ts";
import { CodesysTypes } from "./types.ts";

export interface SourceMapping {
  path: string;
  line: number;
  span: SourceSpan;
}

// All symbol relationships were checked by normalization and planning. Failure
// here is an emitter invariant violation, rather than a recoverable source error.
function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Missing verified CODESYS symbol.");
  return value;
}

type CodesysBundle = EmitResult & {
  mappings: readonly SourceMapping[];
  ioSymbols: Readonly<Record<string, string>>;
};

export function emitCodesys(plan: CodesysPlan): CodesysBundle {
  if (!isCodesysPlan(plan)) {
    return {
      artifacts: [],
      objects: [],
      mappings: [],
      ioSymbols: {},
      diagnostics: [diagnostic("Emission requires a validated CODESYS plan.")],
    };
  }
  return new CodesysEmitter(plan).emit();
}

// A bundle owns target names and source mappings. Per-routine declarations and
// implementation lines stay local to emitRoutine, so they cannot leak between POUs.
class CodesysEmitter {
  private readonly names = new Names();
  private readonly references = new Map<string, string>();
  private readonly physical = new Map<string, string>();
  private readonly objects: GeneratedObject[] = [];
  private readonly mappings: SourceMapping[] = [];
  private readonly blockFields = new Map<string, Map<string, string>>();
  private readonly typeMap;
  private readonly blocks;
  private readonly blockNames;
  private readonly functionNames = new Map<string, string>();
  private readonly targetTypes: CodesysTypes;
  private readonly numeric: NumericLowering;
  private readonly layout;

  constructor(private readonly plan: CodesysPlan) {
    const { core, options } = plan;
    for (const name of [
      ...Object.values(options.programNames ?? {}),
      ...Object.values(options.globalListNames ?? {}),
    ]) {
      this.names.reserve(name);
    }

    this.typeMap = new Map(core.types.map((type) => [type.id, type]));
    this.blocks = new Map(core.blocks.map((block) => [block.id, block]));
    this.blockNames = new Map(
      core.blocks.map((block) => [
        block.id,
        block.standard === "BLINK"
          ? "Util.BLINK"
          : (block.standard ??
            this.names.allocate(block.name.startsWith("FB_") ? block.name : `FB_${block.name}`)),
      ]),
    );
    for (const name of this.blockNames.values()) this.names.reserve(name);
    this.targetTypes = new CodesysTypes(
      this.typeMap,
      (label) => this.names.allocate(label),
      this.blockNames,
    );
    this.numeric = new NumericLowering(this.typeMap, (label) => this.names.allocate(label));
    this.layout = storageLayout(core);
    this.objects.push(...this.targetTypes.objects);
  }

  emit(): CodesysBundle {
    this.emitGlobals();
    this.emitIo();

    // Helpers must be discovered before allocating local names: an ST local must
    // never shadow a helper, function, FB, or DUT that the implementation calls.
    const { core } = this.plan;
    for (const fn of core.functions)
      this.functionNames.set(
        fn.id,
        this.names.allocate(
          /^(?:F|FUN)_/.test(fn.name) ? fn.name : `F_${fn.name.replace(/^PRG_/, "")}`,
        ),
      );
    for (const fn of core.functions) this.prepareStatements(fn.body);
    for (const block of core.blocks) this.prepareStatements(block.body);
    this.objects.push(...this.numeric.objects);
    this.allocateBlockFields();

    for (const fn of [...core.functions, ...core.blocks.filter((block) => !block.standard)])
      this.emitRoutine(fn);
    for (const program of core.programs) this.emitProgram(program);

    const { objects, mappings } = this;
    const paths = new Map<string, string>();
    for (const object of objects) {
      const path = this.objectPath(object);
      paths.set(object.name, path);
      object.sourcePath =
        object.implementation === undefined ? `${path}.st` : `${path}/declaration.st`;
    }
    const artifacts = objects.flatMap((object) => {
      const path = paths.get(object.name)!;
      return object.implementation === undefined
        ? [{ path: `${path}.st`, content: object.declaration }]
        : [
            { path: `${path}/declaration.st`, content: object.declaration },
            { path: `${path}/implementation.st`, content: object.implementation },
          ];
    });
    for (const mapping of mappings) {
      const [name, ...rest] = mapping.path.split("/");
      const key = name!.replace(/\.st$/, "");
      const path = paths.get(key);
      if (path) mapping.path = rest.length ? `${path}/${rest.join("/")}` : `${path}.st`;
    }
    const ioSymbols = Object.fromEntries(
      core.variables
        .filter((variable) => variable.storage === "input" || variable.storage === "output")
        .map((variable) => [variable.name, required(this.references.get(variable.id))]),
    );
    return { artifacts, objects, mappings, ioSymbols, diagnostics: [] };
  }

  private objectPath(object: GeneratedObject): string {
    const { core } = this.plan;
    let source = object.id.split(":")[0] ?? "";
    const program = core.programs.find((item) => item.id === object.id);
    if (program) source = program.entry.split(":")[0] ?? "";
    const group = this.layout.globalLists.find((item) => item.id === object.id);
    if (group) {
      // Variable IDs are relative to tsconfig, unlike their diagnostic spans.
      source = group.variables[0]?.id.split(":")[0] ?? "";
    }
    if (
      /^[\w./ -]+\.tsx?$/.test(source) &&
      !source.split(/[\\/]/).includes("..") &&
      !source.startsWith("/")
    ) {
      const segments = source.replaceAll("\\", "/").split("/").slice(0, -1);
      if (segments[0] === "src") segments.shift();
      // A DUT directory can also contain sibling input/output layouts. Keep
      // that directory for every DUT, or its primary type would block the folder.
      if (object.kind !== "dataType" && segments.at(-1) === object.name) segments.pop();
      return [...segments, object.name].join("/");
    }
    return `${object.kind === "dataType" ? "Types" : object.id === "io" ? "IO" : "_Generated"}/${object.name}`;
  }

  private initialValue(item: Variable): string {
    return this.targetTypes.literal(
      item.initial ?? defaultValue(item.type, this.typeMap),
      item.type,
    );
  }

  private emitGlobals(): void {
    const { options } = this.plan;
    const { layout, names, references, mappings, targetTypes, typeMap, objects } = this;
    for (const group of layout.globalLists) {
      const override =
        options.globalListNames && Object.hasOwn(options.globalListNames, group.module)
          ? options.globalListNames[group.module]
          : undefined;
      const name = override ?? names.allocate(`GVL_${group.module}_${group.storage}`);
      const publish = options.publishGlobalLists?.includes(group.module) ?? false;
      const fields = new Names();
      for (const name of this.blockNames.values()) fields.reserve(name);
      const lines = [
        ...(publish ? ["{attribute 'linkalways'}"] : []),
        "{attribute 'qualified_only'}",
        group.storage === "constants"
          ? "VAR_GLOBAL CONSTANT"
          : group.storage === "retained"
            ? "VAR_GLOBAL RETAIN"
            : "VAR_GLOBAL",
      ];
      for (const item of group.variables) {
        const field = override ? item.name : fields.allocate(item.name);
        references.set(item.id, `${name}.${field}`);
        if (publish) lines.push("    {attribute 'symbol' := 'readwrite'}");
        mappings.push({ path: `${name}.st`, line: lines.length + 1, span: item.span });
        let initial = "";
        if (typeMap.get(item.type)?.kind !== "block") {
          const value = item.initial ?? defaultValue(item.type, typeMap);
          // CONSTANT declarations always keep their initializer. Mutable zero
          // aggregates use the same implicit initialization as the original ST.
          initial =
            group.storage === "constants"
              ? ` := ${targetTypes.literal(value, item.type)}`
              : targetTypes.declarationInitializer(value, item.type);
        }
        lines.push(`    ${field} : ${targetTypes.name(item.type)}${initial};`);
      }
      lines.push("END_VAR");
      objects.push({
        id: group.id,
        kind: "globalList",
        name,
        declaration: `${lines.join("\n")}\n`,
      });
    }
  }

  private emitIo(): void {
    const { core, options } = this.plan;
    const { names, references, physical, mappings, targetTypes, objects } = this;
    const ioName = names.allocate("GVL_IO");
    const ioFields = new Names();
    for (const name of this.blockNames.values()) ioFields.reserve(name);
    const ioLines = ["{attribute 'linkalways'}", "{attribute 'qualified_only'}", "VAR_GLOBAL"];
    for (const item of core.variables.filter(
      (item) => item.storage === "input" || item.storage === "output",
    )) {
      const field = ioFields.allocate(item.name);
      const wire = ioFields.allocate(`${item.name}_physical`);
      references.set(item.id, `${ioName}.${field}`);
      physical.set(item.id, `${ioName}.${wire}`);
      mappings.push(
        { path: `${ioName}.st`, line: ioLines.length + 1, span: item.span },
        { path: `${ioName}.st`, line: ioLines.length + 3, span: item.span },
      );
      ioLines.push(
        `    ${wire} AT ${required(options.io[item.name]).address} : ${targetTypes.name(item.type)};`,
        // Publish the scan's logical value for monitoring. Physical wires stay
        // private; external writes cannot alter the controller's IO snapshot.
        "    {attribute 'symbol' := 'read'}",
        `    ${field} : ${targetTypes.name(item.type)} := ${this.initialValue(item)};`,
      );
    }
    ioLines.push("END_VAR");
    if (physical.size)
      objects.push({
        id: "io",
        kind: "globalList",
        name: ioName,
        declaration: `${ioLines.join("\n")}\n`,
      });
  }

  private prepareStatements(items: readonly CoreStatement[]): void {
    const { numeric } = this;
    for (const item of items) {
      if (item.kind === "assign") {
        numeric.prepare(item.value);
        item.path?.forEach((segment) => {
          if (segment.kind === "index") numeric.prepare(segment.value);
        });
      }
      if (item.kind === "if") {
        numeric.prepare(item.condition);
        this.prepareStatements(item.then);
        this.prepareStatements(item.else);
      }
      if (item.kind === "switch") {
        numeric.prepare(item.value);
        for (const branch of item.cases) this.prepareStatements(branch.body);
        this.prepareStatements(item.fallback);
      }
      if (item.kind === "for") this.prepareStatements(item.body);
      if (item.kind === "return" && item.value) numeric.prepare(item.value);
      if (item.kind === "invoke") for (const value of item.arguments) numeric.prepare(value);
      if (item.kind === "blockUpdate")
        for (const value of Object.values(item.inputs)) numeric.prepare(value);
    }
  }

  private allocateBlockFields(): void {
    const { core } = this.plan;
    const { objects, functionNames, blockNames, blockFields } = this;
    for (const block of core.blocks) {
      const fields = new Names(),
        mapped = new Map<string, string>();
      for (const object of objects) fields.reserve(object.name);
      for (const objectName of [...functionNames.values(), ...blockNames.values()])
        fields.reserve(objectName);
      for (const item of [...block.inputs, ...block.outputs, ...block.state])
        mapped.set(item.id, block.standard ? item.name : fields.allocate(item.name, true));
      blockFields.set(block.id, mapped);
    }
  }

  private emitRoutine(fn: CoreFunction | CoreFunctionBlock): void {
    const { core } = this.plan;
    const {
      blockNames,
      functionNames,
      references,
      objects,
      mappings,
      targetTypes,
      typeMap,
      blocks,
      blockFields,
      numeric,
      layout,
    } = this;
    const block = "inputs" in fn ? fn : undefined;
    const name = block ? required(blockNames.get(block.id)) : required(functionNames.get(fn.id));
    const inputs = "parameters" in fn ? fn.parameters : fn.inputs;
    const state = block ? [...block.outputs, ...block.state] : [];
    const scope = new Map(references),
      locals = new Names();
    for (const object of objects) locals.reserve(object.name);
    for (const functionName of [...functionNames.values(), ...blockNames.values()])
      locals.reserve(functionName);
    const declarations: string[] = [];
    const declarationSpans: SourceSpan[] = [];
    for (const item of [...inputs, ...state]) {
      const local = block
        ? required(required(blockFields.get(block.id)).get(item.id))
        : locals.allocate(item.name);
      locals.reserve(local);
      scope.set(item.id, local);
    }
    for (const item of fn.locals) {
      const local = locals.allocate(item.name);
      scope.set(item.id, local);
      declarations.push(`    ${local} : ${targetTypes.name(item.type)};`);
      declarationSpans.push(item.span);
    }
    // Count target lines as they are appended; diagnostics use these exact offsets.
    const lines: string[] = [];
    const write = (line: string, depth: number, source?: SourceSpan): void => {
      lines.push("    ".repeat(depth) + line);
      if (source)
        mappings.push({ path: `${name}/implementation.st`, line: lines.length, span: source });
    };

    const load = (id: string): string => {
      const value = scope.get(id);
      if (!value) throw new Error(`Missing verified storage ${id}.`);
      return value;
    };
    const scopeTypes = new Map(
      [...core.variables, ...inputs, ...state, ...fn.locals].map((variable) => [
        variable.id,
        variable.type,
      ]),
    );

    // Block output records are a source abstraction; target FB fields are direct.
    const place = (id: string, path: CorePath = []): string => {
      let text = load(id),
        typeId = required(scopeTypes.get(id));
      let outputBlock: string | undefined;
      for (const segment of path) {
        const type = required(typeMap.get(typeId));
        if (segment.kind === "field" && type.kind === "block" && segment.name === "out") {
          outputBlock = type.block;
          typeId = required(type.output);
          continue;
        }
        if (segment.kind === "field" && outputBlock) {
          const output = required(
            required(blocks.get(outputBlock)).outputs.find((field) => field.name === segment.name),
          );
          text += `.${required(required(blockFields.get(outputBlock)).get(output.id))}`;
          typeId = output.type;
          outputBlock = undefined;
        } else if (segment.kind === "field" && type.kind === "record") {
          text += `.${targetTypes.field(typeId, segment.name)}`;
          typeId = required(type.fields.find((field) => field.name === segment.name)).type;
        } else if (segment.kind === "index" && type.kind === "array") {
          text += `[${expression(segment.value)}]`;
          typeId = type.element;
        } else throw new Error("Invalid verified place");
      }
      return text;
    };

    const expression = (value: CoreExpression): string => {
      if (value.kind === "constant") return targetTypes.literal(value.value, value.type);
      if (value.kind === "load") return place(value.root, value.path);
      if (value.kind === "borrow") return place(value.place.root, value.place.path);
      if (value.kind === "convert" && typeMap.get(value.type)?.kind === "string")
        return expression(value.operand);
      if (value.kind === "unary" || value.kind === "convert")
        return numeric.render(value, [expression(value.operand)]);
      return numeric.render(value, [expression(value.left), expression(value.right)]);
    };

    // Aggregate constants are expanded into legal leaf assignments for ST.
    const assignConstant = (
      destination: string,
      value: Constant,
      id: string,
      depth: number,
      span: SourceSpan,
    ): void => {
      const type = required(typeMap.get(id));
      if (type.kind === "record" && value.kind === "record")
        type.fields.forEach((field) => {
          assignConstant(
            `${destination}.${targetTypes.field(id, field.name)}`,
            required(value.fields[field.name]),
            field.type,
            depth,
            span,
          );
        });
      else if (type.kind === "array" && value.kind === "array")
        value.items.forEach((item, index) => {
          assignConstant(
            `${destination}[${type.lowerBound + index}]`,
            item,
            type.element,
            depth,
            span,
          );
        });
      else write(`${destination} := ${targetTypes.literal(value, id)};`, depth, span);
    };

    const body = (items: readonly CoreStatement[], depth: number): void => {
      for (const item of items) {
        switch (item.kind) {
          case "assign":
            if (item.value.kind === "constant")
              assignConstant(
                place(item.root, item.path),
                item.value.value,
                item.value.type,
                depth,
                item.span,
              );
            else
              write(
                `${place(item.root, item.path)} := ${expression(item.value)};`,
                depth,
                item.span,
              );
            break;
          case "blockUpdate": {
            const instance = required(typeMap.get(required(scopeTypes.get(item.instance))));
            if (instance.kind !== "block") throw new Error("Invalid verified block receiver");
            const target = required(blocks.get(instance.block));
            const arguments_ = Object.entries(item.inputs).map(([input, value]) => {
              const formal = required(target.inputs.find((field) => field.name === input));
              return `${required(required(blockFields.get(target.id)).get(formal.id))} := ${expression(value)}`;
            });
            write(`${load(item.instance)}(${arguments_.join(", ")});`, depth, item.span);
            break;
          }
          case "invoke": {
            const call = `${functionNames.get(item.function)}(${item.arguments.map(expression).join(", ")})`;
            write(
              item.destination ? `${load(item.destination)} := ${call};` : `${call};`,
              depth,
              item.span,
            );
            break;
          }
          case "if":
            write(`IF ${expression(item.condition)} THEN`, depth, item.span);
            body(item.then, depth + 1);
            if (item.else.length) {
              write("ELSE", depth, item.span);
              body(item.else, depth + 1);
            }
            write("END_IF;", depth, item.span);
            break;
          case "switch": {
            for (const [index, branch] of item.cases.entries()) {
              const conditions = branch.values.map(
                (value) =>
                  `(${expression(item.value)} = ${targetTypes.literal(value, item.value.type)})`,
              );
              write(`${index ? "ELSIF" : "IF"} ${conditions.join(" OR ")} THEN`, depth, item.span);
              body(branch.body, depth + 1);
            }
            if (item.cases.length) {
              if (item.fallback.length) write("ELSE", depth, item.span);
              body(item.fallback, depth + 1);
              write("END_IF;", depth, item.span);
            } else body(item.fallback, depth);
            break;
          }
          case "for": {
            // Iterate with a DINT ordinal rather than overflowing the authored
            // counter at a width boundary. Reconstruct its typed value each scan.
            const counterType = scopeTypes.get(item.counter);
            if (!counterType || item.start.kind !== "integer")
              throw new Error("Invalid verified loop");
            if (!item.maxIterations) break;
            const ordinal = locals.allocate("iteration");
            declarations.push(`    ${ordinal} : DINT;`);
            declarationSpans.push(item.span);
            write(
              `FOR ${ordinal} := DINT#0 TO DINT#${item.maxIterations - 1} DO`,
              depth,
              item.span,
            );
            const wide = counterType === "ULINT" ? "ULINT" : "LINT";
            const counterValue = `${load(item.counter)} := TO_${counterType}(${wide}#${item.start.value} ${BigInt(item.step) > 0n ? "+" : "-"} (${wide}#${BigInt(item.step) < 0n ? -BigInt(item.step) : BigInt(item.step)} * DINT_TO_${wide}(${ordinal})));`;
            write(counterValue, depth + 1, item.span);
            body(item.body, depth + 1);
            write("END_FOR;", depth, item.span);
            // CODESYS keeps the ordinal at EXIT and advances it on normal
            // completion/CONTINUE. Reconstructing here preserves that distinction.
            if (item.counterScope === "existing") write(counterValue, depth, item.span);
            break;
          }
          case "return":
            if (block) {
              if (item.value) {
                const returned = expression(item.value);
                for (const output of block.outputs)
                  write(
                    `${load(output.id)} := ${returned}.${targetTypes.field(required(block.result), output.name)};`,
                    depth,
                    item.span,
                  );
              }
            } else
              write(
                `${name} := ${item.value ? expression(item.value) : "TRUE"};`,
                depth,
                item.span,
              );
            write("RETURN;", depth, item.span);
            break;
          case "break":
            write("EXIT;", depth, item.span);
            break;
          case "continue":
            write("CONTINUE;", depth, item.span);
            break;
        }
      }
    };

    body(fn.body, 0);
    if (!block && !fn.result) write(`${name} := TRUE;`, 0);

    const declaration = [
      block
        ? `FUNCTION_BLOCK ${name}`
        : `FUNCTION ${name} : ${fn.result ? targetTypes.name(fn.result) : "BOOL"}`,
    ];
    mappings.push({ path: `${name}/declaration.st`, line: 1, span: fn.span });
    const section = (keyword: string, items: readonly Variable[]): void => {
      if (!items.length) return;
      declaration.push(keyword);
      for (const item of items) {
        mappings.push({
          path: `${name}/declaration.st`,
          line: declaration.length + 1,
          span: item.span,
        });
        const initial =
          item.initial && typeMap.get(item.type)?.kind !== "block"
            ? targetTypes.declarationInitializer(item.initial, item.type)
            : "";
        declaration.push(`    ${load(item.id)} : ${targetTypes.name(item.type)}${initial};`);
      }
      declaration.push("END_VAR");
    };

    section(
      "VAR_INPUT",
      inputs.filter((item) => item.mode !== "inOut"),
    );
    section(
      "VAR_IN_OUT",
      inputs.filter((item) => item.mode === "inOut"),
    );
    if (block) {
      section("VAR_OUTPUT", block.outputs);
      section(
        "VAR",
        block.state.filter((item) => !layout.retainedVariables.has(item.id)),
      );
      section(
        "VAR RETAIN",
        block.state.filter((item) => layout.retainedVariables.has(item.id)),
      );
    }
    if (declarations.length) {
      declaration.push(block ? "VAR_TEMP" : "VAR");
      declarationSpans.forEach((span, index) => {
        mappings.push({
          path: `${name}/declaration.st`,
          line: declaration.length + index + 1,
          span,
        });
      });
      declaration.push(...declarations, "END_VAR");
    }

    objects.push({
      id: fn.id,
      kind: block ? "functionBlock" : "function",
      name,
      declaration: `${declaration.join("\n")}\n`,
      implementation: `${lines.join("\n")}\n`,
    });
  }

  private emitProgram(program: CodesysPlan["core"]["programs"][number]): void {
    const { core, options } = this.plan;
    const { names, references, physical, functionNames, objects } = this;
    // Each wrapper snapshots physical inputs before the authored scan and commits
    // outputs afterwards. RETURN in an authored routine cannot skip that epilogue.
    const explicit =
      options.programNames && Object.hasOwn(options.programNames, program.name)
        ? options.programNames[program.name]
        : undefined;
    const name = explicit ?? names.allocate(`PRG_${program.name}`);
    const fn = required(core.functions.find((item) => item.id === program.entry));
    const used = accessedStorage(fn, core);
    const lines: string[] = [];
    for (const item of core.variables.filter(
      (item) => item.storage === "input" && used.has(item.id),
    ))
      lines.push(`${references.get(item.id)} := ${physical.get(item.id)};`);
    lines.push(`plc_discard := ${functionNames.get(program.entry)}();`);
    for (const item of core.variables.filter(
      (item) => item.storage === "output" && used.has(item.id),
    ))
      lines.push(`${physical.get(item.id)} := ${references.get(item.id)};`);
    objects.push({
      id: program.id,
      kind: "program",
      name,
      declaration: `PROGRAM ${name}\nVAR\n    plc_discard : BOOL;\nEND_VAR\n`,
      implementation: `${lines.join("\n")}\n`,
    });
  }
}
