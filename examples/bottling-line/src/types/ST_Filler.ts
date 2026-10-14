import type { E_FillerStep } from "./E_FillerStep.ts";
import type { ST_Valve } from "./ST_Valve.ts";

/* A four-head filler. Valves are numbered 1..4 like the heads on the machine. */
export interface ST_Filler {
  /* All four bottles are under the heads (remote IO input). */
  BottlesInPlace: BOOL;
  /* Stop gate that holds bottles under the heads (remote IO output). */
  GateClosed: BOOL;
  Valves: FixedArray<ST_Valve, 4, 1>;
  Step: E_FillerStep;
}
