import ts from "typescript";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import {
  error,
  hasErrors,
  parseInteger,
  fold,
  canAssign,
  aggregate,
  expressionIssue,
  defaultValue,
  placeType,
  durationLiteral,
  calendarLiteral,
  loopIterations,
  integerRange,
  comparisonOperators,
  type BinaryOperator,
  type IntegerInterval,
  type Constant,
  type Diagnostic,
  type Expression,
  type PlcFunction,
  type PlcModule,
  type PlcProgram,
  type SourceSpan,
  type Statement,
  type Variable,
  type Place,
} from "@tsplc/compiler/ir";

import { BlockResolver, storageInitializer, type BlockSource } from "./blocks.ts";
import {
  TypeResolver,
  calleeName,
  type Fail,
  type TypeEnvironment,
  type ResolvedType,
} from "./types.ts";

export interface FrontendOptions {
  tsconfig: string;
  programs: Readonly<Record<string, { module: string; export: string }>>;
}

export interface FrontendResult {
  module?: PlcModule;
  diagnostics: readonly Diagnostic[];
}

// TIME constructor scales in nanoseconds, and calendar constructor result types.
const durationScales: Readonly<Record<string, bigint>> = {
  ms: 1_000_000n,
  seconds: 1_000_000_000n,
  minutes: 60_000_000_000n,
};
const calendarTypes: Readonly<Record<string, string>> = {
  date: "DATE",
  timeOfDay: "TIME_OF_DAY",
  dateAndTime: "DATE_AND_TIME",
};
const conversions: Readonly<Record<string, "exact" | "wrap" | "saturate">> = {
  exact: "exact",
  wrap: "wrap",
  saturate: "saturate",
};
const arithmetic: Readonly<
  Record<
    string,
    { operator: "add" | "subtract" | "multiply" | "divide"; policy?: "wrap" | "saturate" }
  >
> = {
  div: { operator: "divide" },
  wrapAdd: { operator: "add", policy: "wrap" },
  wrapSubtract: { operator: "subtract", policy: "wrap" },
  wrapMultiply: { operator: "multiply", policy: "wrap" },
  saturatingAdd: { operator: "add", policy: "saturate" },
  saturatingSubtract: { operator: "subtract", policy: "saturate" },
  saturatingMultiply: { operator: "multiply", policy: "saturate" },
};
const operators = new Map<ts.SyntaxKind, BinaryOperator>([
  [ts.SyntaxKind.AmpersandAmpersandToken, "and"],
  [ts.SyntaxKind.BarBarToken, "or"],
  [ts.SyntaxKind.EqualsEqualsEqualsToken, "equal"],
  [ts.SyntaxKind.ExclamationEqualsEqualsToken, "notEqual"],
  [ts.SyntaxKind.LessThanToken, "less"],
  [ts.SyntaxKind.LessThanEqualsToken, "lessEqual"],
  [ts.SyntaxKind.GreaterThanToken, "greater"],
  [ts.SyntaxKind.GreaterThanEqualsToken, "greaterEqual"],
  [ts.SyntaxKind.PlusToken, "add"],
  [ts.SyntaxKind.MinusToken, "subtract"],
  [ts.SyntaxKind.AsteriskToken, "multiply"],
  [ts.SyntaxKind.SlashToken, "divide"],
  [ts.SyntaxKind.PercentToken, "remainder"],
  [ts.SyntaxKind.AmpersandToken, "bitAnd"],
  [ts.SyntaxKind.BarToken, "bitOr"],
  [ts.SyntaxKind.CaretToken, "bitXor"],
  [ts.SyntaxKind.LessThanLessThanToken, "shiftLeft"],
  [ts.SyntaxKind.GreaterThanGreaterThanToken, "shiftRight"],
]);

class SemanticError extends Error {
  constructor(readonly diagnostic: Diagnostic) {
    super(diagnostic.message);
  }
}

function sourceSpan(source: ts.SourceFile, start: number, end: number): SourceSpan {
  const position = source.getLineAndCharacterOfPosition(start);
  return {
    file: source.fileName,
    start,
    end,
    line: position.line + 1,
    column: position.character + 1,
  };
}

function span(node: ts.Node): SourceSpan {
  const source = node.getSourceFile();
  return sourceSpan(source, node.getStart(source), node.getEnd());
}

function tsDiagnostic(diagnostic: ts.Diagnostic): Diagnostic {
  const result: Diagnostic = {
    origin: "typescript",
    code: `TS${diagnostic.code}`,
    severity: diagnostic.category === ts.DiagnosticCategory.Error ? "error" : "warning",
    message: ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
  };
  if (diagnostic.file && diagnostic.start !== undefined)
    result.span = sourceSpan(
      diagnostic.file,
      diagnostic.start,
      diagnostic.start + (diagnostic.length ?? 1),
    );
  return result;
}

export function analyze(options: FrontendOptions): FrontendResult {
  const filename = resolve(options.tsconfig);
  const config = ts.readConfigFile(filename, ts.sys.readFile);
  if (config.error) return { diagnostics: [tsDiagnostic(config.error)] };
  const parsed = ts.parseJsonConfigFileContent(
    config.config,
    ts.sys,
    dirname(filename),
    undefined,
    filename,
  );
  if (parsed.errors.length) return { diagnostics: parsed.errors.map(tsDiagnostic) };
  // TypeScript stores SourceFile paths with forward slashes on every host.
  // Normalize require.resolve once so canonical SDK identity also works on Windows.
  const sdk = createRequire(import.meta.url)
    .resolve("@tsplc/compiler/globals")
    .replaceAll("\\", "/");
  const programFiles = Object.values(options.programs).map((entry) =>
    resolve(dirname(filename), entry.module),
  );
  const program = ts.createProgram([...new Set([...parsed.fileNames, ...programFiles, sdk])], {
    ...parsed.options,
    strict: true,
    noImplicitAny: true,
    strictNullChecks: true,
    noEmit: true,
    noCheck: false,
    allowJs: false,
    skipLibCheck: false,
    types: [],
    lib: ["lib.es2022.d.ts"],
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
  });
  const diagnostics = ts.getPreEmitDiagnostics(program).map(tsDiagnostic);
  if (program.getSyntacticDiagnostics().length) return { diagnostics };
  const analyzer = new Analyzer(program, dirname(filename), sdk, diagnostics);
  const module = analyzer.run(options.programs);
  return hasErrors(diagnostics) ? { diagnostics } : { module, diagnostics };
}

export function checkHostConfig(file: string): readonly Diagnostic[] {
  const bunTypes = createRequire(import.meta.url).resolve("@types/bun/index.d.ts");
  const program = ts.createProgram([file], {
    strict: true,
    noEmit: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    allowImportingTsExtensions: true,
    skipLibCheck: true,
    types: [bunTypes],
  });
  return ts.getPreEmitDiagnostics(program).map(tsDiagnostic);
}

class Analyzer {
  private readonly checker: ts.TypeChecker;
  private readonly variables = new Map<ts.Symbol, Variable>();
  private readonly functions = new Map<ts.Symbol, PlcFunction>();
  private readonly functionDeclarations = new Map<ts.Symbol, ts.FunctionDeclaration>();
  private readonly instances = new Map<string, PlcFunction>();
  private readonly pending: {
    node: ts.FunctionDeclaration;
    fn: PlcFunction;
    environment: TypeEnvironment;
  }[] = [];
  private readonly resolver: TypeResolver;
  private readonly blocks: BlockResolver;
  private readonly globalVariables: Variable[] = [];
  private readonly sources: readonly ts.SourceFile[];

