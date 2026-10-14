import { TextDocument } from "vscode-languageserver-textdocument";
import { diagnostic, lex } from "./lexer";
import {
  type Argument,
  type Expr,
  keywords,
  modifiers,
  namedType,
  objectKinds,
  type ParsedFile,
  qualifiers,
  type Span,
  type StSymbol,
  type SymbolKind,
  type Token,
  type TypeNode,
  unknownType,
  variableSections,
  voidType,
} from "./model";

const precedence: Record<string, number> = {
  "..": 1,
  OR: 2,
  OR_ELSE: 2,
  XOR: 3,
  AND: 4,
  AND_THEN: 4,
  "&": 4,
  "=": 5,
  "<>": 5,
  "<": 6,
  ">": 6,
  "<=": 6,
  ">=": 6,
  "+": 7,
  "-": 7,
  "*": 8,
  "/": 8,
  MOD: 8,
  "**": 9,
};
const boundaries = new Set([
  "END_VAR",
  "END_TYPE",
  "END_STRUCT",
  "END_UNION",
  "THEN",
  "DO",
  "OF",
  "TO",
  "BY",
  "ELSE",
  "ELSIF",
  "UNTIL",
  "END_IF",
  "END_FOR",
  "END_CASE",
  "END_WHILE",
  "END_REPEAT",
  ...Object.keys(objectKinds).map((name) => `END_${name}`),
]);

