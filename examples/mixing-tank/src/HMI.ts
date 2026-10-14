import { defaultValue, type BOOL, type REAL, type UINT } from "@vplc/compiler/types";

export interface HMIImage {
  /** Command to start the mixer */
  MixerRunCmd: BOOL;
  /** Command to stop the mixer */
  MixerStopCmd: BOOL;
  /** Command to open medium 1 valve */
  Medium1OpenCmd: BOOL;
  /** Command to close medium 1 valve */
  Medium1CloseCmd: BOOL;
  /** Command to open medium 2 valve */
  Medium2OpenCmd: BOOL;
  /** Command to close medium 2 valve */
  Medium2CloseCmd: BOOL;
  /** Command to open drain valve */
  DrainOpenCmd: BOOL;
  /** Command to close drain valve */
  DrainCloseCmd: BOOL;
  /** Command to set the system to auto mode */
  SetToAuto: BOOL;
  /** Command to set the system to manual mode */
  SetToManual: BOOL;
  /** HMI Support variables */
  MotorRotating: REAL;
  /** System in AUTO */
  InAuto: BOOL;
  /** System in MANUAL */
  InManual: BOOL;
  /** Cycles completed */
  CyclesCompleted: UINT;
}

export const HMI = defaultValue<HMIImage>();
