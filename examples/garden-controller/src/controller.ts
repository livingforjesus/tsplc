import { gIO } from "./gIO.ts";
import * as routes from "./routes.ts";
import {
  garden1AutoWater,
  garden2AutoWater,
  garden3AutoWater,
  garden4AutoWater,
} from "./watering.ts";

// Manual directions mirror the authored physical orientations of each garden.
export function CONTROL_GARDEN1(): void {
  if (gIO.Garden1_HMI.CtrlOn) {
    gIO.Garden1_ServoX_CW =
      gIO.Garden1_HMI.LeftCmd || gIO.Garden1_HMI.LeftDownCmd || gIO.Garden1_HMI.LeftUpCmd;
    gIO.Garden1_ServoX_CCW =
      gIO.Garden1_HMI.RightCmd || gIO.Garden1_HMI.RightDownCmd || gIO.Garden1_HMI.RightUpCmd;
    gIO.Garden1_ServoY_CW =
      gIO.Garden1_HMI.UpCmd || gIO.Garden1_HMI.LeftUpCmd || gIO.Garden1_HMI.RightUpCmd;
    gIO.Garden1_ServoY_CCW =
      gIO.Garden1_HMI.DownCmd || gIO.Garden1_HMI.LeftDownCmd || gIO.Garden1_HMI.RightDownCmd;
    gIO.Garden1_WaterTankOpenCmd = gIO.Garden1_HMI.OpenWaterValve;
  } else {
    garden1AutoWater.update({
      instructions: routes.vG1Platform_Instructions,
      xAxis: gIO.Garden1_ServoX_Offset,
      yAxis: gIO.Garden1_ServoY_Offset,
    });
    gIO.Garden1_ServoX_CW = garden1AutoWater.out.servoX_CW;
    gIO.Garden1_ServoX_CCW = garden1AutoWater.out.servoX_CCW;
    gIO.Garden1_ServoY_CW = garden1AutoWater.out.servoY_CW;
    gIO.Garden1_ServoY_CCW = garden1AutoWater.out.servoY_CCW;
    gIO.Garden1_WaterTankOpenCmd = garden1AutoWater.out.waterTankOpenCmd;
  }
}

export function CONTROL_GARDEN2(): void {
  if (gIO.Garden2_HMI.CtrlOn) {
    gIO.Garden2_ServoX_CCW =
      gIO.Garden2_HMI.LeftCmd || gIO.Garden2_HMI.LeftDownCmd || gIO.Garden2_HMI.LeftUpCmd;
    gIO.Garden2_ServoX_CW =
      gIO.Garden2_HMI.RightCmd || gIO.Garden2_HMI.RightDownCmd || gIO.Garden2_HMI.RightUpCmd;
    gIO.Garden2_ServoY_CW =
      gIO.Garden2_HMI.UpCmd || gIO.Garden2_HMI.LeftUpCmd || gIO.Garden2_HMI.RightUpCmd;
    gIO.Garden2_ServoY_CCW =
      gIO.Garden2_HMI.DownCmd || gIO.Garden2_HMI.LeftDownCmd || gIO.Garden2_HMI.RightDownCmd;
    gIO.Garden2_WaterTankOpenCmd = gIO.Garden2_HMI.OpenWaterValve;
  } else {
    garden2AutoWater.update({
      instructions: routes.vG2Platform_Instructions,
      xAxis: gIO.Garden2_ServoX_Offset,
      yAxis: gIO.Garden2_ServoY_Offset,
    });
    gIO.Garden2_ServoX_CW = garden2AutoWater.out.servoX_CW;
    gIO.Garden2_ServoX_CCW = garden2AutoWater.out.servoX_CCW;
    gIO.Garden2_ServoY_CW = garden2AutoWater.out.servoY_CW;
    gIO.Garden2_ServoY_CCW = garden2AutoWater.out.servoY_CCW;
    gIO.Garden2_WaterTankOpenCmd = garden2AutoWater.out.waterTankOpenCmd;
  }
}

