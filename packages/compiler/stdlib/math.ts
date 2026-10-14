// PLC implementation source: the frontend specializes these helpers for each
// concrete scalar domain. The release includes this source for that analysis.
export function min<T extends number | bigint>(left: T, right: T): T {
  return left < right ? left : right;
}

export function max<T extends number | bigint>(left: T, right: T): T {
  return left > right ? left : right;
}

export function clamp<T extends number | bigint>(value: T, lower: T, upper: T): T {
  if (value < lower) {
    return lower;
  }
  if (value > upper) {
    return upper;
  }
  return value;
}
