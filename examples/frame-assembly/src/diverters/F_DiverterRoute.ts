import * as LineConstants from "../globals/LineConstants.ts";

export function F_DiverterRoute(LeftMatches: BOOL, RightMatches: BOOL): INT {
  if (LeftMatches) return LineConstants.RouteLeft;
  if (RightMatches) return LineConstants.RouteRight;
  return LineConstants.RouteThrough;
}
