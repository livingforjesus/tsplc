import { E_FillerStep } from "../types/E_FillerStep.ts";
import type { ST_Filler } from "../types/ST_Filler.ts";
import { wrapAdd } from "@tsplc/compiler/types";

interface FillerInputs {
  Filler: InOut<ST_Filler>;
  Enabled: BOOL;
  FillTime: TIME;
}

interface FillerOutputs {
  /* True for the one scan in which a set of bottles finished filling. */
  BatchDone: BOOL;
}

/*
Close the gate, wait for a full set of bottles, open every valve for the recipe's
fill time, then release the bottles. Stopping the line closes the valves and
restarts the fill time when the line runs again.
*/
export class FillerControl extends FunctionBlock<FillerInputs, FillerOutputs> {
  private fillTimer = new TON();

  protected execute(input: FillerInputs): FillerOutputs {
    const filling: BOOL = input.Filler.Step === E_FillerStep.Filling && input.Enabled;
    this.fillTimer.update({ IN: filling, PT: input.FillTime });
    let done: BOOL = false;

    switch (input.Filler.Step) {
      case E_FillerStep.WaitForBottles:
        if (input.Enabled && input.Filler.BottlesInPlace) {
          input.Filler.Step = E_FillerStep.Filling;
        }
        break;
      case E_FillerStep.Filling:
        if (this.fillTimer.out.Q) {
          done = true;
          input.Filler.Step = E_FillerStep.Releasing;
        }
        break;
      case E_FillerStep.Releasing:
        if (!input.Filler.BottlesInPlace) {
          input.Filler.Step = E_FillerStep.WaitForBottles;
        }
        break;
    }

    input.Filler.GateClosed = input.Filler.Step !== E_FillerStep.Releasing;
    const open: BOOL = input.Filler.Step === E_FillerStep.Filling && input.Enabled;
    for (let head: USINT = 1; head <= 4; head++) {
      input.Filler.Valves[head].Open = open;
      if (done) {
        input.Filler.Valves[head].Fills = wrapAdd<UDINT>(input.Filler.Valves[head].Fills, 1);
      }
    }
    return { BatchDone: done };
  }
}
