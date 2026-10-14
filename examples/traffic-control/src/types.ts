import type { BOOL, INT, UINT } from "@vplc/compiler/types";

export interface SpriteDef_typ {
  x: INT;
  y: INT;
  speed: INT;
  width: INT;
  height: INT;
  screenWidth: INT;
  screenHeight: INT;
}

export interface trafficLightCars {
  RedLamp: BOOL;
  YellowLamp: BOOL;
  GreenLamp: BOOL;
}

export interface trafficLightPed {
  RedLight: BOOL;
  GreenLight: BOOL;
  TimeToSequenceChange: UINT;
}
