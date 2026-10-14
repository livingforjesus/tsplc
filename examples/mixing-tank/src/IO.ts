import { defaultValue, type BOOL } from "@vplc/compiler/types";

export interface IOImage {
  /** Tank level switch (HIGH) active */
  xDI_LS01_TankLevelFull: BOOL;
  /** Tank level switch (LOW) active */
  xDI_LS02_TankLevelEmpty: BOOL;
  /** Medium 1 filling valve open */
  xDI_VV01_Medium1_Opened: BOOL;
  /** Medium 2 filling valve open */
  xDI_VV02_Medium2_Opened: BOOL;
  /** Tank draining valve open */
  xDI_VV03_TankDrain_Opened: BOOL;
  /** Mixer motor running */
  xDI_M1_MixerMotorRunning: BOOL;
  /** Medium 1 filling valve open command */
  xDO_VV01_Medium1_OpenCmd: BOOL;
  /** Medium 2 filling valve open command */
  xDO_VV02_Medium2_OpenCmd: BOOL;
  /** Tank draining valve open command */
  xDO_VV03_TankDrain_OpenCmd: BOOL;
  /** Mixer motor run command */
  xDO_M1_MixerMotorRunCmd: BOOL;
}

export const IO = defaultValue<IOImage>();
