import { BLINK, type BOOL, FunctionBlock, R_TRIG, type TIME } from "@vplc/compiler/types";

interface ClockInputs {
  f: TIME;
}
interface ClockOutputs {
  pulse: BOOL;
}

export class ClockPulse extends FunctionBlock<ClockInputs, ClockOutputs> {
  private edge = new R_TRIG();
  private clock = new BLINK();

  protected execute(input: ClockInputs): ClockOutputs {
    this.clock.update({ ENABLE: true, TIMELOW: input.f, TIMEHIGH: input.f });
    this.edge.update({ CLK: this.clock.out.OUT });
    return { pulse: this.edge.out.Q };
  }
}

export const clock = new ClockPulse();
