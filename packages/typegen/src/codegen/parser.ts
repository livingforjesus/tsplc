export interface Source {
  name: string;
  text: string;
}

export type TypeReference =
  | { kind: "named"; name: string }
  | { kind: "string"; name: "STRING" | "WSTRING"; length: string }
  | {
      kind: "array";
      dimensions: Array<{ lower: string; upper: string }>;
      element: TypeReference;
    };

export interface Member {
  name: string;
  description: string;
  type: TypeReference;
  initial?: string;
  /** A CODESYS symbol attribute explicitly publishes this global for clients. */
  published?: boolean;
}

export type Declaration = {
  name: string;
  description: string;
  source: string;
} & (
  | { kind: "struct"; members: Member[] }
  | { kind: "alias"; type: TypeReference }
  | {
      kind: "enum";
      members: Array<{ name: string; value?: string }>;
      base: string;
    }
);

export interface GlobalList {
  name: string;
  description: string;
  source: string;
  constant: boolean;
  members: Member[];
}

interface Token {
  text: string;
  offset: number;
  kind: "code" | "comment" | "attribute";
}

function tokenize(source: Source): Token[] {
  const tokens: Token[] = [];
  let offset = 0;
  while (offset < source.text.length) {
    const rest = source.text.slice(offset);
    const whitespace = /^\s+/.exec(rest);
    if (whitespace) {
      offset += whitespace[0].length;
      continue;
    }
    if (rest.startsWith("(*")) {
      const start = offset;
      let depth = 1;
      offset += 2;
      while (depth && offset < source.text.length) {
        const pair = source.text.slice(offset, offset + 2);
        if (pair === "(*" || pair === "*)") {
          depth += pair === "(*" ? 1 : -1;
          offset += 2;
        } else offset++;
      }
      if (depth) throw new Error(`${source.name}: unterminated comment`);
      tokens.push({
        text: source.text.slice(start + 2, offset - 2).trim(),
        offset: start,
        kind: "comment",
      });
      continue;
    }
    const comment = /^\/\/[^\r\n]*/.exec(rest);
    if (comment) {
      tokens.push({
        text: comment[0].slice(2).trim(),
        offset,
        kind: "comment",
      });
      offset += comment[0].length;
      continue;
    }
    const attribute = /^\{(?:[^}'"]|'(?:\$[\s\S]|''|[^'])*'|"(?:\$[\s\S]|""|[^"])*")*\}/.exec(rest);
    if (attribute) {
      tokens.push({ text: attribute[0], offset, kind: "attribute" });
      offset += attribute[0].length;
      continue;
    }
    const code =
      /^(?:%[IQM](?:[XBWDL])?(?:\d+(?:\.\d+)*|\*)|'(?:\$[\s\S]|''|[^'])*'|"(?:\$[\s\S]|""|[^"])*"|\d[\d_]*#[\da-fA-F_]+|\d[\d_]*(?:\.(?!\.)[\d_]+)?(?:[eE][+-]?\d+)?|[A-Za-z_]\w*|:=|\.\.|[[\]():;,.+\-*/#])/i.exec(
        rest,
      );
    if (!code)
      throw new Error(
        `${source.name}:${source.text.slice(0, offset).split("\n").length}: unsupported token ${JSON.stringify(rest.slice(0, 24))}`,
      );
    tokens.push({ text: code[0], offset, kind: "code" });
    offset += code[0].length;
  }
  return tokens;
}

class Parser {
  private position = 0;
  private readonly tokens: Token[];
  constructor(private readonly source: Source) {
    this.tokens = tokenize(source);
  }

  private nextIndex(): number {
    let index = this.position;
    while (this.tokens[index] && this.tokens[index]!.kind !== "code") index++;
    return index;
  }

  peek(): string {
    return this.tokens[this.nextIndex()]?.text.toUpperCase() ?? "";
  }

  error(message: string): never {
    const offset = this.tokens[this.nextIndex()]?.offset ?? this.source.text.length;
    throw new Error(
      `${this.source.name}:${this.source.text.slice(0, offset).split("\n").length}: ${message}`,
    );
  }

  private take(): string {
    this.position = this.nextIndex();
    const token = this.tokens[this.position++];
    if (!token) this.error("unexpected end of declaration");
    return token.text;
  }

  private accept(value: string): boolean {
    if (this.peek() !== value) return false;
    this.take();
    return true;
  }

  private expect(value: string): void {
    if (!this.accept(value)) this.error(`expected ${value}, found ${this.peek() || "end of file"}`);
  }

  private identifier(): string {
    const name = this.take();
    if (!/^[A-Za-z_]\w*$/.test(name)) this.error(`expected identifier, found ${name}`);
    return name;
  }

  private documentation(): string {
    const end = this.nextIndex();
    const text = this.tokens
      .slice(this.position, end)
      .filter((token) => token.kind === "comment")
      .map((token) => token.text)
      .join("\n");
    this.position = end;
    return text;
  }

