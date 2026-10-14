import type { BOOL, BYTE, DWORD, FixedArray, INT, REAL } from "@vplc/compiler/types";

export interface Flower_typ {
  x: INT;
  y: INT;
  alpha: BYTE;
  red: BYTE;
  green: BYTE;
  blue: BYTE;
  color: DWORD;
  hum: REAL;
  alive: BOOL;
}

export interface Platform_typ {
  x: INT;
  y: INT;
  OpenValveCmd: BOOL;
}

export interface HMI_Cmds_typ {
  CtrlOn: BOOL;
  UpCmd: BOOL;
  DownCmd: BOOL;
  LeftCmd: BOOL;
  RightCmd: BOOL;
  LeftUpCmd: BOOL;
  RightUpCmd: BOOL;
  LeftDownCmd: BOOL;
  RightDownCmd: BOOL;
  OpenWaterValve: BOOL;
}

export type WateringRoute = FixedArray<FixedArray<INT, 2>, 25>;
