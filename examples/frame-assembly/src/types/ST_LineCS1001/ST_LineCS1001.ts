import type { ST_LineCS1001Input } from "./ST_LineCS1001Input.ts";
import type { ST_LineCS1001Output } from "./ST_LineCS1001Output.ts";

/*
DOCUMENTED — auxiliary control signals and feedback for an Intelligrated CS1001 motor-driven roller card.
https://www.scribd.com/document/823553754/MDR-710-With-WWL-Installation-and-Maintenance-Manual
*/
export interface ST_LineCS1001 {
  /* Normalized auxiliary control signals toward one card; mapping handles electrical polarity. */
  Output: ST_LineCS1001Output;
  /* Digital feedback from the CS1001 auxiliary terminals, interpreted using the configured signal polarity. */
  Input: ST_LineCS1001Input;
}
