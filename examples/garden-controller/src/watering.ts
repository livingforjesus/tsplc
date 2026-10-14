import {
  type BOOL,
  FunctionBlock,
  type INT,
  seconds,
  TON,
  type UINT,
  wrapAdd,
} from "@vplc/compiler/types";
import type { WateringRoute } from "./types.ts";

interface WateringInputs {
  instructions: WateringRoute;
  xAxis: INT;
  yAxis: INT;
}
interface WateringOutputs {
  servoX_CW: BOOL;
  servoX_CCW: BOOL;
  servoY_CW: BOOL;
  servoY_CCW: BOOL;
  waterTankOpenCmd: BOOL;
}

export class AutomaticFlowerWatering extends FunctionBlock<WateringInputs, WateringOutputs> {
  private i: UINT = 0;
  private waterTankOpenCmd: BOOL = false;
  private WateringTimer = new TON();

  protected execute(input: WateringInputs): WateringOutputs {
    // Valid execution keeps i in 0..24. Recover a corrupted index before lookup;
    // a bounded lookup keeps all array accesses statically proved.
    if (this.i >= 25) this.i = 0;
    let vXAxisCmd: INT = 0;
    let vYAxisCmd: INT = 0;
    for (let routeIndex: UINT = 0; routeIndex < 25; routeIndex++) {
      if (routeIndex === this.i) {
        vXAxisCmd = input.instructions[routeIndex][0];
        vYAxisCmd = input.instructions[routeIndex][1];
      }
    }
    const vPlatformAtTarget: BOOL = input.xAxis === vXAxisCmd && input.yAxis === vYAxisCmd;

    if (vPlatformAtTarget) {
      this.WateringTimer.update({ IN: true, PT: seconds(1) });
      this.waterTankOpenCmd = true;
      if (this.WateringTimer.out.Q) {
        this.WateringTimer.update({ IN: false, PT: seconds(1) });
        this.waterTankOpenCmd = false;
        this.i = wrapAdd<UINT>(this.i, 1);
      }
    }
    if (this.i === 25) this.i = 0;

    // Completion advances i, but this scan still moves against the old target.
    return {
      servoX_CW: vXAxisCmd > input.xAxis,
      servoX_CCW: vXAxisCmd < input.xAxis,
      servoY_CW: vYAxisCmd > input.yAxis,
      servoY_CCW: vYAxisCmd < input.yAxis,
      waterTankOpenCmd: this.waterTankOpenCmd,
    };
  }
}

export const garden1AutoWater = new AutomaticFlowerWatering();
export const garden2AutoWater = new AutomaticFlowerWatering();
export const garden3AutoWater = new AutomaticFlowerWatering();
export const garden4AutoWater = new AutomaticFlowerWatering();
