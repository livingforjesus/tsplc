import { E_LineState } from "./types/E_LineState.ts";
import { BeaconPeriod } from "./Settings.ts";

interface StackLightInputs {
  State: E_LineState;
}

interface StackLightOutputs {
  Green: BOOL;
  Red: BOOL;
}

/* Green while running; red flashes from Util.BLINK while faulted. */
export class StackLight extends FunctionBlock<StackLightInputs, StackLightOutputs> {
  private flasher = new BLINK();

  protected execute(input: StackLightInputs): StackLightOutputs {
    const faulted: BOOL = input.State === E_LineState.Faulted;
    this.flasher.update({ ENABLE: faulted, TIMELOW: BeaconPeriod, TIMEHIGH: BeaconPeriod });
    return { Green: input.State === E_LineState.Running, Red: faulted && this.flasher.out.OUT };
  }
}
