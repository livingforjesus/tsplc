import * as LineConstants from "../../globals/LineConstants.ts";
import { FB_LineLift } from "../../lifts/FB_LineLift/FB_LineLift.ts";
import { E_LineCarrier } from "../../types/E_LineCarrier.ts";
import { E_LineLiftCommand } from "../../types/E_LineLiftCommand.ts";
import { E_LineLiftPosition } from "../../types/E_LineLiftPosition.ts";
import { E_LineStation } from "../../types/E_LineStation.ts";
import type { ST_LineDiverter } from "../../types/ST_LineDiverter/ST_LineDiverter.ts";

interface Inputs {
  Enabled: BOOL;
  RequestedDirection: INT;
  LeftAvailable: BOOL;
  RightAvailable: BOOL;
  Diverter: InOut<ST_LineDiverter>;
}

export class FB_Diverter extends FunctionBlock<Inputs> {
  private BinWasPresent: BOOL = false;
  private LiftControl = new FB_LineLift();

  protected execute(input: Inputs): void {
    /* Clear the route on departure, not while an early lookup is waiting for arrival. */
    if (this.BinWasPresent && !input.Diverter.BinPresent) {
      input.Diverter.RouteReady = false;
      input.Diverter.Route.Barcode = "";
      input.Diverter.Route.EmptyBin = false;
      input.Diverter.Route.HasQC = false;
      input.Diverter.Route.TargetStation = E_LineStation.Unknown;
      input.Diverter.Route.TargetCarrier = E_LineCarrier.Unknown;
    }
    if (!input.Diverter.BinPresent) {
      input.Diverter.Status.SelectedDirection = LineConstants.RouteThrough;
    } else if (!this.BinWasPresent) {
      input.Diverter.Status.SelectedDirection = LineConstants.RouteHold;
    }
    this.BinWasPresent = input.Diverter.BinPresent;

    input.Diverter.ThroughDrive.Output.MotionAsserted = false;
    input.Diverter.TransferDrive.Output.MotionAsserted = false;
    const MotionEnabled: BOOL =
      input.Enabled &&
      !input.Diverter.ThroughDrive.Input.Error &&
      !input.Diverter.TransferDrive.Input.Error;

    /* Choose once per payload. Skip an unavailable side, and never change direction mid-transfer. */
    if (
      MotionEnabled &&
      input.Diverter.BinPresent &&
      input.Diverter.RouteReady &&
      input.Diverter.Status.SelectedDirection === LineConstants.RouteHold
    ) {
      input.Diverter.Status.SelectedDirection = input.RequestedDirection;
      if (
        (input.RequestedDirection === LineConstants.RouteLeft && !input.LeftAvailable) ||
        (input.RequestedDirection === LineConstants.RouteRight && !input.RightAvailable)
      ) {
        input.Diverter.Status.SelectedDirection = LineConstants.RouteThrough;
      }
    }

    /* Diverter cards assume forced-run CN2-1 (SW2-6 ON) and ZPA direction CN2-2.
   Clearing force-run is not a verified motor stop; commission the card settings and wiring. */
    input.Diverter.ThroughDrive.Output.DirectionOrSlaveErrorAsserted = false;
    input.Diverter.TransferDrive.Output.DirectionOrSlaveErrorAsserted =
      input.Diverter.Status.SelectedDirection === LineConstants.RouteRight;

    input.Diverter.Lift.Command = E_LineLiftCommand.Stop;
    if (MotionEnabled) {
      if (input.Diverter.Status.SelectedDirection === LineConstants.RouteThrough) {
        input.Diverter.Lift.Command = E_LineLiftCommand.Lower;
      } else if (
        input.Diverter.Status.SelectedDirection === LineConstants.RouteLeft ||
        input.Diverter.Status.SelectedDirection === LineConstants.RouteRight
      ) {
        input.Diverter.Lift.Command = E_LineLiftCommand.Raise;
      }
    }

    this.LiftControl.update({ Lift: ref(input.Diverter.Lift), MotionTimeout: seconds(3) });
    if (
      !MotionEnabled ||
      input.Diverter.Lift.Status.Faulted ||
      input.Diverter.Lift.Status.MotorRunning
    ) {
      return;
    }

    /* Release only the selected path, after its lift request establishes the endpoint. */
    if (
      input.Diverter.Lift.Command === E_LineLiftCommand.Lower &&
      input.Diverter.Lift.Status.Position === E_LineLiftPosition.Lowered
    ) {
      input.Diverter.ThroughDrive.Output.MotionAsserted = true;
    } else if (
      input.Diverter.Lift.Command === E_LineLiftCommand.Raise &&
      input.Diverter.Lift.Status.Position === E_LineLiftPosition.Raised
    ) {
      input.Diverter.TransferDrive.Output.MotionAsserted = true;
    }
    /* UNVERIFIED INSTALLATION DETAIL: BinPresent coverage over the entire lateral transfer.
   Occupancy is not independent TransferComplete feedback; verify actual sensor coverage. */
  }
}