  // This scope is saved and restored for each block or generic function body.
  private environment: TypeEnvironment = new Map();
  private activeBlock: BlockSource | undefined;
  private readonly ranges = new Map<string, IntegerInterval>();
  private readonly loopCounters = new Set<string>();
  private readonly breakTargets: ("loop" | "switch")[] = [];
  private activeFunction: PlcFunction | undefined;

  constructor(
    private readonly program: ts.Program,
    private readonly root: string,
    private readonly sdk: string,
    private readonly diagnostics: Diagnostic[],
  ) {
    this.checker = program.getTypeChecker();
    this.resolver = new TypeResolver(this.checker, root, sdk, this.fail);
    this.blocks = new BlockResolver(
      this.resolver,
      span,
      this.fail,
      span(program.getSourceFile(sdk)!),
    );
    const roots = new Set(program.getRootFileNames());
    this.sources = program
      .getSourceFiles()
      .filter(
        (source) =>
          source.fileName !== sdk &&
          !source.fileName.startsWith(`${dirname(sdk)}/`) &&
          !program.isSourceFileDefaultLibrary(source) &&
          (!source.isDeclarationFile || roots.has(source.fileName)),
      );
  }

  private readonly fail: Fail = (node, code, message) => {
    throw new SemanticError(error(code, message, span(node)));
  };

  private type(node: ts.TypeNode): ResolvedType {
    return this.resolver.resolve(node, this.environment);
  }

  private storageId(node: ts.Node, name: string): string {
    return `${this.resolver.id(node, name)}${this.activeFunction ? `@${this.activeFunction.id}` : ""}`;
  }

  private guard(action: () => void): void {
    try {
      action();
    } catch (cause) {
      if (!(cause instanceof SemanticError)) throw cause;
      this.diagnostics.push(cause.diagnostic);
    }
  }

  run(entries: FrontendOptions["programs"]): PlcModule {
    // Collect every declaration before resolving initializers and routine bodies.
    // Generic calls can enqueue more helpers, so resolve entry points last.
    this.collectDeclarations();
    this.initializeStorage();
    this.analyzeBlockBodies();
    this.analyzePendingFunctions();
    const programs = this.resolvePrograms(entries);

    return {
      types: [...this.resolver.types.values()],
      variables: this.globalVariables,
      functions: [...this.instances.values()],
      blocks: [...this.blocks.definitions.values()],
      programs,
    };
  }

  private collectDeclarations(): void {
    const classes = this.sources.flatMap((source) =>
      source.statements.filter(ts.isClassDeclaration),
    );
    this.blocks.index(classes);
    for (const node of classes) this.guard(() => this.blocks.collect(node));
    for (const source of this.sources) {
      this.checkSuppression(source);
      for (const statement of source.statements) {
        this.guard(() => this.declaration(statement));
      }
    }
  }

  private initializeStorage(): void {
    for (const source of this.sources) {
      for (const statement of source.statements) {
        if (ts.isVariableStatement(statement) && !source.isDeclarationFile) {
          this.guard(() => {
            for (const declaration of statement.declarationList.declarations) {
              if (!declaration.initializer)
                this.fail(
                  declaration,
                  "PLC3001",
                  "Persistent PLC state requires a constant initializer.",
                );
              const variable = this.variables.get(this.resolver.symbol(declaration.name));
              if (!variable || variable.storage === "instance") continue;
              const initializer = storageInitializer(
                declaration.initializer,
                this.resolver,
                this.fail,
              ).value;
              const expression = this.expression(
                initializer,
                variable.type === "inferred" ? undefined : variable.type,
              );
              variable.type = expression.type;
              if (
                variable.storage === "constant" &&
                aggregate(this.resolver.types.get(variable.type))
              )
                variable.storage = "module";
              if (variable.retain && variable.storage === "constant")
                this.fail(
                  declaration,
                  "PLC3004",
                  "retain requires mutable persistent storage or a static block instance.",
                );
              this.fresh(expression);
              const value = this.constant(expression);
              if (!value)
                this.fail(
                  declaration.initializer,
                  "PLC3001",
                  "Persistent initializers must be compile-time constants.",
                );
              variable.initial = value;
            }
          });
        }
      }
    }
  }

  private analyzeBlockBodies(): void {
    for (const source of this.blocks.sources.values())
      this.guard(() => {
        for (const [variable, node] of source.initializers) {
          const value = this.constant(this.expression(node, variable.type));
          if (!value)
            this.fail(node, "PLC3001", "Block state requires a compile-time constant initializer.");
          variable.initial = value;
        }
        const { block } = source;
        this.activeBlock = source;
        try {
          const routine = this.routineBody(
            {
              id: block.id,
              name: block.name,
              parameters: block.inputs,
              locals: [],
              body: [],
              span: block.span,
              ...(block.result && { result: block.result }),
            },
            source.fieldBindings,
            source.method.body!,
          );
          block.locals = routine.locals;
          block.body = routine.body;
        } finally {
          this.activeBlock = undefined;
        }
      });
  }

  private analyzePendingFunctions(): void {
    // A worklist allows explicit generic instances to share source without sharing locals.
    for (let index = 0; index < this.pending.length; index++) {
      const instance = this.pending[index]!;
      this.guard(() => {
        this.environment = instance.environment;
        try {
          // Declaration admission proved the parameter list and body before worklist analysis.
          const fn = this.routineBody(
            instance.fn,
            instance.node.parameters.map((parameter, index) => [
              this.resolver.symbol(parameter.name),
              instance.fn.parameters[index]!,
            ]),
            instance.node.body!,
          );
          this.instances.set(fn.id, fn);
          if (!instance.node.typeParameters?.length)
            this.functions.set(this.resolver.symbol(instance.node.name!), fn);
        } finally {
          this.environment = new Map();
        }
      });
    }
  }

  // Lowers one routine body with its bindings layered over module storage.
  private routineBody(
    fn: PlcFunction,
    bindings: Iterable<readonly [ts.Symbol, Variable]>,
    body: ts.Block,
  ): PlcFunction {
    const saved = new Map(this.variables),
      locals: Variable[] = [];
    this.activeFunction = fn;
    for (const [symbol, variable] of bindings) this.variables.set(symbol, variable);
    try {
      return { ...fn, locals, body: this.statements(body.statements, locals) };
    } finally {
      this.variables.clear();
      for (const [symbol, variable] of saved) this.variables.set(symbol, variable);
      this.activeFunction = undefined;
    }
  }

  private resolvePrograms(entries: FrontendOptions["programs"]): PlcProgram[] {
    const programs: PlcProgram[] = [];
    for (const [name, entry] of Object.entries(entries)) {
      const source = this.program.getSourceFile(resolve(this.root, entry.module));
      if (!source) {
        this.diagnostics.push(error("PLC4001", `Program source not found: ${entry.module}.`));
        continue;
      }
      this.guard(() => {
        const moduleSymbol = this.checker.getSymbolAtLocation(source);
        const exported =
          moduleSymbol &&
          this.checker
            .getExportsOfModule(moduleSymbol)
            .find((symbol) => symbol.name === entry.export);
        if (!exported)
          this.fail(source, "PLC4001", `Program export ${entry.export} was not found.`);
        const symbol =
          exported.flags & ts.SymbolFlags.Alias
            ? this.checker.getAliasedSymbol(exported)
            : exported;
        const fn = this.functions.get(symbol);
        if (!fn || fn.parameters.length || fn.result)
          this.fail(
            source,
            "PLC4001",
            "Program entry must be an implemented parameterless void function.",
          );
        programs.push({ id: `program:${name}`, name, entry: fn.id });
      });
    }
    return programs;
  }

