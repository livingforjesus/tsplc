import type { E_LineState } from "./E_LineState.ts";
import type { ST_Recipe } from "./ST_Recipe.ts";

/* Operator-facing line status. */
export interface ST_LineStatus {
  State: E_LineState;
  Message: STRING<40>;
  /* Recipe latched from the selector while the line was stopped. */
  Recipe: ST_Recipe;
  /* Rejected bottles, clipped to the HMI's 16-bit counter. */
  RejectsShown: UINT;
}
