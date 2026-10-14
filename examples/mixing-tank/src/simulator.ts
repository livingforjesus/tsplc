import { exact, saturate, seconds, type LREAL, type REAL } from "@vplc/compiler/types";
import { GenericBistableDeviceModel } from "./device-model.ts";
import { IO } from "./IO.ts";

export const MixerMotor = new GenericBistableDeviceModel();
export const MediumValve1 = new GenericBistableDeviceModel();
export const MediumValve2 = new GenericBistableDeviceModel();
export const DrainValve = new GenericBistableDeviceModel();
export const simulatorState: { vTankLevel: REAL; vMotorRotating: REAL } = {
  vTankLevel: 25,
  vMotorRotating: 0,
};

export function simulator(): void {
  MixerMotor.update({
    ActivateCmd: IO.xDO_M1_MixerMotorRunCmd,
    DeactivateCmd: !IO.xDO_M1_MixerMotorRunCmd,
    cfgActTime: seconds(2),
    cfgDeactTime: seconds(0),
    simActFail: false,
    simDeactFail: false,
  });
  IO.xDI_M1_MixerMotorRunning = MixerMotor.out.Activated;

  MediumValve1.update({
    ActivateCmd: IO.xDO_VV01_Medium1_OpenCmd,
    DeactivateCmd: !IO.xDO_VV01_Medium1_OpenCmd,
    cfgActTime: seconds(1),
    cfgDeactTime: seconds(1),
    simActFail: false,
    simDeactFail: false,
  });
  IO.xDI_VV01_Medium1_Opened = MediumValve1.out.Activated;

  MediumValve2.update({
    ActivateCmd: IO.xDO_VV02_Medium2_OpenCmd,
    DeactivateCmd: !IO.xDO_VV02_Medium2_OpenCmd,
    cfgActTime: seconds(1),
    cfgDeactTime: seconds(1),
    simActFail: false,
    simDeactFail: false,
  });
  IO.xDI_VV02_Medium2_Opened = MediumValve2.out.Activated;

  DrainValve.update({
    ActivateCmd: IO.xDO_VV03_TankDrain_OpenCmd,
    DeactivateCmd: !IO.xDO_VV03_TankDrain_OpenCmd,
    cfgActTime: seconds(1),
    cfgDeactTime: seconds(1),
    simActFail: false,
    simDeactFail: false,
  });
  IO.xDI_VV03_TankDrain_Opened = DrainValve.out.Activated;

  // Untyped decimal coefficients promote the original expression to LREAL.
  // Keep each ordered operation wide, then round once at the REAL assignment.
  let tankLevel: LREAL = exact<LREAL>(simulatorState.vTankLevel);
  if (MediumValve1.out.Activated) tankLevel = tankLevel + 0.1;
  else tankLevel = tankLevel + 0.0;
  if (MediumValve2.out.Activated) tankLevel = tankLevel + 0.1;
  else tankLevel = tankLevel + 0.0;
  if (DrainValve.out.Activated) tankLevel = tankLevel - 0.2;
  else tankLevel = tankLevel - 0.0;
  simulatorState.vTankLevel = saturate<REAL>(tankLevel);

  if (simulatorState.vTankLevel < 0) simulatorState.vTankLevel = 0;
  else if (simulatorState.vTankLevel > 100) simulatorState.vTankLevel = 100;

  IO.xDI_LS01_TankLevelFull = simulatorState.vTankLevel >= 85;
  IO.xDI_LS02_TankLevelEmpty = simulatorState.vTankLevel <= 5;

  if (MixerMotor.out.Activated) simulatorState.vMotorRotating = simulatorState.vMotorRotating + 1.0;
  else simulatorState.vMotorRotating = simulatorState.vMotorRotating + 0.0;
  if (simulatorState.vMotorRotating >= 360) simulatorState.vMotorRotating = 0;
}