  private checkSuppression(source: ts.SourceFile): void {
    const scanner = ts.createScanner(
      ts.ScriptTarget.Latest,
      false,
      ts.LanguageVariant.Standard,
      source.text,
    );
    for (
      let token = scanner.scan();
      token !== ts.SyntaxKind.EndOfFileToken;
      token = scanner.scan()
    ) {
      if (
        token !== ts.SyntaxKind.SingleLineCommentTrivia &&
        token !== ts.SyntaxKind.MultiLineCommentTrivia
      )
        continue;
      const comment = scanner.getTokenText();
      const match = /(?:^|\n)\s*(?:\/\/+|\/\*+|\*)\s*(@ts-(?:nocheck|ignore|expect-error))\b/.exec(
        comment,
      );
      if (!match) continue;
      const start = scanner.getTokenPos() + comment.indexOf(match[1] ?? "@ts-");
      this.diagnostics.push(
        error(
          "PLC1009",
          "TypeScript diagnostic suppression is not allowed in PLC source.",
          sourceSpan(source, start, start + (match[1]?.length ?? 4)),
        ),
      );
    }
  }

  private dependency(node: ts.ImportDeclaration | ts.ExportDeclaration): void {
    if (!node.moduleSpecifier) return;
    if (!ts.isStringLiteral(node.moduleSpecifier))
      this.fail(node, "PLC1001", "Only static module imports are supported.");
    const resolved = ts.resolveModuleName(
      node.moduleSpecifier.text,
      node.getSourceFile().fileName,
      this.program.getCompilerOptions(),
      ts.sys,
    ).resolvedModule;
    if (!resolved)
      this.fail(
        node.moduleSpecifier,
        "PLC1008",
        "This dependency could not be resolved to PLC source.",
      );
    const source = this.program.getSourceFile(resolved.resolvedFileName);
    const typeOnly = ts.isImportDeclaration(node) ? node.importClause?.isTypeOnly : node.isTypeOnly;
    if (typeOnly) return;
    const bindings = ts.isImportDeclaration(node)
      ? node.importClause?.namedBindings
      : node.exportClause;
    const defaultName = ts.isImportDeclaration(node) ? node.importClause?.name : undefined;
    const namedOnly =
      bindings &&
      (ts.isNamedImports(bindings) || ts.isNamedExports(bindings)) &&
      bindings.elements.length > 0 &&
      bindings.elements.every(
        (binding) =>
          binding.isTypeOnly || !(this.resolver.symbol(binding.name).flags & ts.SymbolFlags.Value),
      );
    if (namedOnly && !defaultName) return;
    if (source && !source.isDeclarationFile) return;
    if (resolved.resolvedFileName.replaceAll("\\", "/").startsWith(`${dirname(this.sdk)}/`)) return;
    const authoredIo =
      source &&
      this.sources.includes(source) &&
      source.statements.some(ts.isVariableStatement) &&
      source.statements.every(
        (statement) =>
          ts.isTypeAliasDeclaration(statement) ||
          ts.isEmptyStatement(statement) ||
          (ts.isVariableStatement(statement) &&
            statement.declarationList.declarations.every(
              (declaration) => declaration.type && this.type(declaration.type).io,
            )),
      );
    if (authoredIo) return;
    this.fail(
      node.moduleSpecifier,
      "PLC1008",
      "Runtime dependencies need PLC TypeScript implementation source; JavaScript and declaration-only value imports are unsupported.",
    );
  }

