import { E_LineLiftCommand } from "../../types/E_LineLiftCommand.ts";
import { E_LineLiftPosition } from "../../types/E_LineLiftPosition.ts";
import type { ST_LineLift } from "../../types/ST_LineLift/ST_LineLift.ts";

interface Inputs {
  MotionTimeout: TIME;
  Lift: InOut<ST_LineLift>;
}

export class FB_LineLift extends FunctionBlock<Inputs> {
  private PreviousCommand: E_LineLiftCommand = E_LineLiftCommand.Stop;
  private Moving: BOOL = false;
  private WaitingForOverloadClear: BOOL = false;
  private MotionTimer = new TON();

  protected execute(input: Inputs): void {
    // Clear commands first; actual motor feedback governs every subsequent decision.
    input.Lift.Output.MotorRun = false;
    input.Lift.Output.MotorReverse = false;
    input.Lift.Status.MotorRunning =
      input.Lift.Input.MotorRunningCW || input.Lift.Input.MotorRunningCCW;

    let Target: E_LineLiftPosition = E_LineLiftPosition.Unknown;
    if (input.Lift.Command === E_LineLiftCommand.Raise) {
      Target = E_LineLiftPosition.Raised;
      input.Lift.Output.MotorReverse = true; /* Installed CCW configuration: reverse raises. */
    } else if (input.Lift.Command === E_LineLiftCommand.Lower) {
      Target = E_LineLiftPosition.Lowered;
    }

    /* A fresh command rearms the request. Stop then Raise/Lower retries without restarting the PLC. */
    const NewRequest: BOOL = input.Lift.Command !== this.PreviousCommand;
    if (NewRequest) {
      this.Moving = false;
      input.Lift.Status.Faulted = false;
      input.Lift.Status.MotionTimedOut = false;
      if (Target !== E_LineLiftPosition.Unknown) {
        input.Lift.Status.Position = E_LineLiftPosition.Unknown;
      }
    }
    this.PreviousCommand = input.Lift.Command;
    if (!input.Lift.Input.MotorOverloaded) {
      this.WaitingForOverloadClear = false;
    }

    /* Endpoint overload can include stall. Pre-existing overload and other drive faults cannot prove position. */
    const ExpectedOverload: BOOL =
      input.Lift.Input.MotorOverloaded && (this.Moving || this.WaitingForOverloadClear);
    const MotorFault: BOOL =
      input.Lift.Input.MotorNotConnected ||
      input.Lift.Input.MotorOverCurrent ||
      input.Lift.Input.MotorShortCircuit ||
      input.Lift.Input.MotorOverheated ||
      input.Lift.Input.MotorOverVoltage ||
      input.Lift.Input.MotorLowVoltage ||
      input.Lift.Input.MotorUnavailable ||
      (input.Lift.Input.MotorRunningCW && input.Lift.Input.MotorRunningCCW) ||
      (this.Moving && Target === E_LineLiftPosition.Raised && input.Lift.Input.MotorRunningCCW) ||
      (this.Moving && Target === E_LineLiftPosition.Lowered && input.Lift.Input.MotorRunningCW) ||
      ((input.Lift.Input.MotorStalled || input.Lift.Input.MotorOverloaded) && !ExpectedOverload);
    if (MotorFault) {
      input.Lift.Status.Faulted = true;
      input.Lift.Status.Position = E_LineLiftPosition.Unknown;
      this.Moving = false;
    }

    /* A held request gets one attempt. The same timer bounds waiting, startup and travel. */
    const RequestPending: BOOL =
      Target !== E_LineLiftPosition.Unknown &&
      input.Lift.Status.Position === E_LineLiftPosition.Unknown &&
      !input.Lift.Status.Faulted;
    this.MotionTimer.update({ IN: RequestPending && !NewRequest, PT: input.MotionTimeout });
    if (this.MotionTimer.out.Q) {
      input.Lift.Status.MotionTimedOut = true;
      input.Lift.Status.Faulted = true;
      this.Moving = false;
    } else if (
      RequestPending &&
      !NewRequest &&
      !this.Moving &&
      !this.WaitingForOverloadClear &&
      !input.Lift.Status.MotorRunning
    ) {
      this.Moving = true;
    }

    if (this.Moving) {
      if (input.Lift.Input.MotorOverloaded) {
        input.Lift.Status.Position = Target;
        this.Moving = false;
        this.WaitingForOverloadClear = true;
      } else {
        input.Lift.Output.MotorRun = true;
      }
    }
  }
}
