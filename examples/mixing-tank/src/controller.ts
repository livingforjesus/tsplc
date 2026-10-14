import { seconds, TON, wrapAdd, type UINT } from "@vplc/compiler/types";
import { HMI } from "./HMI.ts";
import { IO } from "./IO.ts";
import { AUTO_SEQUENCE, MODES } from "./types.ts";

export const controllerState: {
  vMode: MODES;
  vModeOld: MODES;
  vAutoState: AUTO_SEQUENCE;
} = {
  vMode: MODES.MANUAL,
  vModeOld: MODES.MANUAL,
  vAutoState: AUTO_SEQUENCE.DRAINING,
};
export const MixingTimer = new TON();

export function controller(): void {
  // Only the request for leaving the current mode is consumed.
  switch (controllerState.vMode) {
    case MODES.AUTO:
      if (HMI.SetToManual) {
        controllerState.vMode = MODES.MANUAL;
        HMI.SetToManual = false;
      }
      break;
    case MODES.MANUAL:
      if (HMI.SetToAuto) {
        controllerState.vMode = MODES.AUTO;
        HMI.SetToAuto = false;
      }
      break;
  }

  switch (controllerState.vMode) {
    case MODES.MANUAL:
      if (controllerState.vMode !== controllerState.vModeOld) {
        controllerState.vAutoState = AUTO_SEQUENCE.DRAINING;
        controllerState.vModeOld = controllerState.vMode;
      }

      // Manual commands latch through feedback; close/stop always wins.
      // The authored manual mode deliberately has no overfill interlock.
      IO.xDO_M1_MixerMotorRunCmd =
        (HMI.MixerRunCmd || IO.xDI_M1_MixerMotorRunning) && !HMI.MixerStopCmd;
      IO.xDO_VV01_Medium1_OpenCmd =
        (HMI.Medium1OpenCmd || IO.xDI_VV01_Medium1_Opened) && !HMI.Medium1CloseCmd;
      IO.xDO_VV02_Medium2_OpenCmd =
        (HMI.Medium2OpenCmd || IO.xDI_VV02_Medium2_Opened) && !HMI.Medium2CloseCmd;
      IO.xDO_VV03_TankDrain_OpenCmd =
        (HMI.DrainOpenCmd || IO.xDI_VV03_TankDrain_Opened) && !HMI.DrainCloseCmd;
      break;

    case MODES.AUTO:
      if (controllerState.vMode !== controllerState.vModeOld) {
        controllerState.vAutoState = AUTO_SEQUENCE.DRAINING;
        controllerState.vModeOld = controllerState.vMode;
      }
      switch (controllerState.vAutoState) {
        case AUTO_SEQUENCE.FILLING:
          IO.xDO_M1_MixerMotorRunCmd = false;
          IO.xDO_VV03_TankDrain_OpenCmd = false;
          IO.xDO_VV01_Medium1_OpenCmd = !IO.xDI_LS01_TankLevelFull;
          IO.xDO_VV02_Medium2_OpenCmd = !IO.xDI_LS01_TankLevelFull;

          // Wait for both filling valves to close after the high level switch.
          if (
            IO.xDI_LS01_TankLevelFull &&
            !(IO.xDI_VV01_Medium1_Opened || IO.xDI_VV02_Medium2_Opened)
          ) {
            controllerState.vAutoState = AUTO_SEQUENCE.MIXING;
          }
          break;

        case AUTO_SEQUENCE.MIXING:
          IO.xDO_VV01_Medium1_OpenCmd = false;
          IO.xDO_VV02_Medium2_OpenCmd = false;
          IO.xDO_VV03_TankDrain_OpenCmd = false;
          IO.xDO_M1_MixerMotorRunCmd = true;
          MixingTimer.update({ IN: IO.xDI_M1_MixerMotorRunning, PT: seconds(10) });
          if (MixingTimer.out.Q) {
            IO.xDO_M1_MixerMotorRunCmd = false;
            controllerState.vAutoState = AUTO_SEQUENCE.DRAINING;
          }
          break;

        case AUTO_SEQUENCE.DRAINING:
          IO.xDO_M1_MixerMotorRunCmd = false;
          IO.xDO_VV01_Medium1_OpenCmd = false;
          IO.xDO_VV02_Medium2_OpenCmd = false;
          IO.xDO_VV03_TankDrain_OpenCmd = !IO.xDI_LS02_TankLevelEmpty;
          if (IO.xDI_LS02_TankLevelEmpty && !IO.xDI_VV03_TankDrain_Opened) {
            controllerState.vAutoState = AUTO_SEQUENCE.FILLING;
            HMI.CyclesCompleted = wrapAdd<UINT>(HMI.CyclesCompleted, 1);
          }
          break;
      }
      break;
  }

  // A request clears only once its corresponding feedback confirms it.
  if (IO.xDI_M1_MixerMotorRunning) HMI.MixerRunCmd = false;
  else HMI.MixerStopCmd = false;
  if (IO.xDI_VV01_Medium1_Opened) HMI.Medium1OpenCmd = false;
  else HMI.Medium1CloseCmd = false;
  if (IO.xDI_VV02_Medium2_Opened) HMI.Medium2OpenCmd = false;
  else HMI.Medium2CloseCmd = false;
  if (IO.xDI_VV03_TankDrain_Opened) HMI.DrainOpenCmd = false;
  else HMI.DrainCloseCmd = false;

  // Retain arithmetic with zero as well as the per-operation REAL rounding.
  if (IO.xDI_M1_MixerMotorRunning) HMI.MotorRotating = HMI.MotorRotating + 2.0;
  else HMI.MotorRotating = HMI.MotorRotating + 0.0;
  if (HMI.MotorRotating >= 360) HMI.MotorRotating = 0;
  HMI.InAuto = controllerState.vMode === MODES.AUTO;
  HMI.InManual = controllerState.vMode === MODES.MANUAL;
}
