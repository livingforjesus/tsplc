/** Bit widths of the fixed-size IEC elementary types, as laid out in direct-address process images. */
export const iecTypeBits: Readonly<Record<string, number>> = {
  BOOL: 1,
  SINT: 8,
  USINT: 8,
  BYTE: 8,
  INT: 16,
  UINT: 16,
  WORD: 16,
  DINT: 32,
  UDINT: 32,
  DWORD: 32,
  REAL: 32,
  LINT: 64,
  ULINT: 64,
  LWORD: 64,
  LREAL: 64,
};

/** Evaluate the integer-expression subset used for array bounds and constants. Never executes PLC text. */
export function integerExpression(text: string, lookup: (name: string) => number): number {
  const compact = text.replace(/\s+/g, "");
  const tokens = (
    text.match(
      /(?:U?S?INT|U?DINT|U?LINT|BYTE|WORD|DWORD|LWORD)\s*#\s*[+-]?(?:(?:2|8|16)#[\da-fA-F_]+|\d[\d_]*)|(?:2|8|16)#[\da-fA-F_]+|\d[\d_]*|[A-Za-z_]\w*(?:\s*\.\s*[A-Za-z_]\w*)?|[()+\-*/]/g,
    ) ?? []
  ).map((token) => token.replace(/\s+/g, ""));
  if (tokens.join("") !== compact || !tokens.length)
    throw new Error(`unsupported integer expression: ${text}`);
  let position = 0;
  function atom(): number {
    const token = tokens[position++];
    if (token === "+") return atom();
    if (token === "-") return -atom();
    if (token === "(") {
      const value = sum();
      if (tokens[position++] !== ")") throw new Error(`unclosed integer expression: ${text}`);
      return value;
    }
    const typed = token && /^(U?S?INT|U?DINT|U?LINT|BYTE|WORD|DWORD|LWORD)#(.*)$/i.exec(token);
    if (typed) {
      const value = integerExpression(typed[2]!, lookup);
      const name = typed[1]!.toUpperCase(),
        bits = iecTypeBits[name]!;
      const signed = ["SINT", "INT", "DINT", "LINT"].includes(name);
      const limit = 1n << BigInt(bits - (signed ? 1 : 0));
      if (BigInt(value) < (signed ? -limit : 0n) || BigInt(value) >= limit)
        throw new Error(`typed integer outside ${name}: ${token}`);
      return value;
    }
    if (token && /^\d/.test(token)) {
      const [base, digits] = token.replace(/_/g, "").split("#");
      if (digits !== undefined && ![...digits].every((digit) => parseInt(digit, 16) < Number(base)))
        throw new Error(`invalid base-${base} literal: ${token}`);
      const value = digits === undefined ? Number(base) : parseInt(digits, Number(base));
      if (!Number.isSafeInteger(value))
        throw new Error(`integer outside JavaScript's safe range: ${text}`);
      return value;
    }
    if (token && /^[A-Za-z_]/.test(token)) return lookup(token);
    throw new Error(`invalid integer expression: ${text}`);
  }
  function product(): number {
    let value = atom();
    while (tokens[position] === "*" || tokens[position] === "/") {
      const operator = tokens[position++];
      const right = atom();
      if (operator === "/" && right === 0) throw new Error(`division by zero: ${text}`);
      value = operator === "*" ? value * right : Math.trunc(value / right);
      if (!Number.isSafeInteger(value))
        throw new Error(`integer outside JavaScript's safe range: ${text}`);
    }
    return value;
  }
  function sum(): number {
    let value = product();
    while (tokens[position] === "+" || tokens[position] === "-") {
      const operator = tokens[position++];
      const right = product();
      value = operator === "+" ? value + right : value - right;
      if (!Number.isSafeInteger(value))
        throw new Error(`integer outside JavaScript's safe range: ${text}`);
    }
    return value;
  }
  const value = sum();
  if (position !== tokens.length || !Number.isSafeInteger(value))
    throw new Error(`invalid or unsafe integer expression: ${text}`);
  return value;
}
