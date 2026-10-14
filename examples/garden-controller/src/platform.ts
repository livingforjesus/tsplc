import {
  type BOOL,
  type DINT,
  exact,
  type INT,
  wrap,
  wrapAdd,
  wrapSubtract,
} from "@vplc/compiler/types";

export function moveAxis(
  position: INT,
  counterClockwise: BOOL,
  clockwise: BOOL,
  counterClockwiseStep: INT,
  minimum: INT,
  maximum: INT,
): INT {
  let next: INT = position;
  // CCW has priority if both commands are true. Store to INT before LIMIT.
  if (counterClockwise) next = wrapAdd<INT>(next, counterClockwiseStep);
  else if (clockwise) next = wrapSubtract<INT>(next, counterClockwiseStep);
  if (next < minimum) next = minimum;
  else if (next > maximum) next = maximum;
  return next;
}

export function absoluteOffset(value: INT): INT {
  // ABS uses a wide temporary, then the original INT feedback assignment wraps.
  if (value < 0) return wrap<INT>(0 - exact<DINT>(value));
  return value;
}
