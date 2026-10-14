import type { E_LineLiftPosition } from "../E_LineLiftPosition.ts";

export interface ST_LineLiftStatus {
  /* PLC-owned; Unknown while a fresh request is pending, confirmed by endpoint overload. */
  Position: E_LineLiftPosition;
  /* Actual motor feedback, not the Run command. */
  MotorRunning: BOOL;
  /* Current request timed out; a fresh command rearms it. */
  MotionTimedOut: BOOL;
  /* Current request failed; a fresh command retries after raw faults clear. */
  Faulted: BOOL;
}
