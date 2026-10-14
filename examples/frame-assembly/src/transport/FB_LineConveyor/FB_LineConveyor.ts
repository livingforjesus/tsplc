import type { ST_LineConveyor } from "../../types/ST_LineConveyor/ST_LineConveyor.ts";

interface Inputs {
  Enabled: BOOL;
  CardCount: UINT;
  Conveyor: InOut<ST_LineConveyor>;
}

export class FB_LineConveyor extends FunctionBlock<Inputs> {
  private CardIndex: UINT = 0;

  protected execute(input: Inputs): void {
    // The original LineConstants.ConveyorCardCapacity and Cards[1..256] are 256.
    input.Conveyor.CardCount = input.CardCount < 256 ? input.CardCount : 256;
    input.Conveyor.Enabled = input.Enabled && input.CardCount > 0 && input.CardCount <= 256;
    /* SW2-6 OFF: CN2-1 asserts an accumulation hold, not an immediate motor stop.
       Speed remains locally configured until the roller and analog I/O are commissioned. */
    // Hold unassigned slots too; reducing CardCount cannot retain an old release.
    for (this.CardIndex = 1; this.CardIndex <= 256; this.CardIndex++) {
      input.Conveyor.Cards[this.CardIndex].Output.MotionAsserted =
        !input.Conveyor.Enabled || this.CardIndex > input.Conveyor.CardCount;
    }
  }
}
