import { FunctionBlock, TON, type BOOL, type TIME, type USINT } from "@vplc/compiler/types";

export interface DeviceInputs {
  ActivateCmd: BOOL;
  DeactivateCmd: BOOL;
  cfgActTime: TIME;
  cfgDeactTime: TIME;
  simActFail: BOOL;
  simDeactFail: BOOL;
}

export interface DeviceOutputs {
  Activated: BOOL;
  Deactivated: BOOL;
}

export class GenericBistableDeviceModel extends FunctionBlock<DeviceInputs, DeviceOutputs> {
  private TransitionDelay = new TON();
  private vState: USINT = 0;
  private vStateOld: USINT = 3;

  protected execute(input: DeviceInputs): DeviceOutputs {
    switch (this.vState) {
      case 0:
        if (this.vState !== this.vStateOld) {
          // IN=false resets Q/ET; the following call supplies this phase's PT.
          this.TransitionDelay.update({ IN: false, PT: input.cfgActTime });
          this.vStateOld = this.vState;
        }
        this.TransitionDelay.update({
          IN: input.ActivateCmd && !input.simActFail,
          PT: input.cfgActTime,
        });
        if (this.TransitionDelay.out.Q) this.vState = 1;
        break;

      case 1:
        if (this.vState !== this.vStateOld) {
          this.TransitionDelay.update({ IN: false, PT: input.cfgDeactTime });
          this.vStateOld = this.vState;
        }
        this.TransitionDelay.update({
          IN: input.DeactivateCmd && !input.simDeactFail,
          PT: input.cfgDeactTime,
        });
        if (this.TransitionDelay.out.Q) this.vState = 0;
        break;
    }

    // Both outputs are recomputed after a possible transition in this scan.
    return { Activated: this.vState === 1, Deactivated: this.vState === 0 };
  }
}