  private declaration(statement: ts.Statement): void {
    if (ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) {
      this.dependency(statement);
      return;
    }
    if (
      ts.isClassDeclaration(statement) ||
      ts.isTypeAliasDeclaration(statement) ||
      ts.isInterfaceDeclaration(statement) ||
      ts.isEmptyStatement(statement)
    )
      return;
    if (ts.isEnumDeclaration(statement)) {
      this.resolver.enumeration(statement);
      return;
    }
    if (ts.isVariableStatement(statement)) {
      this.moduleVariables(statement);
      return;
    }
    if (ts.isFunctionDeclaration(statement)) {
      if (!statement.name || !statement.body)
        this.fail(statement, "PLC1001", "PLC functions need a name and an implementation.");
      if (statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword)) {
        this.fail(statement, "PLC1007", "Async execution is not supported in PLC scan code.");
      }
      if (statement.asteriskToken)
        this.fail(statement, "PLC1007", "Generators are not supported in PLC scan code.");
      const symbol = this.resolver.symbol(statement.name);
      this.functionDeclarations.set(symbol, statement);
      if (!statement.typeParameters?.length)
        this.functions.set(symbol, this.instantiate(statement, [], statement));
      return;
    }
    this.fail(
      statement,
      "PLC1001",
      `${ts.SyntaxKind[statement.kind]} is not supported in PLC source.`,
    );
  }

  private moduleVariables(statement: ts.VariableStatement): void {
    if (!(statement.declarationList.flags & (ts.NodeFlags.Let | ts.NodeFlags.Const)))
      this.fail(statement, "PLC1001", "Use let or const instead of var.");
    const immutable = Boolean(statement.declarationList.flags & ts.NodeFlags.Const);
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name))
        this.fail(declaration.name, "PLC1001", "Destructuring declarations are not supported.");
      const initializer =
        declaration.initializer &&
        storageInitializer(declaration.initializer, this.resolver, this.fail);
      const instance =
        initializer && ts.isNewExpression(initializer.value)
          ? this.blocks.instanceType(initializer.value)
          : undefined;
      const type = instance
        ? { type: instance }
        : declaration.type
          ? this.type(declaration.type)
          : { type: immutable ? "inferred" : "BOOL" };
      if (
        !instance &&
        !declaration.type &&
        !immutable &&
        declaration.initializer &&
        initializer?.value.kind !== ts.SyntaxKind.TrueKeyword &&
        initializer?.value.kind !== ts.SyntaxKind.FalseKeyword
      )
        this.fail(declaration, "PLC2001", "Annotate PLC storage explicitly.");
      const ambient = declaration.getSourceFile().isDeclarationFile;
      if (type.mode || this.resolver.hasReferences(type.type))
        this.fail(declaration, "PLC2001", "Borrow schemas cannot be stored as values.");
      if (this.resolver.types.get(type.type)?.kind === "block" && !instance)
        this.fail(
          declaration,
          "PLC1007",
          "Block instances require a static constructor initializer.",
        );
      if (
        instance &&
        (!immutable || (declaration.type && this.type(declaration.type).type !== instance))
      )
        this.fail(
          declaration,
          "PLC2001",
          "Static block instances require const bindings and matching annotations.",
        );
      if (
        initializer?.retain &&
        (ambient ||
          (immutable &&
            type.type !== "inferred" &&
            !instance &&
            !aggregate(this.resolver.types.get(type.type))))
      )
        this.fail(
          declaration,
          "PLC3004",
          "retain requires mutable persistent storage or a static block instance.",
        );
      if (ambient && !type.io)
        this.fail(declaration, "PLC4002", "Ambient PLC variables must declare Input or Output.");
      if (!ambient && type.io)
        this.fail(declaration, "PLC4002", "Logical I/O belongs in an ambient declaration file.");
      if (type.io === "input" && !immutable)
        this.fail(declaration, "PLC4002", "Inputs must use declare const.");
      if (type.io === "output" && immutable)
        this.fail(declaration, "PLC4002", "Outputs must use declare let.");
      const variable: Variable = {
        id: this.storageId(declaration, declaration.name.text),
        name: declaration.name.text,
        type: type.type,
        storage: instance
          ? "instance"
          : (type.io ??
            (immutable && !aggregate(this.resolver.types.get(type.type)) ? "constant" : "module")),
        mutable: !immutable,
        retain: initializer?.retain ?? false,
        span: span(declaration),
      };
      this.variables.set(this.resolver.symbol(declaration.name), variable);
      this.globalVariables.push(variable);
    }
  }

  private instantiate(
    node: ts.FunctionDeclaration,
    arguments_: readonly ts.TypeNode[],
    call: ts.Node,
  ): PlcFunction {
    const environment = this.resolver.bindings(
      node.typeParameters,
      arguments_,
      this.environment,
      call,
    );
    const suffix = (node.typeParameters ?? [])
      .map((parameter) => this.resolver.key(environment.get(this.resolver.symbol(parameter.name))!))
      .join(",");
    const id = `${this.resolver.id(node, node.name!.text)}${suffix ? `<${suffix}>` : ""}`;
    const existing = this.instances.get(id);
    if (existing) return existing;
    if (this.instances.size >= 256)
      this.fail(
        call,
        "PLC2001",
        "Generic specialization exceeds 256 concrete helpers; recursive specialization is unsupported.",
      );
    const saved = this.environment;
    this.environment = environment;
    try {
      const parameters = node.parameters.map((parameter) => {
        if (
          !ts.isIdentifier(parameter.name) ||
          !parameter.type ||
          parameter.initializer ||
          parameter.questionToken ||
          parameter.dotDotDotToken
        )
          this.fail(
            parameter,
            "PLC2001",
            "PLC parameters need names and explicit types; optional/rest/default parameters are unsupported.",
          );
        const type = this.type(parameter.type);
        if (!this.resolver.isValue(type))
          this.fail(
            parameter,
            "PLC2001",
            "Helper parameters require value types; InOut is confined to block inputs.",
          );
        if (type.io) this.fail(parameter, "PLC2001", "Parameters cannot use logical I/O wrappers.");
        return {
          id: `${this.resolver.id(parameter, parameter.name.text)}@${id}`,
          name: parameter.name.text,
          type: type.type,
          storage: "parameter" as const,
          mutable: false,
          retain: false,
          span: span(parameter),
        };
      });
      let result: string | undefined;
      if (node.type && node.type.kind !== ts.SyntaxKind.VoidKeyword) {
        const type = this.type(node.type);
        if (!this.resolver.isValue(type))
          this.fail(node.type, "PLC2001", "Helper results require value types.");
        if (type.io) this.fail(node.type, "PLC4002", "Helper results cannot use I/O wrappers.");
        result = type.type;
      } else if (!node.type) {
        const signature = this.checker.getSignatureFromDeclaration(node);
        if (
          !signature ||
          !(this.checker.getReturnTypeOfSignature(signature).flags & ts.TypeFlags.Void)
        )
          this.fail(node, "PLC2001", "Annotate helper results explicitly.");
      }
      const fn: PlcFunction = {
        id,
        name: `${node.name!.text}${suffix ? `_${suffix}` : ""}`,
        parameters,
        locals: [],
        body: [],
        span: span(node),
        ...(result && { result }),
      };
      this.instances.set(id, fn);
      this.pending.push({ node, fn, environment });
      return fn;
    } finally {
      this.environment = saved;
    }
  }

  private byId(): Map<string, Variable> {
    return new Map(
      [
        ...this.variables.values(),
        ...(this.activeBlock
          ? [...this.activeBlock.block.inputs, ...this.activeBlock.block.outputs]
          : []),
      ].map((variable) => [variable.id, variable]),
    );
  }

  private checked(value: Expression): Expression {
    const message = expressionIssue(value, this.resolver.types, this.byId(), this.ranges);
    if (message) throw new SemanticError(error("PLC2002", message, value.span));
    return value;
  }

  private coerce(value: Expression, destination: string): Expression {
    if (value.type === destination) return value;
    const source = this.resolver.types.get(value.type),
      target = this.resolver.types.get(destination);
    if (!source || !target)
      throw new SemanticError(error("PLC2001", "This PLC type has not been resolved.", value.span));
    const constant = fold(value, this.byId(), this.resolver.types);
    if (
      source.kind === "string" &&
      target.kind === "string" &&
      source.encoding === target.encoding &&
      source.capacity <= target.capacity
    )
      return constant
        ? { kind: "constant", type: destination, value: constant, span: value.span }
        : { kind: "convert", type: destination, operand: value, policy: "exact", span: value.span };
    if (!canAssign(source, target, constant))
      throw new SemanticError(
        error(
          "PLC2002",
          "Use an explicit conversion between these PLC domains or widths.",
          value.span,
        ),
      );
    if (constant) return { kind: "constant", type: destination, value: constant, span: value.span };
    return this.checked({
      kind: "convert",
      type: destination,
      operand: value,
      policy: "exact",
      span: value.span,
    });
  }

  private constant(expression: Expression): Constant | undefined {
    return fold(expression, this.byId(), this.resolver.types);
  }

  private numericLiteral(node: ts.Expression): string | undefined {
    while (ts.isParenthesizedExpression(node)) node = node.expression;
    if (ts.isNumericLiteral(node) || ts.isBigIntLiteral(node)) return node.getText();
    if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken) {
      const operand = this.numericLiteral(node.operand);
      if (operand !== undefined) return operand.startsWith("-") ? operand.slice(1) : `-${operand}`;
    }
    return undefined;
  }

  private contextualLiteral(node: ts.Expression): boolean {
    while (ts.isParenthesizedExpression(node)) node = node.expression;
    return (
      this.numericLiteral(node) !== undefined ||
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node)
    );
  }

  private literal(node: ts.Expression, expected?: string): Expression | undefined {
    const text = this.numericLiteral(node);
    if (text === undefined) return undefined;
    const type =
      expected ??
      (text.endsWith("n")
        ? "LINT"
        : /[.e]/i.test(text) && !/^[-]?0[xob]/i.test(text)
          ? "LREAL"
          : "DINT");
    const target = this.resolver.types.get(type);
    if (!target || !["integer", "bits", "float"].includes(target.kind))
      this.fail(
        node,
        "PLC2001",
        "Numeric literals require an arithmetic or bit-string PLC type; use named enum members.",
      );
    let value: Constant;
    if (target.kind === "float") {
      const clean = text.replaceAll("_", "");
      const number = /^-?0[xob]/i.test(clean) ? Number(parseInteger(clean)) : Number(clean);
      value = { kind: "float", value: target.bits === 32 ? Math.fround(number) : number };
    } else {
      try {
        value = { kind: "integer", value: String(parseInteger(text)) };
      } catch (cause) {
        this.fail(
          node,
          "PLC2002",
          cause instanceof Error ? cause.message : "Invalid integer literal.",
        );
      }
    }
    return this.checked({ kind: "constant", type, value, span: span(node) });
  }

  private expression(node: ts.Expression, expected?: string): Expression {
    if (ts.isParenthesizedExpression(node)) return this.expression(node.expression, expected);
    const literal = this.literal(node, expected);
    if (literal) return literal;
    const value = this.rawExpression(node, expected);
    return expected ? this.coerce(value, expected) : value;
  }

  private rawExpression(node: ts.Expression, expected?: string): Expression {
    const origin = { span: span(node) };
    if (node.kind === ts.SyntaxKind.TrueKeyword || node.kind === ts.SyntaxKind.FalseKeyword) {
      return {
        ...origin,
        type: "BOOL",
        kind: "constant",
        value: { kind: "bool", value: node.kind === ts.SyntaxKind.TrueKeyword },
      };
    }
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      const type = expected ? this.resolver.types.get(expected) : undefined;
      if (type?.kind !== "string")
        this.fail(node, "PLC2001", "String literals require a bounded STRING or WSTRING context.");
      return this.checked({
        ...origin,
        type: type.id,
        kind: "constant",
        value: { kind: "string", value: node.text },
      });
    }
    if (ts.isObjectLiteralExpression(node)) {
      const type = expected ? this.resolver.types.get(expected) : undefined;
      if (type?.kind !== "record")
        this.fail(node, "PLC2001", "Record literals require an explicit closed PLC record type.");
      const fields: Record<string, Expression> = Object.create(null);
      for (const property of node.properties) {
        if (
          !(ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)) ||
          !ts.isIdentifier(property.name)
        )
          this.fail(
            property,
            "PLC1001",
            "Record literals require named fields; spreading and methods are unsupported.",
          );
        const fieldName = property.name.text;
        const field = type.fields.find((field) => field.name === fieldName);
        if (!field || Object.hasOwn(fields, field.name))
          this.fail(property, "PLC2001", "Unknown or duplicate record field.");
        fields[field.name] = this.expression(
          ts.isPropertyAssignment(property) ? property.initializer : property.name,
          field.type,
        );
        this.fresh(fields[field.name]!);
      }
      return this.checked({ ...origin, type: type.id, kind: "record", fields });
    }
    if (ts.isArrayLiteralExpression(node)) {
      const type = expected ? this.resolver.types.get(expected) : undefined;
      if (type?.kind !== "array")
        this.fail(node, "PLC2001", "Array literals require an explicit FixedArray type.");
      const items = node.elements.map((element) => {
        if (ts.isOmittedExpression(element) || ts.isSpreadElement(element))
          this.fail(element, "PLC1001", "Fixed arrays cannot have holes or spreading.");
        const value = this.expression(element, type.element);
        this.fresh(value);
        return value;
      });
      return this.checked({ ...origin, type: type.id, kind: "array", items });
    }
    if (ts.isPropertyAccessExpression(node)) {
      const declaration = this.resolver.symbol(node.name).declarations?.find(ts.isEnumMember);
      if (declaration) {
        const type = this.resolver.enumeration(declaration.parent).type;
        const layout = this.resolver.types.get(type)!;
        if (layout.kind !== "enum") this.fail(node, "PLC2001", "Invalid enum layout.");
        return {
          ...origin,
          type,
          kind: "constant",
          value: {
            kind: "integer",
            value: layout.members.find((member) => member.name === declaration.name.getText())!
              .value,
          },
        };
      }
      if (node.name.text === "length") {
        const base = this.expression(node.expression),
          type = this.resolver.types.get(base.type);
        if (type?.kind === "array")
          return { ...origin, type: "DINT", kind: "length", operand: base };
      }
    }
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      const place = this.place(node),
        type = placeType(place, this.resolver.types, this.byId(), this.ranges);
      if (type.issue || !type.type) this.fail(node, "PLC2001", type.issue ?? "Invalid PLC place.");
      return { ...origin, type: type.type, kind: "load", place };
    }
    if (ts.isIdentifier(node)) {
      const variable = this.variables.get(this.resolver.symbol(node));
      if (!variable) this.fail(node, "PLC1002", "This value has no supported PLC storage.");
      if (variable.type === "inferred")
        this.fail(
          node,
          "PLC3001",
          "Resolve constant initializer dependencies in declaration order.",
        );
      return {
        ...origin,
        type: variable.type,
        kind: "load",
        place: { root: variable.id, path: [] },
      };
    }
    if (ts.isPrefixUnaryExpression(node)) {
      const operator =
        node.operator === ts.SyntaxKind.ExclamationToken
          ? "not"
          : node.operator === ts.SyntaxKind.MinusToken
            ? "negate"
            : node.operator === ts.SyntaxKind.TildeToken
              ? "bitNot"
              : undefined;
      if (!operator) this.fail(node, "PLC2001", "Unsupported unary operation.");
      const operand = this.expression(node.operand, operator === "not" ? "BOOL" : expected);
      return this.checked({
        ...origin,
        type: operator === "not" ? "BOOL" : operand.type,
        kind: "unary",
        operator,
        operand,
      });
    }
    if (ts.isCallExpression(node)) {
      const sdk = this.sdkExpression(node, expected);
      if (sdk) return sdk;
      const call = this.call(node);
      if (!call.fn.result)
        this.fail(node, "PLC2001", "A void helper cannot produce an expression value.");
      return {
        ...origin,
        type: call.fn.result,
        kind: "call",
        function: call.fn.id,
        arguments: call.arguments,
      };
    }
    if (ts.isConditionalExpression(node)) {
      const then = this.expression(node.whenTrue, expected);
      return {
        ...origin,
        type: then.type,
        kind: "conditional",
        condition: this.expression(node.condition, "BOOL"),
        then,
        else: this.expression(node.whenFalse, then.type),
      };
    }
    if (ts.isBinaryExpression(node)) return this.binaryExpression(node, expected);
    this.fail(node, "PLC1001", `${ts.SyntaxKind[node.kind]} is not supported in PLC expressions.`);
  }

  private binaryExpression(node: ts.BinaryExpression, expected?: string): Expression {
    const origin = { span: span(node) };
    const operator = operators.get(node.operatorToken.kind);
    if (!operator)
      this.fail(
        node.operatorToken,
        "PLC2001",
        "Unsupported binary operation; implicit coercion is prohibited.",
      );
    const logical = operator === "and" || operator === "or";
    const comparison = comparisonOperators.has(operator);
    const leftIsLiteral = this.contextualLiteral(node.left);
    const context = logical
      ? "BOOL"
      : comparison
        ? leftIsLiteral
          ? this.expression(node.right).type
          : undefined
        : expected;
    const left = this.expression(node.left, context);
    const right = this.expression(
      node.right,
      operator === "shiftLeft" || operator === "shiftRight" ? "DINT" : left.type,
    );
    if (operator === "divide" && this.resolver.types.get(left.type)?.kind !== "float")
      this.fail(node, "PLC2002", "Use div<T>() for truncating integer division.");
    return this.checked({
      ...origin,
      type: logical || comparison ? "BOOL" : left.type,
      kind: "binary",
      operator,
      left,
      right,
    });
  }

  private sdkExpression(node: ts.CallExpression, expected?: string): Expression | undefined {
    const origin = { span: span(node) };
    const official = this.sdkCall(node);
    if (
      official &&
      (Object.hasOwn(durationScales, official) || Object.hasOwn(calendarTypes, official))
    ) {
      if (node.arguments.length !== 1 || node.typeArguments?.length)
        this.fail(node, "PLC2001", "Time constructors require one compile-time literal argument.");
      const argument = node.arguments[0]!;
      const scale = durationScales[official];
      let value: Constant | undefined, type: string;
      if (scale) {
        type = "TIME";
        let text = this.numericLiteral(argument);
        if (text === undefined) {
          const folded = this.constant(this.expression(argument));
          if (folded?.kind === "integer") text = folded.value;
        }
        if (text !== undefined && /^-?0[xob]/i.test(text)) text = String(parseInteger(text));
        value = text === undefined ? undefined : durationLiteral(text.replace(/n$/, ""), scale);
      } else {
        type = calendarTypes[official]!;
        const layout = this.resolver.types.get(type)!;
        value =
          layout.kind === "calendar" &&
          (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument))
            ? calendarLiteral(layout.domain, argument.text)
            : undefined;
      }
      if (!value)
        this.fail(
          argument,
          "PLC2002",
          "Invalid time literal: require an exact supported domain value and millisecond TIME precision.",
        );
      return this.checked({ ...origin, type, kind: "constant", value });
    }
    if (official === "timeToMilliseconds") {
      if (node.arguments.length !== 1 || node.typeArguments?.length)
        this.fail(
          node,
          "PLC2001",
          "timeToMilliseconds requires one TIME argument and no type arguments.",
        );
      return this.checked({
        ...origin,
        type: "UDINT",
        kind: "unary",
        operator: "timeToMilliseconds",
        operand: this.expression(node.arguments[0]!),
      });
    }
    if (official === "defaultValue") {
      if (node.arguments.length || node.typeArguments?.length !== 1)
        this.fail(
          node,
          "PLC2001",
          "defaultValue requires exactly one concrete type and no value arguments.",
        );
      const type = this.type(node.typeArguments[0]!);
      if (!this.resolver.isValue(type))
        this.fail(
          node,
          "PLC2001",
          "defaultValue requires a fixed value layout, not an instance or borrow schema.",
        );
      if (type.io) this.fail(node, "PLC4002", "Default values cannot create logical I/O.");
      return this.checked({
        ...origin,
        type: type.type,
        kind: "constant",
        value: defaultValue(type.type, this.resolver.types),
      });
    }
    if (official === "copy") {
      if (node.arguments.length !== 1 || (node.typeArguments && node.typeArguments.length !== 1))
        this.fail(node, "PLC2001", "copy requires one fixed aggregate value.");
      const operand = this.expression(
        node.arguments[0]!,
        node.typeArguments?.[0] ? this.type(node.typeArguments[0]).type : expected,
      );
      return this.checked({ ...origin, type: operand.type, kind: "copy", operand });
    }
    if (official && (Object.hasOwn(conversions, official) || Object.hasOwn(arithmetic, official))) {
      const argument = node.typeArguments?.[0];
      if (!argument || node.typeArguments?.length !== 1)
        this.fail(
          node,
          "PLC2001",
          "Numeric SDK operations require one explicit PLC type argument.",
        );
      const target = this.type(argument);
      if (target.io)
        this.fail(argument, "PLC2001", "I/O wrappers cannot select an operation type.");
      const conversion = conversions[official];
      if (conversion) {
        if (node.arguments.length !== 1)
          this.fail(node, "PLC2001", "Conversion needs exactly one operand.");
        return this.checked({
          ...origin,
          type: target.type,
          kind: "convert",
          policy: conversion,
          operand: this.expression(node.arguments[0]!),
        });
      }
      const operation = arithmetic[official]!;
      if (node.arguments.length !== 2)
        this.fail(node, "PLC2001", "Arithmetic SDK operation needs two operands.");
      return this.checked({
        ...origin,
        type: target.type,
        kind: "binary",
        ...operation,
        left: this.expression(node.arguments[0]!, target.type),
        right: this.expression(node.arguments[1]!, target.type),
      });
    }
    return undefined;
  }

  private sdkCall(node: ts.CallExpression): string | undefined {
    const name = calleeName(node.expression);
    return name && this.resolver.sdkName(name);
  }

  private update(node: ts.CallExpression): Statement | undefined {
    if (!ts.isPropertyAccessExpression(node.expression) || node.expression.name.text !== "update")
      return undefined;
    const place = this.place(node.expression.expression),
      variable = this.byId().get(place.root),
      type = variable && this.resolver.types.get(variable.type);
    if (type?.kind !== "block" || place.path.length)
      this.fail(node, "PLC1007", "Update requires a static block instance binding.");
    const definition = this.blocks.definitions.get(type.block)!;
    if (
      node.typeArguments?.length ||
      node.arguments.length !== 1 ||
      !ts.isObjectLiteralExpression(node.arguments[0]!)
    )
      this.fail(node, "PLC2001", "Block update requires one complete named input record.");
    const inputs: Record<string, Expression> = Object.create(null);
    for (const property of node.arguments[0].properties) {
      if (
        !(ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)) ||
        !ts.isIdentifier(property.name)
      )
        this.fail(property, "PLC2001", "Block inputs require named fields without spreading.");
      const name = property.name.text;
      const parameter = definition.inputs.find((input) => input.name === name);
      if (!parameter || Object.hasOwn(inputs, parameter.name))
        this.fail(property, "PLC2001", "Unknown or duplicate block input.");
      const value = ts.isPropertyAssignment(property) ? property.initializer : property.name;
      if (parameter.mode === "inOut") {
        if (
          !ts.isCallExpression(value) ||
          this.sdkCall(value) !== "ref" ||
          value.arguments.length !== 1 ||
          value.typeArguments?.length
        )
          this.fail(
            value,
            "PLC3003",
            "InOut inputs require a direct ref(place) borrow at the update call.",
          );
        const target = this.target(value.arguments[0]!);
        if (target.type !== parameter.type)
          this.fail(
            value,
            "PLC2001",
            "Borrowed place type must exactly match its InOut parameter.",
          );
        inputs[parameter.name] = {
          kind: "borrow",
          place: target.place,
          type: target.type,
          span: span(value),
        };
      } else inputs[parameter.name] = this.expression(value, parameter.type);
    }
    if (definition.inputs.some((input) => !Object.hasOwn(inputs, input.name)))
      this.fail(node, "PLC2001", "Block update must bind every input on each call.");
    return { kind: "blockUpdate", instance: place.root, inputs, span: span(node) };
  }

  private call(node: ts.CallExpression): { fn: PlcFunction; arguments: Expression[] } {
    const name = calleeName(node.expression);
    if (!name) this.fail(node, "PLC1001", "Call a statically resolved PLC helper.");
    const symbol = this.resolver.symbol(name);
    const declaration = this.functionDeclarations.get(symbol);
    if (!declaration)
      this.fail(node, "PLC1001", "Calls require PLC TypeScript implementation source.");
    const fn = declaration.typeParameters?.length
      ? this.instantiate(declaration, node.typeArguments ?? [], node)
      : this.functions.get(symbol);
    if (!fn || (!declaration.typeParameters?.length && node.typeArguments?.length))
      this.fail(node, "PLC2001", "Type arguments require a generic helper.");
    if (node.arguments.length !== fn.parameters.length)
      this.fail(node, "PLC2001", "PLC helper argument count differs from its signature.");
    return {
      fn,
      arguments: fn.parameters.map((parameter, index) =>
        this.expression(node.arguments[index]!, parameter.type),
      ),
    };
  }

  private statements(nodes: readonly ts.Statement[], locals: Variable[]): Statement[] {
    return nodes.flatMap((node) => this.statement(node, locals));
  }

  private body(node: ts.Statement, locals: Variable[]): Statement[] {
    return ts.isBlock(node)
      ? this.statements(node.statements, locals)
      : this.statement(node, locals);
  }

  private fresh(value: Expression): void {
    if (this.resolver.types.get(value.type)?.kind === "block")
      throw new SemanticError(
        error("PLC3003", "Block instances cannot be copied, aliased or returned.", value.span),
      );
    if (aggregate(this.resolver.types.get(value.type)) && value.kind === "load")
      throw new SemanticError(
        error(
          "PLC3003",
          "Aggregate aliases are unsupported; use copy(value) for an explicit fixed-storage copy.",
          value.span,
        ),
      );
  }

  private place(node: ts.Expression): Place {
    if (ts.isParenthesizedExpression(node)) return this.place(node.expression);
    if (this.activeBlock && ts.isPropertyAccessExpression(node)) {
      if (
        ts.isIdentifier(node.expression) &&
        this.resolver.symbol(node.expression) === this.activeBlock.inputSymbol
      ) {
        const variable = this.activeBlock.inputBindings.get(node.name.text);
        if (!variable) this.fail(node, "PLC2001", "Unknown block input field.");
        return { root: variable.id, path: [] };
      }
      if (
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.expression.kind === ts.SyntaxKind.ThisKeyword &&
        node.expression.name.text === "out"
      ) {
        const variable = this.activeBlock.block.outputs.find(
          (output) => output.name === node.name.text,
        );
        if (!variable) this.fail(node, "PLC2001", "Unknown block output field.");
        return { root: variable.id, path: [] };
      }
    }
    if (
      ts.isPropertyAccessExpression(node) &&
      this.activeBlock?.fieldBindings.has(this.resolver.symbol(node.name)) &&
      node.expression.kind !== ts.SyntaxKind.ThisKeyword
    )
      this.fail(node, "PLC1007", "Private block state is accessible through this.field only.");
    if (ts.isIdentifier(node) || ts.isPropertyAccessExpression(node)) {
      const variable = this.variables.get(
        this.resolver.symbol(ts.isIdentifier(node) ? node : node.name),
      );
      if (variable) return { root: variable.id, path: [] };
    }
    if (ts.isPropertyAccessExpression(node)) {
      const base = this.place(node.expression);
      return { root: base.root, path: [...base.path, { kind: "field", name: node.name.text }] };
    }
    if (ts.isElementAccessExpression(node) && node.argumentExpression) {
      const base = this.place(node.expression);
      return {
        root: base.root,
        path: [...base.path, { kind: "index", value: this.expression(node.argumentExpression) }],
      };
    }
    this.fail(node, "PLC1001", "Access requires statically allocated PLC storage.");
  }

  private target(node: ts.Expression): { place: Place; type: string } {
    if (ts.isIdentifier(node)) {
      const binding = this.checker.getSymbolAtLocation(node);
      if (binding && binding.flags & ts.SymbolFlags.Alias)
        this.fail(node, "PLC3002", "Imported scalar bindings are read-only.");
    }
    const place = this.place(node),
      type = placeType(place, this.resolver.types, this.byId(), this.ranges, true);
    if (type.issue || !type.type || this.loopCounters.has(place.root))
      this.fail(node, "PLC3002", type.issue ?? "This PLC storage is read-only.");
    return { place, type: type.type };
  }

  private statement(node: ts.Statement, locals: Variable[]): Statement[] {
    const origin = { span: span(node) };
    if (ts.isBlock(node)) return this.statements(node.statements, locals);
    if (ts.isEmptyStatement(node)) return [];
    if (ts.isIfStatement(node))
      return [
        {
          ...origin,
          kind: "if",
          condition: this.expression(node.expression, "BOOL"),
          // biome-ignore lint/suspicious/noThenProperty: PLC branch data is an array, not a thenable callback.
          then: this.body(node.thenStatement, locals),
          else: node.elseStatement ? this.body(node.elseStatement, locals) : [],
        },
      ];
    if (ts.isReturnStatement(node)) {
      const result = this.activeFunction?.result;
      if (!result && node.expression)
        this.fail(node, "PLC2001", "Void helpers and program entries cannot return a value.");
      if (result && !node.expression)
        this.fail(node, "PLC2001", "Typed helpers must return their declared PLC result.");
      const value =
        node.expression && result ? this.expression(node.expression, result) : undefined;
      if (value) this.fresh(value);
      return [{ ...origin, kind: "return", ...(value && { value }) }];
    }
    if (ts.isBreakStatement(node) || ts.isContinueStatement(node)) {
      if (ts.isBreakStatement(node) && this.breakTargets.at(-1) === "switch")
        this.fail(
          node,
          "PLC1001",
          "Switch break must terminate its case; nested conditional switch breaks are unsupported.",
        );
      if (node.label || !this.loopCounters.size)
        this.fail(
          node,
          "PLC1001",
          "Loop control requires an enclosing bounded loop and cannot use a label.",
        );
      return [{ ...origin, kind: ts.isBreakStatement(node) ? "break" : "continue" }];
    }
    if (ts.isVariableStatement(node)) return this.localDeclarations(node, locals);
    if (ts.isForStatement(node)) return this.loop(node, locals);
    if (ts.isSwitchStatement(node)) return this.switchStatement(node, locals);
    if (ts.isExpressionStatement(node)) {
      const expression = node.expression;
      if (ts.isCallExpression(expression)) {
        const update = this.update(expression);
        if (update) return [update];
        const call = this.call(expression);
        return [{ ...origin, kind: "invoke", function: call.fn.id, arguments: call.arguments }];
      }
      if (ts.isBinaryExpression(expression)) {
        const variable = this.target(expression.left);
        if (expression.operatorToken.kind !== ts.SyntaxKind.EqualsToken)
          this.fail(expression, "PLC2001", "Use explicit assignment and arithmetic policies.");
        const value = this.expression(expression.right, variable.type);
        this.fresh(value);
        return [{ ...origin, kind: "assign", destination: variable.place, value }];
      }
    }
    this.fail(node, "PLC1001", `${ts.SyntaxKind[node.kind]} is not supported in PLC scan code.`);
  }

  private switchStatement(node: ts.SwitchStatement, locals: Variable[]): Statement[] {
    const origin = { span: span(node) };
    this.breakTargets.push("switch");
    try {
      const value = this.expression(node.expression);
      const cases: { values: Constant[]; body: Statement[] }[] = [];
      let fallback: Statement[] = [];
      let pending: Constant[] = [],
        pendingDefault = false;
      for (const clause of node.caseBlock.clauses) {
        if (ts.isDefaultClause(clause)) pendingDefault = true;
        else {
          const constant = this.constant(this.expression(clause.expression, value.type));
          if (!constant)
            this.fail(clause, "PLC2001", "Case values must be compile-time constants.");
          pending.push(constant);
        }
        if (!clause.statements.length) continue;
        let statements = [...clause.statements];
        const last = statements.at(-1);
        if (last && ts.isBreakStatement(last) && !last.label) statements = statements.slice(0, -1);
        else if (statements.length && !(last && ts.isReturnStatement(last)))
          this.fail(
            clause,
            "PLC1001",
            "Switch cases must end with break or return; fallthrough is prohibited.",
          );
        const body = this.statements(statements, locals);
        if (pending.length) cases.push({ values: pending, body });
        if (pendingDefault) fallback = body;
        pending = [];
        pendingDefault = false;
      }
      if (pending.length) cases.push({ values: pending, body: [] });
      return [{ ...origin, kind: "switch", value, cases, fallback }];
    } finally {
      this.breakTargets.pop();
    }
  }

  private localDeclarations(node: ts.VariableStatement, locals: Variable[]): Statement[] {
    const origin = { span: span(node) };
    if (!(node.declarationList.flags & (ts.NodeFlags.Let | ts.NodeFlags.Const)))
      this.fail(node, "PLC1001", "Use let or const for invocation locals.");
    return node.declarationList.declarations.map((declaration) => {
      if (!ts.isIdentifier(declaration.name))
        this.fail(declaration, "PLC1001", "Destructuring is not supported.");
      if (!declaration.initializer)
        this.fail(declaration, "PLC3001", "Initialize invocation-local PLC variables explicitly.");
      const annotation = declaration.type ? this.type(declaration.type) : undefined;
      if (annotation && !this.resolver.isValue(annotation))
        this.fail(
          declaration,
          "PLC2001",
          "Invocation locals require value types, not instances or borrow schemas.",
        );
      if (annotation?.io)
        this.fail(declaration, "PLC4002", "Logical I/O cannot be invocation-local.");
      if (
        !annotation &&
        !(node.declarationList.flags & ts.NodeFlags.Const) &&
        ![ts.SyntaxKind.TrueKeyword, ts.SyntaxKind.FalseKeyword].includes(
          declaration.initializer.kind,
        )
      )
        this.fail(declaration, "PLC2001", "Annotate mutable numeric storage explicitly.");
      const value = this.expression(declaration.initializer, annotation?.type);
      this.fresh(value);
      const variable: Variable = {
        id: this.storageId(declaration, declaration.name.text),
        name: declaration.name.text,
        type: value.type,
        storage: "local",
        mutable: !(node.declarationList.flags & ts.NodeFlags.Const),
        retain: false,
        span: span(declaration),
      };
      this.variables.set(this.resolver.symbol(declaration.name), variable);
      locals.push(variable);
      return { ...origin, kind: "assign", destination: { root: variable.id, path: [] }, value };
    });
  }

  private loop(node: ts.ForStatement, locals: Variable[]): Statement[] {
    let counter: Variable;
    let initializer: ts.Expression;
    let existing = false;
    if (node.initializer && ts.isVariableDeclarationList(node.initializer)) {
      if (
        !(node.initializer.flags & ts.NodeFlags.Let) ||
        node.initializer.declarations.length !== 1
      )
        this.fail(
          node,
          "PLC1001",
          "A bounded for loop requires one let counter or an existing counter assignment.",
        );
      const declaration = node.initializer.declarations[0]!;
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer)
        this.fail(node, "PLC2001", "Initialize the integer loop counter.");
      const annotation = declaration.type ? this.type(declaration.type) : { type: "DINT" };
      if (annotation.io)
        this.fail(declaration, "PLC4002", "Loop counters cannot use I/O wrappers.");
      counter = {
        id: this.storageId(declaration, declaration.name.text),
        name: declaration.name.text,
        type: annotation.type,
        storage: "local",
        mutable: true,
        retain: false,
        span: span(declaration),
      };
      this.variables.set(this.resolver.symbol(declaration.name), counter);
      locals.push(counter);
      initializer = declaration.initializer;
    } else if (
      node.initializer &&
      ts.isBinaryExpression(node.initializer) &&
      node.initializer.operatorToken.kind === ts.SyntaxKind.EqualsToken
    ) {
      const target = this.target(node.initializer.left);
      counter = this.byId().get(target.place.root)!;
      if (target.place.path.length || !["local", "module", "field"].includes(counter.storage))
        this.fail(
          node.initializer,
          "PLC1001",
          "An existing loop counter must be a local, module variable or private block field.",
        );
      initializer = node.initializer.right;
      existing = true;
    } else
      this.fail(
        node,
        "PLC1001",
        "Initialize one let counter or assign an existing counter in the for header.",
      );
    const type = counter.type,
      plcType = this.resolver.types.get(type);
    if (plcType?.kind !== "integer")
      this.fail(node.initializer!, "PLC2001", "Loop counters require integer types.");
    const start = this.constant(this.expression(initializer, type));
    if (start?.kind !== "integer")
      this.fail(initializer, "PLC2001", "Loop start must be a compile-time integer.");
    const isCounter = (expression: ts.Expression): boolean => {
      const place = this.place(expression);
      return place.root === counter.id && place.path.length === 0;
    };
    const condition = node.condition;
    if (!condition || !ts.isBinaryExpression(condition) || !isCounter(condition.left))
      this.fail(node, "PLC1001", "Loop condition must compare its counter to a constant bound.");
    const bound = this.constant(this.expression(condition.right, type));
    if (bound?.kind !== "integer")
      this.fail(condition, "PLC2001", "Loop bound must be a compile-time integer.");
    let step: bigint;
    const increment = node.incrementor;
    if (
      increment &&
      (ts.isPostfixUnaryExpression(increment) || ts.isPrefixUnaryExpression(increment)) &&
      isCounter(increment.operand) &&
      [ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken].includes(increment.operator)
    )
      step = increment.operator === ts.SyntaxKind.PlusPlusToken ? 1n : -1n;
    else if (
      increment &&
      ts.isBinaryExpression(increment) &&
      isCounter(increment.left) &&
      [ts.SyntaxKind.PlusEqualsToken, ts.SyntaxKind.MinusEqualsToken].includes(
        increment.operatorToken.kind,
      )
    ) {
      const amount = this.constant(this.expression(increment.right, type));
      if (amount?.kind !== "integer" || BigInt(amount.value) <= 0n)
        this.fail(increment, "PLC2001", "Loop step must be a positive constant integer.");
      step =
        BigInt(amount.value) *
        (increment.operatorToken.kind === ts.SyntaxKind.PlusEqualsToken ? 1n : -1n);
    } else this.fail(node, "PLC1001", "Use i++, i--, i += step or i -= step in the for header.");
    const operator = condition.operatorToken.kind,
      ascending = step > 0n;
    if (
      !(
        ascending
          ? [ts.SyntaxKind.LessThanToken, ts.SyntaxKind.LessThanEqualsToken]
          : [ts.SyntaxKind.GreaterThanToken, ts.SyntaxKind.GreaterThanEqualsToken]
      ).includes(operator)
    )
      this.fail(condition, "PLC2001", "Loop direction and comparison must agree.");
    const exclusive =
      operator === ts.SyntaxKind.LessThanToken || operator === ts.SyntaxKind.GreaterThanToken;
    const finish = BigInt(bound.value) + (exclusive ? (ascending ? -1n : 1n) : 0n),
      first = BigInt(start.value);
    const count = loopIterations(first, finish, step);
    if (count > 1_000_000n)
      this.fail(node, "PLC2001", "A scan loop cannot exceed 1,000,000 iterations.");
    if (existing) {
      const terminal = first + count * step,
        [minimum, maximum] = integerRange(plcType);
      if (terminal < minimum || terminal > maximum)
        this.fail(
          node,
          "PLC2001",
          "The existing loop counter would overflow on its final increment.",
        );
    }
    this.loopCounters.add(counter.id);
    this.ranges.set(counter.id, first <= finish ? [first, finish] : [finish, first]);
    let body: Statement[];
    this.breakTargets.push("loop");
    try {
      body = this.body(node.statement, locals);
    } finally {
      this.breakTargets.pop();
      this.loopCounters.delete(counter.id);
      this.ranges.delete(counter.id);
    }
    if (!count)
      return existing
        ? [
            {
              kind: "assign",
              destination: { root: counter.id, path: [] },
              value: { kind: "constant", type, value: start, span: span(initializer) },
              span: span(node.initializer!),
            },
          ]
        : [];
    const limit: Expression = {
      kind: "constant",
      type,
      value: { kind: "integer", value: String(finish) },
      span: span(condition.right),
    };
    return [
      {
        span: span(node),
        kind: "for",
        counter: counter.id,
        ...(existing && { counterScope: "existing" as const }),
        start: { kind: "constant", type, value: start, span: span(initializer) },
        limit,
        step: String(step),
        maxIterations: Number(count),
        body,
      },
    ];
  }
}