class Parser {
  private cursor = 0;
  private depth = 0;
  readonly file: ParsedFile;
  constructor(uri: string, text: string, version: number) {
    const document = TextDocument.create(uri, "codesys-st", version, text);
    this.file = {
      document,
      ...lex(document),
      locals: [],
      statements: [],
      typeUses: [],
      bodyStart: 0,
    };
  }
  private peek(ahead = 0): Token {
    const token = this.file.tokens[Math.min(this.cursor + ahead, this.file.tokens.length - 1)];
    if (!token) {
      throw new Error("Lexer invariant: missing EOF token.");
    }
    return token;
  }
  private take(): Token {
    const token = this.peek();
    if (token.kind !== "eof") {
      this.cursor++;
    }
    return token;
  }
  private at(value: string): boolean {
    return this.peek().upper === value;
  }
  private eat(value: string): boolean {
    if (!this.at(value)) {
      return false;
    }
    this.take();
    return true;
  }
  private error(message: string, span: Span = this.peek()) {
    if (this.file.diagnostics.length < 200) {
      this.file.diagnostics.push(diagnostic(this.file.document, span, "syntax", message));
    }
  }
  private expect(value: string): Token {
    if (this.at(value)) {
      return this.take();
    }
    this.error(`Expected ${value}.`);
    return {
      kind: "symbol",
      text: value,
      upper: value,
      start: this.peek().start,
      end: this.peek().start,
    };
  }
  private identifier(): Token {
    if (this.peek().kind === "word" && (!keywords.has(this.peek().upper) || this.at("OVERRIDE"))) {
      return this.take();
    }
    this.error("Expected an IEC identifier.");
    const token = this.peek();
    if (!boundaries.has(token.upper) && token.kind !== "eof") {
      this.take();
    }
    return { ...token, text: "", upper: "", end: token.start };
  }
  private preceding(start: number) {
    const source = this.file.document.getText();
    const result: Token[] = [];
    let end = start;
    for (const token of [...this.file.trivia].reverse()) {
      if (token.end > end) {
        continue;
      }
      if (source.slice(token.end, end).trim()) {
        break;
      }
      result.unshift(token);
      end = token.start;
    }
    return result;
  }
  private symbol(name: Token, kind: SymbolKind, start = name.start): StSymbol {
    const preceding = this.preceding(start);
    return {
      id: `${this.file.document.uri}#${name.start}`,
      uri: this.file.document.uri,
      name: name.text,
      nameSpan: { start: name.start, end: name.end },
      kind,
      type: voidType,
      members: [],
      section: "",
      modifiers: [],
      attributes: preceding
        .filter((t) => t.kind === "pragma")
        .flatMap((t) =>
          [...t.text.matchAll(/attribute\s+'([^']+)'/gi)].map((m) => m[1]?.toLowerCase() ?? ""),
        ),
      bases: [],
      interfaces: [],
      documentation: preceding
        .filter((t) => t.kind === "comment")
        .map((t) => t.text.replace(/^\(\*|\*\)$|^\/\/\s?/g, "").trim())
        .join("\n\n"),
      start,
      end: name.end,
    };
  }
  private readModifiers() {
    const result: string[] = [];
    while (modifiers.has(this.peek().upper)) {
      if (
        this.at("OVERRIDE") &&
        (this.peek(1).kind !== "word" ||
          keywords.has(this.peek(1).upper) ||
          /[\r\n]/.test(this.file.document.getText().slice(this.peek().end, this.peek(1).start)))
      ) {
        break;
      }
      result.push(this.take().upper);
    }
    return result;
  }
  private type(): TypeNode {
    const start = this.peek().start;
    if (++this.depth > 96) {
      this.depth--;
      this.error("Type nesting exceeds the editor limit (96).");
      this.take();
      return unknownType;
    }
    const result = this.typeInner(start);
    this.depth--;
    return result;
  }
  private typeInner(start: number): TypeNode {
    if (this.at("POINTER") || this.at("REFERENCE") || this.at("REF_TO")) {
      const prefix = this.take().upper;
      if (prefix !== "REF_TO") {
        this.expect("TO");
      }
      const target = this.type();
      return {
        kind: prefix === "POINTER" ? "pointer" : "reference",
        target,
        start,
        end: target.end,
      };
    }
    if (this.eat("ARRAY")) {
      this.expect("[");
      const bounds: { low?: Expr; high?: Expr }[] = [];
      do {
        if (this.eat("*")) {
          bounds.push({});
        } else {
          const low = this.expression(2);
          this.expect("..");
          const high = this.expression(2);
          bounds.push({ low, high });
        }
      } while (this.eat(","));
      this.expect("]");
      this.expect("OF");
      const element = this.type();
      return { kind: "array", element, bounds, start, end: element.end };
    }
    const nameToken = this.identifier();
    if (!nameToken.text) {
      return { ...unknownType, start, end: this.peek().start };
    }
    let name = nameToken.text;
    let end = nameToken.end;
    while (this.eat(".")) {
      const part = this.identifier();
      name += `.${part.text}`;
      end = part.end;
    }
    if (["STRING", "WSTRING"].includes(name.toUpperCase())) {
      const type: TypeNode = {
        kind: "string",
        wide: name.toUpperCase() === "WSTRING",
        start,
        end,
      };
      if (this.at("(") || this.at("[")) {
        const close = this.take().upper === "(" ? ")" : "]";
        type.length = this.expression();
        type.end = this.expect(close).end;
      }
      return type;
    }
    const base = namedType(name, { start, end });
    this.file.typeUses.push(base);
    if (this.eat("(")) {
      const low = this.expression(2);
      this.expect("..");
      const high = this.expression(2);
      end = this.expect(")").end;
      return { kind: "subrange", base, low, high, start, end };
    }
    if (this.eat("<")) {
      // Generic specialization is visible but not silently claimed to be checked.
      this.file.diagnostics.push(
        diagnostic(
          this.file.document,
          base,
          "unsupported-generic",
          "Generic specializations require CODESYS compiler validation.",
          2,
        ),
      );
      let nesting = 1;
      while (this.peek().kind !== "eof" && nesting && !boundaries.has(this.peek().upper)) {
        const token = this.take();
        if (token.upper === "<") {
          nesting++;
        }
        if (token.upper === ">") {
          nesting--;
        }
        base.end = token.end;
      }
    }
    return base;
  }
  private variables(
    endKeyword: string,
    section: string,
    sectionModifiers: string[] = [],
  ): StSymbol[] {
    const members: StSymbol[] = [];
    while (this.peek().kind !== "eof" && !this.at(endKeyword)) {
      if (boundaries.has(this.peek().upper) || variableSections.has(this.peek().upper)) {
        this.error(`Missing ${endKeyword}.`);
        return members;
      }
      const before = this.cursor;
      const names = [this.identifier()];
      while (this.eat(",")) {
        names.push(this.identifier());
      }
      let address: Token | undefined;
      if (this.eat("AT")) {
        if (this.peek().kind === "address") {
          address = this.peek();
        }
        while (
          this.peek().kind !== "eof" &&
          !this.at(":") &&
          !this.at(";") &&
          !boundaries.has(this.peek().upper)
        ) {
          this.take();
        }
      }
      this.expect(":");
      const type = this.type();
      const initializer = this.eat(":=") ? this.expression() : undefined;
      const end = this.expect(";").end;
      for (const name of names.filter((n) => n.text)) {
        const member = this.symbol(name, "variable");
        member.type = type;
        member.end = end;
        member.section = section;
        member.modifiers = [...sectionModifiers];
        if (address) {
          member.address = address;
        }
        if (initializer) {
          member.initializer = initializer;
        }
        members.push(member);
      }
      if (before === this.cursor) {
        this.take();
      }
    }
    this.expect(endKeyword);
    this.eat(";");
    return members;
  }
  private sections(symbol?: StSymbol) {
    while (variableSections.has(this.peek().upper) || this.at("EXTENDS") || this.at("IMPLEMENTS")) {
      if (this.at("EXTENDS") || this.at("IMPLEMENTS")) {
        const clause = this.take().upper;
        do {
          const type = this.type();
          (clause === "EXTENDS" ? symbol?.bases : symbol?.interfaces)?.push(type);
        } while (this.eat(","));
        continue;
      }
      const section = this.take().upper;
      const mods: string[] = [];
      while (qualifiers.has(this.peek().upper)) {
        mods.push(this.take().upper);
      }
      const variables = this.variables("END_VAR", section, mods);
      (symbol?.members ?? this.file.locals).push(...variables);
    }
  }
  private dut() {
    const start = this.take().start;
    const mods = this.readModifiers();
    const name = this.identifier();
    this.expect(":");
    const symbol = this.symbol(name, "alias", start);
    symbol.modifiers = mods;
    this.file.symbol = symbol;
    if (this.at("STRUCT") || this.at("UNION")) {
      const kind = this.take().upper;
      symbol.kind = kind === "STRUCT" ? "struct" : "union";
      if (this.eat("EXTENDS")) {
        symbol.bases.push(this.type());
      }
      symbol.type = namedType(symbol.name, symbol.nameSpan);
      symbol.members.push(...this.variables(`END_${kind}`, "FIELD"));
    } else if (this.eat("(")) {
      symbol.kind = "enum";
      symbol.type = namedType(symbol.name, symbol.nameSpan);
      while (this.peek().kind !== "eof" && !this.at(")") && !this.at("END_TYPE")) {
        const before = this.cursor;
        const member = this.symbol(this.identifier(), "enumMember");
        member.type = namedType(symbol.name);
        member.section = "ENUM";
        if (this.eat(":=")) {
          member.initializer = this.expression();
        }
        symbol.members.push(member);
        if (!this.eat(",")) {
          break;
        }
        if (this.cursor === before) {
          this.take();
        }
      }
      this.expect(")");
      if (this.peek().kind === "word" && !this.at("END_TYPE")) {
        symbol.bases.push(this.type());
      }
    } else {
      symbol.type = this.type();
    }
    if (this.eat(":=")) {
      symbol.initializer = this.expression();
    }
    this.eat(";");
    symbol.end = this.expect("END_TYPE").end;
    this.eat(";");
  }
  parse(): ParsedFile {
    const first = this.peek();
    const objectKind = objectKinds[first.upper];
    if (this.at("TYPE")) {
      this.dut();
    } else if (objectKind) {
      this.take();
      const mods = this.readModifiers();
      const name = this.identifier();
      const symbol = this.symbol(name, objectKind, first.start);
      symbol.modifiers = mods;
      if (this.eat(":")) {
        symbol.type = this.type();
      }
      this.eat(";");
      this.file.symbol = symbol;
      this.sections(symbol);
      this.file.bodyStart = this.peek().start;
      this.statements(new Set([`END_${first.upper}`]));
      if (
        !this.eat(`END_${first.upper}`) &&
        !/(?:^|\/|\.)declaration\.(?:st|iecst)$/i.test(this.file.document.uri) &&
        !(this.file.statements.length === 0 && ["method", "property"].includes(symbol.kind))
      ) {
        this.error(`Expected END_${first.upper}.`);
      }
      symbol.end = this.peek().start;
      this.eat(";");
    } else if (this.at("VAR_GLOBAL") || this.at("VAR_CONFIG")) {
      const filename = decodeURIComponent(
        this.file.document.uri.split("/").at(-1) ?? "Globals.st",
      ).replace(/\.(?:iecst|st)$/i, "");
      const name = { ...first, text: filename, end: first.start };
      const symbol = this.symbol(name, "gvl");
      symbol.type = namedType(filename);
      this.file.symbol = symbol;
      this.sections(symbol);
      symbol.end = this.peek().start;
    } else {
      this.sections();
      this.file.bodyStart = this.peek().start;
      this.statements(new Set());
    }
    if (this.peek().kind !== "eof") {
      this.error("Unexpected content after the source object. Keep one object per file.");
    }
    for (const pragma of this.file.trivia.filter(
      (t) => t.kind === "pragma" && /^\{\s*(?:IF|ELSIF|ELSE|END_IF)\b/i.test(t.text),
    )) {
      this.file.diagnostics.push(
        diagnostic(
          this.file.document,
          pragma,
          "conditional-compilation",
          "Conditional compilation is not evaluated; all branches are analyzed. Validate the active configuration in CODESYS.",
          2,
        ),
      );
    }
    return this.file;
  }
  private expression(minimum = 0): Expr {
    if (++this.depth > 96) {
      this.depth--;
      this.error("Expression nesting exceeds the editor limit (96).");
      const token = this.take();
      return { kind: "missing", start: token.start, end: token.end };
    }
    let left = this.primary();
    while (this.peek().kind !== "eof") {
      const operator = this.peek();
      const priority = precedence[operator.upper];
      if (priority === undefined || priority < minimum) {
        break;
      }
      this.take();
      const right = this.expression(priority + (operator.upper === "**" ? 0 : 1));
      left = {
        kind: "binary",
        operator,
        left,
        right,
        start: left.start,
        end: right.end,
      };
    }
    this.depth--;
    return left;
  }
  private args(close: string): Argument[] {
    const args: Argument[] = [];
    while (
      this.peek().kind !== "eof" &&
      !this.at(close) &&
      !boundaries.has(this.peek().upper) &&
      !this.at(";")
    ) {
      const before = this.cursor;
      const start = this.peek().start;
      if (this.peek().kind === "word" && [":=", "=>"].includes(this.peek(1).upper)) {
        const name = this.take();
        const direction = this.take().upper === ":=" ? ":=" : "=>";
        const value = this.expression();
        args.push({ name, direction, value, start, end: value.end });
      } else {
        const value = this.expression();
        args.push({ value, start, end: value.end });
      }
      if (before === this.cursor) {
        this.take();
      }
      if (!this.eat(",")) {
        break;
      }
    }
    return args;
  }
  private primary(): Expr {
    const token = this.peek();
    let expr: Expr;
    if (["+", "-", "NOT"].includes(token.upper)) {
      this.take();
      const operand = this.expression(9);
      return {
        kind: "unary",
        operator: token,
        operand,
        start: token.start,
        end: operand.end,
      };
    }
    if (this.eat("(")) {
      const values = this.args(")");
      const end = this.expect(")").end;
      const only = values[0];
      expr =
        values.length === 1 && only && !only.name
          ? { ...only.value, start: token.start, end }
          : { kind: "aggregate", values, start: token.start, end };
    } else if (this.eat("[")) {
      const values = this.args("]");
      expr = {
        kind: "aggregate",
        values,
        start: token.start,
        end: this.expect("]").end,
      };
    } else if (
      ["number", "string", "address"].includes(token.kind) ||
      ["TRUE", "FALSE"].includes(token.upper)
    ) {
      this.take();
      expr = { kind: "literal", token, start: token.start, end: token.end };
    } else if (
      token.kind === "word" &&
      (!keywords.has(token.upper) || ["THIS", "SUPER", "OVERRIDE"].includes(token.upper))
    ) {
      this.take();
      expr = { kind: "name", token, start: token.start, end: token.end };
    } else {
      this.error("Expected an expression.", token);
      return { kind: "missing", start: token.start, end: token.start };
    }
    let chain = 0;
    while (this.peek().kind !== "eof") {
      if (++chain > 256) {
        this.error("Expression chain exceeds the editor limit (256).");
        break;
      }
      if (this.eat(".")) {
        const member = this.peek().kind === "number" ? this.take() : this.identifier();
        expr = {
          kind: "member",
          object: expr,
          member,
          start: expr.start,
          end: member.end,
        };
      } else if (this.eat("[")) {
        const indices = this.args("]").map((arg) => arg.value);
        expr = {
          kind: "index",
          object: expr,
          indices,
          start: expr.start,
          end: this.expect("]").end,
        };
      } else if (this.at("^")) {
        const end = this.take().end;
        expr = { kind: "deref", object: expr, start: expr.start, end };
      } else if (this.eat("(")) {
        const args = this.args(")");
        expr = {
          kind: "call",
          callee: expr,
          args,
          start: expr.start,
          end: this.expect(")").end,
        };
      } else {
        break;
      }
    }
    return expr;
  }
  private statements(stops: Set<string>) {
    if (++this.depth > 96) {
      this.depth--;
      this.error("Statement nesting exceeds the editor limit (96).");
      while (this.peek().kind !== "eof" && !stops.has(this.peek().upper)) {
        this.take();
      }
      return;
    }
    while (this.peek().kind !== "eof" && !stops.has(this.peek().upper)) {
      const before = this.cursor;
      this.statement();
      if (before === this.cursor) {
        this.error(`Unexpected token ${this.take().text}.`);
      }
    }
    this.depth--;
  }
  private condition() {
    const expression = this.expression();
    this.file.statements.push({
      kind: "condition",
      expression,
      start: expression.start,
      end: expression.end,
    });
  }
  private statement() {
    const token = this.peek();
    if (this.eat(";")) {
      return;
    }
    if (this.eat("IF")) {
      this.condition();
      this.expect("THEN");
      this.statements(new Set(["ELSIF", "ELSE", "END_IF"]));
      while (this.eat("ELSIF")) {
        this.condition();
        this.expect("THEN");
        this.statements(new Set(["ELSIF", "ELSE", "END_IF"]));
      }
      if (this.eat("ELSE")) {
        this.statements(new Set(["END_IF"]));
      }
      this.expect("END_IF");
      this.eat(";");
      return;
    }
    if (this.eat("FOR")) {
      const variable = this.expression();
      this.expect(":=");
      const from = this.expression();
      this.expect("TO");
      const to = this.expression();
      const step = this.eat("BY") ? this.expression() : undefined;
      this.file.statements.push({
        kind: "for",
        variable,
        from,
        to,
        ...(step ? { step } : {}),
        start: token.start,
        end: this.peek().start,
      });
      this.expect("DO");
      this.statements(new Set(["END_FOR"]));
      this.expect("END_FOR");
      this.eat(";");
      return;
    }
    if (this.eat("WHILE")) {
      this.condition();
      this.expect("DO");
      this.statements(new Set(["END_WHILE"]));
      this.expect("END_WHILE");
      this.eat(";");
      return;
    }
    if (this.eat("REPEAT")) {
      this.statements(new Set(["UNTIL", "END_REPEAT"]));
      this.expect("UNTIL");
      this.condition();
      this.expect("END_REPEAT");
      this.eat(";");
      return;
    }
    if (this.eat("CASE")) {
      const expression = this.expression();
      this.expect("OF");
      const labels: Expr[] = [];
      while (this.peek().kind !== "eof" && !this.at("END_CASE")) {
        const before = this.cursor;
        if (this.eat("ELSE")) {
          this.statements(new Set(["END_CASE"]));
          break;
        }
        const labelAhead = this.file.tokens
          .slice(this.cursor, this.cursor + 80)
          .find((t) => [":", ";", ":=", "END_CASE"].includes(t.upper));
        if (labelAhead?.upper === ":" && !keywords.has(this.peek().upper)) {
          do {
            labels.push(this.expression());
          } while (this.eat(","));
          this.expect(":");
        } else {
          this.statement();
        }
        if (before === this.cursor) {
          this.take();
        }
      }
      this.expect("END_CASE");
      this.eat(";");
      this.file.statements.push({
        kind: "case",
        expression,
        labels,
        start: token.start,
        end: this.peek().start,
      });
      return;
    }
    if (["RETURN", "CONTINUE", "EXIT"].includes(token.upper)) {
      this.take();
      this.expect(";");
      return;
    }
    const expression = this.expression();
    if ([":=", "REF=", "S=", "R="].includes(this.peek().upper)) {
      const operator = this.take();
      const value = this.expression();
      this.file.statements.push({
        kind: "assign",
        target: expression,
        value,
        operator,
        start: token.start,
        end: value.end,
      });
    } else {
      this.file.statements.push({
        kind: "expression",
        expression,
        start: expression.start,
        end: expression.end,
      });
    }
    if (!this.eat(";") && !boundaries.has(this.peek().upper) && this.peek().kind !== "eof") {
      this.error("Expected ; after statement.");
    }
  }
}

export const parse = (uri: string, text: string, version = 0): ParsedFile =>
  new Parser(uri, text, version).parse();
