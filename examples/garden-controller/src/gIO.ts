import type { BOOL, INT } from "@vplc/compiler/types";
import type { HMI_Cmds_typ } from "./types.ts";

export interface GardenIO {
  Garden1_ServoX_CW: BOOL;
  Garden1_ServoX_CCW: BOOL;
  Garden1_ServoY_CW: BOOL;
  Garden1_ServoY_CCW: BOOL;
  Garden1_WaterTankOpenCmd: BOOL;
  Garden2_ServoX_CW: BOOL;
  Garden2_ServoX_CCW: BOOL;
  Garden2_ServoY_CW: BOOL;
  Garden2_ServoY_CCW: BOOL;
  Garden2_WaterTankOpenCmd: BOOL;
  Garden3_ServoX_CW: BOOL;
  Garden3_ServoX_CCW: BOOL;
  Garden3_ServoY_CW: BOOL;
  Garden3_ServoY_CCW: BOOL;
  Garden3_WaterTankOpenCmd: BOOL;
  Garden4_ServoX_CW: BOOL;
  Garden4_ServoX_CCW: BOOL;
  Garden4_ServoY_CW: BOOL;
  Garden4_ServoY_CCW: BOOL;
  Garden4_WaterTankOpenCmd: BOOL;
  Garden1_ServoX_Offset: INT;
  Garden1_ServoY_Offset: INT;
  Garden2_ServoX_Offset: INT;
  Garden2_ServoY_Offset: INT;
  Garden3_ServoX_Offset: INT;
  Garden3_ServoY_Offset: INT;
  Garden4_ServoX_Offset: INT;
  Garden4_ServoY_Offset: INT;
  Garden1_HMI: HMI_Cmds_typ;
  Garden2_HMI: HMI_Cmds_typ;
  Garden3_HMI: HMI_Cmds_typ;
  Garden4_HMI: HMI_Cmds_typ;
}

// HMI CtrlOn inherits TRUE from the original DUT initializer.
export const gIO: GardenIO = {
  Garden1_ServoX_CW: false,
  Garden1_ServoX_CCW: false,
  Garden1_ServoY_CW: false,
  Garden1_ServoY_CCW: false,
  Garden1_WaterTankOpenCmd: false,
  Garden2_ServoX_CW: false,
  Garden2_ServoX_CCW: false,
  Garden2_ServoY_CW: false,
  Garden2_ServoY_CCW: false,
  Garden2_WaterTankOpenCmd: false,
  Garden3_ServoX_CW: false,
  Garden3_ServoX_CCW: false,
  Garden3_ServoY_CW: false,
  Garden3_ServoY_CCW: false,
  Garden3_WaterTankOpenCmd: false,
  Garden4_ServoX_CW: false,
  Garden4_ServoX_CCW: false,
  Garden4_ServoY_CW: false,
  Garden4_ServoY_CCW: false,
  Garden4_WaterTankOpenCmd: false,
  Garden1_ServoX_Offset: 0,
  Garden1_ServoY_Offset: 0,
  Garden2_ServoX_Offset: 0,
  Garden2_ServoY_Offset: 0,
  Garden3_ServoX_Offset: 0,
  Garden3_ServoY_Offset: 0,
  Garden4_ServoX_Offset: 0,
  Garden4_ServoY_Offset: 0,
  Garden1_HMI: {
    CtrlOn: true,
    UpCmd: false,
    DownCmd: false,
    LeftCmd: false,
    RightCmd: false,
    LeftUpCmd: false,
    RightUpCmd: false,
    LeftDownCmd: false,
    RightDownCmd: false,
    OpenWaterValve: false,
  },
  Garden2_HMI: {
    CtrlOn: true,
    UpCmd: false,
    DownCmd: false,
    LeftCmd: false,
    RightCmd: false,
    LeftUpCmd: false,
    RightUpCmd: false,
    LeftDownCmd: false,
    RightDownCmd: false,
    OpenWaterValve: false,
  },
  Garden3_HMI: {
    CtrlOn: true,
    UpCmd: false,
    DownCmd: false,
    LeftCmd: false,
    RightCmd: false,
    LeftUpCmd: false,
    RightUpCmd: false,
    LeftDownCmd: false,
    RightDownCmd: false,
    OpenWaterValve: false,
  },
  Garden4_HMI: {
    CtrlOn: true,
    UpCmd: false,
    DownCmd: false,
    LeftCmd: false,
    RightCmd: false,
    LeftUpCmd: false,
    RightUpCmd: false,
    LeftDownCmd: false,
    RightDownCmd: false,
    OpenWaterValve: false,
  },
};
