import { BLINK, defaultValue, type BOOL, type INT, type STRING } from "@vplc/compiler/types";
import type { TrafficIO } from "./gIO.ts";

// The simulator lamps are a held image, distinct from the controller's gIO image.
export const lights = defaultValue<TrafficIO>();
export const state: {
  vCollision: BOOL;
  vDangerousCombination: BOOL;
  vPoliceControl: BOOL;
  vCrashFlagX: INT;
  vCrashFlagY: INT;
  vFaultReason: STRING<255>;
} = {
  vCollision: false,
  vDangerousCombination: false,
  vPoliceControl: false,
  vCrashFlagX: -200,
  vCrashFlagY: -200,
  vFaultReason: "",
};

// One shared native phase drives the simulator's danger and police lamps.
export const blinker = new BLINK();
