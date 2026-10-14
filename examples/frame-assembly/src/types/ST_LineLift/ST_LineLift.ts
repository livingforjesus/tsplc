import type { E_LineLiftCommand } from "../E_LineLiftCommand.ts";
import type { ST_LineLiftInput } from "./ST_LineLiftInput.ts";
import type { ST_LineLiftOutput } from "./ST_LineLiftOutput.ts";
import type { ST_LineLiftStatus } from "./ST_LineLiftStatus.ts";

/* Device boundary shared by simulation and production; see lifts/README.md. */
export interface ST_LineLift {
  Input: ST_LineLiftInput;
  Output: ST_LineLiftOutput;
  Status: ST_LineLiftStatus;
  Command: E_LineLiftCommand;
}