export function CONTROL_GARDEN3(): void {
  if (gIO.Garden3_HMI.CtrlOn) {
    gIO.Garden3_ServoX_CW =
      gIO.Garden3_HMI.LeftCmd || gIO.Garden3_HMI.LeftDownCmd || gIO.Garden3_HMI.LeftUpCmd;
    gIO.Garden3_ServoX_CCW =
      gIO.Garden3_HMI.RightCmd || gIO.Garden3_HMI.RightDownCmd || gIO.Garden3_HMI.RightUpCmd;
    gIO.Garden3_ServoY_CCW =
      gIO.Garden3_HMI.UpCmd || gIO.Garden3_HMI.LeftUpCmd || gIO.Garden3_HMI.RightUpCmd;
    gIO.Garden3_ServoY_CW =
      gIO.Garden3_HMI.DownCmd || gIO.Garden3_HMI.LeftDownCmd || gIO.Garden3_HMI.RightDownCmd;
    gIO.Garden3_WaterTankOpenCmd = gIO.Garden3_HMI.OpenWaterValve;
  } else {
    garden3AutoWater.update({
      instructions: routes.vG3Platform_Instructions,
      xAxis: gIO.Garden3_ServoX_Offset,
      yAxis: gIO.Garden3_ServoY_Offset,
    });
    gIO.Garden3_ServoX_CW = garden3AutoWater.out.servoX_CW;
    gIO.Garden3_ServoX_CCW = garden3AutoWater.out.servoX_CCW;
    gIO.Garden3_ServoY_CW = garden3AutoWater.out.servoY_CW;
    gIO.Garden3_ServoY_CCW = garden3AutoWater.out.servoY_CCW;
    gIO.Garden3_WaterTankOpenCmd = garden3AutoWater.out.waterTankOpenCmd;
  }
}

export function CONTROL_GARDEN4(): void {
  if (gIO.Garden4_HMI.CtrlOn) {
    gIO.Garden4_ServoX_CCW =
      gIO.Garden4_HMI.LeftCmd || gIO.Garden4_HMI.LeftDownCmd || gIO.Garden4_HMI.LeftUpCmd;
    gIO.Garden4_ServoX_CW =
      gIO.Garden4_HMI.RightCmd || gIO.Garden4_HMI.RightDownCmd || gIO.Garden4_HMI.RightUpCmd;
    gIO.Garden4_ServoY_CCW =
      gIO.Garden4_HMI.UpCmd || gIO.Garden4_HMI.LeftUpCmd || gIO.Garden4_HMI.RightUpCmd;
    gIO.Garden4_ServoY_CW =
      gIO.Garden4_HMI.DownCmd || gIO.Garden4_HMI.LeftDownCmd || gIO.Garden4_HMI.RightDownCmd;
    gIO.Garden4_WaterTankOpenCmd = gIO.Garden4_HMI.OpenWaterValve;
  } else {
    garden4AutoWater.update({
      instructions: routes.vG4Platform_Instructions,
      xAxis: gIO.Garden4_ServoX_Offset,
      yAxis: gIO.Garden4_ServoY_Offset,
    });
    gIO.Garden4_ServoX_CW = garden4AutoWater.out.servoX_CW;
    gIO.Garden4_ServoX_CCW = garden4AutoWater.out.servoX_CCW;
    gIO.Garden4_ServoY_CW = garden4AutoWater.out.servoY_CW;
    gIO.Garden4_ServoY_CCW = garden4AutoWater.out.servoY_CCW;
    gIO.Garden4_WaterTankOpenCmd = garden4AutoWater.out.waterTankOpenCmd;
  }
}

export function controller(): void {
  CONTROL_GARDEN1();
  CONTROL_GARDEN2();
  CONTROL_GARDEN3();
  CONTROL_GARDEN4();
}
