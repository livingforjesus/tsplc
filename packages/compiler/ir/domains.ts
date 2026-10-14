import type { Constant, Expression } from "./model.ts";
import type { PlcType } from "./types.ts";

export function durationLiteral(text: string, scaleNanoseconds: bigint): Constant | undefined {
  const clean = text.replaceAll("_", "").replace(/^(-?)\./, (_, sign: string) => `${sign}0.`);
  const match = /^(-?)(\d+)(?:\.(\d*))?(?:e([+-]?\d+))?$/i.exec(clean);
  if (!match) return undefined;
  const fraction = match[3] ?? "",
    exponent = Number(match[4] ?? 0) - fraction.length;
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 400) return undefined;
  let value = BigInt(match[2]! + fraction) * scaleNanoseconds;
  if (exponent >= 0) value *= 10n ** BigInt(exponent);
  else {
    const divisor = 10n ** BigInt(-exponent);
    if (value % divisor) return undefined;
    value /= divisor;
  }
  if (match[1]) value = -value;
  return value >= 0n && value <= 4_294_967_295_000_000n && value % 1_000_000n === 0n
    ? { kind: "duration", nanoseconds: String(value) }
    : undefined;
}
function validDate(text: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return false;
  const year = Number(match[1]),
    month = Number(match[2]),
    day = Number(match[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const length = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  return Boolean(
    length && day >= 1 && day <= length && text >= "1970-01-01" && text <= "2106-02-07",
  );
}
function validClock(text: string, milliseconds: boolean): boolean {
  const match = (
    milliseconds ? /^(\d{2}):(\d{2}):(\d{2})\.(\d{3})$/ : /^(\d{2}):(\d{2}):(\d{2})$/
  ).exec(text);
  return Boolean(match && Number(match[1]) < 24 && Number(match[2]) < 60 && Number(match[3]) < 60);
}
export function calendarLiteral(
  domain: Extract<PlcType, { kind: "calendar" }>["domain"],
  text: string,
): Constant | undefined {
  if (domain === "date") return validDate(text) ? { kind: "calendar", value: text } : undefined;
  if (domain === "timeOfDay") {
    const canonical = /^\d{2}:\d{2}:\d{2}$/.test(text) ? `${text}.000` : text;
    return validClock(canonical, true) ? { kind: "calendar", value: canonical } : undefined;
  }
  return text.length === 19 &&
    text[10] === "T" &&
    validDate(text.slice(0, 10)) &&
    validClock(text.slice(11), false) &&
    text <= "2106-02-07T06:28:15"
    ? { kind: "calendar", value: text }
    : undefined;
}
export function domainConstantFits(value: Constant, type: PlcType): boolean {
  if (type.kind === "duration")
    return (
      value.kind === "duration" &&
      /^(?:0|[1-9][0-9]*)$/.test(value.nanoseconds) &&
      BigInt(value.nanoseconds) <= 4_294_967_295_000_000n &&
      BigInt(value.nanoseconds) % 1_000_000n === 0n
    );
  if (type.kind === "calendar" && value.kind === "calendar") {
    const parsed = calendarLiteral(type.domain, value.value);
    return parsed?.kind === "calendar" && parsed.value === value.value;
  }
  return false;
}
export function domainIssue(
  value: Expression,
  types: ReadonlyMap<string, PlcType>,
): string | undefined {
  const type = types.get(value.type);
  if (value.kind === "constant")
    return type && domainConstantFits(value.value, type)
      ? undefined
      : "Invalid TIME/calendar constant.";
  if (value.kind === "load" || value.kind === "call" || value.kind === "conditional")
    return undefined;
  if (
    value.kind === "binary" &&
    ["equal", "notEqual", "less", "lessEqual", "greater", "greaterEqual"].includes(value.operator)
  ) {
    const left = types.get(value.left.type);
    return value.type === "BOOL" &&
      left &&
      ["duration", "calendar"].includes(left.kind) &&
      value.left.type === value.right.type
      ? undefined
      : "Time comparisons require matching domains.";
  }
  return "TIME and calendar domains permit storage, typed copies and comparisons; implicit numeric arithmetic is unsupported.";
}