  private expression(stops: string[]): string {
    const values: string[] = [];
    const closing: string[] = [];
    while (this.peek() && (closing.length || !stops.includes(this.peek()))) {
      const token = this.take();
      if (token === "(" || token === "[") closing.push(token === "(" ? ")" : "]");
      if (token === ")" || token === "]") {
        if (closing.pop() !== token) this.error(`unmatched ${token}`);
      }
      values.push(token);
    }
    if (!values.length || closing.length) this.error("incomplete expression");
    return values.join(" ");
  }

  private reference(): TypeReference {
    if (this.accept("ARRAY")) {
      this.expect("[");
      const dimensions: Array<{ lower: string; upper: string }> = [];
      do {
        const lower = this.expression([".."]);
        this.expect("..");
        const upper = this.expression([",", "]"]);
        dimensions.push({ lower, upper });
      } while (this.accept(","));
      this.expect("]");
      this.expect("OF");
      return { kind: "array", dimensions, element: this.reference() };
    }
    const name = this.identifier();
    const upper = name.toUpperCase();
    if (upper === "STRING" || upper === "WSTRING") {
      const opening = this.peek();
      if (opening !== "(" && opening !== "[") return { kind: "string", name: upper, length: "80" };
      this.take();
      const closing = opening === "(" ? ")" : "]";
      const length = this.expression([closing]);
      this.expect(closing);
      return { kind: "string", name: upper, length };
    }
    return { kind: "named", name };
  }

  private members(end: string): Member[] {
    const members: Member[] = [];
    while (this.peek() !== end) {
      const published = this.tokens
        .slice(this.position, this.nextIndex())
        .some(
          (token) =>
            token.kind === "attribute" &&
            /^\{\s*attribute\s+'symbol'\s*:=\s*'(?:read|write|readwrite)'\s*\}$/i.test(token.text),
        );
      const description = this.documentation();
      const names = [this.identifier()];
      while (this.accept(",")) names.push(this.identifier());
      if (this.accept("AT")) {
        // Location belongs to the hardware/build mapping; it does not alter the
        // scalar type that application consumers receive from type generation.
        const address = this.take();
        if (!/^%[IQM](?:[XBWDL])?(?:\d+(?:\.\d+)*|\*)$/i.test(address))
          this.error(`expected direct address after AT, found ${address}`);
      }
      this.expect(":");
      const type = this.reference();
      const initial = this.accept(":=") ? this.expression([";"]) : undefined;
      this.expect(";");
      for (const name of names) {
        if (members.some((member) => member.name.toUpperCase() === name.toUpperCase()))
          this.error(`duplicate member ${name}`);
        members.push({
          name,
          description,
          type,
          ...(initial === undefined ? {} : { initial }),
          ...(published ? { published: true } : {}),
        });
      }
    }
    this.expect(end);
    return members;
  }

  declarations(): Declaration[] {
    const declarations: Declaration[] = [];
    while (this.peek()) {
      const description = this.documentation();
      this.expect("TYPE");
      const name = this.identifier();
      this.expect(":");
      const common = { name, description, source: this.source.name };
      if (this.accept("STRUCT")) {
        declarations.push({
          ...common,
          kind: "struct",
          members: this.members("END_STRUCT"),
        });
        this.accept(";");
      } else if (this.accept("(")) {
        const members: Array<{ name: string; value?: string }> = [];
        do {
          const member = this.identifier();
          const value = this.accept(":=") ? this.expression([",", ")"]) : undefined;
          if (members.some((item) => item.name.toUpperCase() === member.toUpperCase()))
            this.error(`duplicate enum member ${member}`);
          members.push({ name: member, value });
        } while (this.accept(",") && this.peek() !== ")");
        this.expect(")");
        const base = this.peek() === ";" ? "INT" : this.identifier().toUpperCase();
        this.expect(";");
        declarations.push({ ...common, kind: "enum", members, base });
      } else {
        const type = this.reference();
        this.expect(";");
        declarations.push({ ...common, kind: "alias", type });
      }
      this.expect("END_TYPE");
      this.accept(";");
    }
    if (!declarations.length) this.error("no TYPE declarations found");
    return declarations;
  }

  globals(name: string): GlobalList {
    const description = this.documentation();
    this.expect("VAR_GLOBAL");
    let constant = false;
    const qualifiers = new Set<string>();
    while (["CONSTANT", "RETAIN", "PERSISTENT"].includes(this.peek())) {
      const qualifier = this.take().toUpperCase();
      if (qualifiers.has(qualifier)) this.error(`duplicate ${qualifier} qualifier`);
      qualifiers.add(qualifier);
      if (qualifier === "CONSTANT") constant = true;
    }
    const members = this.members("END_VAR");
    this.accept(";");
    if (this.peek()) this.error("only one VAR_GLOBAL block per file is supported");
    return { name, description, source: this.source.name, constant, members };
  }
}

export function parseDeclarations(source: Source): Declaration[] {
  return new Parser(source).declarations();
}

export function parseGlobals(source: Source, name: string): GlobalList {
  return new Parser(source).globals(name);
}
