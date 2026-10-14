import {
  copy,
  div,
  ms,
  seconds,
  timeToMilliseconds,
  TON,
  wrap,
  wrapSubtract,
  type TIME,
  type UDINT,
  type UINT,
} from "@vplc/compiler/types";
import { gIO } from "./gIO.ts";

export const TactTimer = new TON();
export const controllerState: {
  vPeriodTime: TIME;
  vElapsedTime: TIME;
  vTimeToSequenceChange: UDINT;
} = {
  vPeriodTime: seconds(62),
  vElapsedTime: ms(0),
  vTimeToSequenceChange: 0,
};

export function controller(): void {
  TactTimer.update({ IN: true, PT: controllerState.vPeriodTime });
  // Capture elapsed time before the reset call clears the timer output.
  controllerState.vElapsedTime = TactTimer.out.ET;
  if (TactTimer.out.Q) {
    TactTimer.update({ IN: false, PT: controllerState.vPeriodTime });
  }

  const elapsed: UDINT = timeToMilliseconds(controllerState.vElapsedTime);
  if (controllerState.vElapsedTime <= seconds(28)) {
    controllerState.vTimeToSequenceChange = div<UDINT>(wrapSubtract<UDINT>(28000, elapsed), 1000);
  } else if (controllerState.vElapsedTime <= seconds(62)) {
    controllerState.vTimeToSequenceChange = div<UDINT>(wrapSubtract<UDINT>(62000, elapsed), 1000);
  }

  // Direction Up, Down traffic light
  gIO.Cross1CarU.RedLamp =
    controllerState.vElapsedTime >= seconds(0) && controllerState.vElapsedTime <= seconds(30);
  gIO.Cross1CarU.YellowLamp =
    (controllerState.vElapsedTime >= seconds(28) && controllerState.vElapsedTime <= seconds(30)) ||
    (controllerState.vElapsedTime >= seconds(60) && controllerState.vElapsedTime <= seconds(62));
  gIO.Cross1CarU.GreenLamp =
    controllerState.vElapsedTime >= seconds(30) && controllerState.vElapsedTime <= seconds(60);

  // Mirror the other side of the Up, Down direction
  gIO.Cross1CarD = copy(gIO.Cross1CarU);
  gIO.Cross2CarD = copy(gIO.Cross1CarU);
  gIO.Cross2CarU = copy(gIO.Cross1CarU);

  // Direction Left, Right traffic light
  gIO.Cross1CarL.RedLamp =
    controllerState.vElapsedTime >= seconds(28) && controllerState.vElapsedTime <= seconds(60);
  gIO.Cross1CarL.YellowLamp =
    (controllerState.vElapsedTime >= seconds(26) && controllerState.vElapsedTime <= seconds(28)) ||
    (controllerState.vElapsedTime >= seconds(58) && controllerState.vElapsedTime <= seconds(60));
  gIO.Cross1CarL.GreenLamp =
    (controllerState.vElapsedTime >= seconds(0) && controllerState.vElapsedTime <= seconds(26)) ||
    (controllerState.vElapsedTime >= seconds(60) && controllerState.vElapsedTime <= seconds(62));

  // Mirror the other side of the Left, Right direction
  gIO.Cross1CarR = copy(gIO.Cross1CarL);
  gIO.Cross2CarR = copy(gIO.Cross1CarL);
  gIO.Cross2CarL = copy(gIO.Cross1CarL);

  // Pedestrians
  // If left <-> right cars are going. Up <-> down pedestrians stop. Else go
  if (gIO.Cross1CarL.GreenLamp || gIO.Cross1CarL.YellowLamp) {
    gIO.Cross1PedLDU.RedLight = true;
    gIO.Cross1PedLDU.GreenLight = false;
  } else if (gIO.Cross1CarL.RedLamp) {
    gIO.Cross1PedLDU.RedLight = false;
    gIO.Cross1PedLDU.GreenLight = true;
  }
  gIO.Cross1PedLDU.TimeToSequenceChange = wrap<UINT>(controllerState.vTimeToSequenceChange);

  // Just copy all of the up and downs as they behave the same
  gIO.Cross1PedLUD = copy(gIO.Cross1PedLDU);
  gIO.Cross1PedRUD = copy(gIO.Cross1PedLDU);
  gIO.Cross1PedRDU = copy(gIO.Cross1PedLDU);
  gIO.Cross2PedLDU = copy(gIO.Cross1PedLDU);
  gIO.Cross2PedLUD = copy(gIO.Cross1PedLDU);
  gIO.Cross2PedRUD = copy(gIO.Cross1PedLDU);
  gIO.Cross2PedRDU = copy(gIO.Cross1PedLDU);

  // If up <-> Down cars are going. Left <-> right pedestrians stop. Else go
  if (gIO.Cross1CarU.GreenLamp || gIO.Cross1CarU.YellowLamp) {
    gIO.Cross1PedULR.RedLight = true;
    gIO.Cross1PedULR.GreenLight = false;
  } else if (gIO.Cross1CarU.RedLamp) {
    gIO.Cross1PedULR.RedLight = false;
    gIO.Cross1PedULR.GreenLight = true;
  }
  gIO.Cross1PedULR.TimeToSequenceChange = wrap<UINT>(controllerState.vTimeToSequenceChange);

  // Just copy all of the lefts and rights as they behave the same
  gIO.Cross1PedURL = copy(gIO.Cross1PedULR);
  gIO.Cross1PedDLR = copy(gIO.Cross1PedULR);
  gIO.Cross1PedDRL = copy(gIO.Cross1PedULR);
  gIO.Cross2PedULR = copy(gIO.Cross1PedULR);
  gIO.Cross2PedURL = copy(gIO.Cross1PedULR);
  gIO.Cross2PedDLR = copy(gIO.Cross1PedULR);
  gIO.Cross2PedDRL = copy(gIO.Cross1PedULR);
}
