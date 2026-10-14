import { copy } from "@vplc/compiler/types";
import { gIO } from "./gIO.ts";
import { blinker, lights } from "./state.ts";

export function CONTROL_LIGHTS(): void {
  lights.Cross1CarU = copy(gIO.Cross1CarU);
  lights.Cross1CarD = copy(gIO.Cross1CarD);
  lights.Cross1CarL = copy(gIO.Cross1CarL);
  lights.Cross1CarR = copy(gIO.Cross1CarR);

  lights.Cross2CarU = copy(gIO.Cross2CarU);
  lights.Cross2CarD = copy(gIO.Cross2CarD);
  lights.Cross2CarL = copy(gIO.Cross2CarL);
  lights.Cross2CarR = copy(gIO.Cross2CarR);

  lights.Cross1PedLUD = copy(gIO.Cross1PedLUD);
  lights.Cross1PedLDU = copy(gIO.Cross1PedLDU);
  lights.Cross1PedRUD = copy(gIO.Cross1PedRUD);
  lights.Cross1PedRDU = copy(gIO.Cross1PedRDU);

  lights.Cross1PedULR = copy(gIO.Cross1PedULR);
  lights.Cross1PedURL = copy(gIO.Cross1PedURL);
  lights.Cross1PedDLR = copy(gIO.Cross1PedDLR);
  lights.Cross1PedDRL = copy(gIO.Cross1PedDRL);

  lights.Cross2PedLUD = copy(gIO.Cross2PedLUD);
  lights.Cross2PedLDU = copy(gIO.Cross2PedLDU);
  lights.Cross2PedRUD = copy(gIO.Cross2PedRUD);
  lights.Cross2PedRDU = copy(gIO.Cross2PedRDU);

  lights.Cross2PedULR = copy(gIO.Cross2PedULR);
  lights.Cross2PedURL = copy(gIO.Cross2PedURL);
  lights.Cross2PedDLR = copy(gIO.Cross2PedDLR);
  lights.Cross2PedDRL = copy(gIO.Cross2PedDRL);
}

export function BLINK_DANGER_SIGNAL(): void {
  lights.Cross1CarU.GreenLamp = false;
  lights.Cross1CarU.YellowLamp = false;
  lights.Cross1CarU.RedLamp = blinker.out.OUT;

  lights.Cross1CarD = copy(lights.Cross1CarU);
  lights.Cross1CarL = copy(lights.Cross1CarU);
  lights.Cross1CarR = copy(lights.Cross1CarU);

  lights.Cross2CarU = copy(lights.Cross1CarU);
  lights.Cross2CarD = copy(lights.Cross1CarU);
  lights.Cross2CarL = copy(lights.Cross1CarU);
  lights.Cross2CarR = copy(lights.Cross1CarU);

  lights.Cross1PedLUD.GreenLight = false;
  lights.Cross1PedLUD.RedLight = blinker.out.OUT;
  lights.Cross1PedLUD.TimeToSequenceChange = 0;

  lights.Cross1PedLDU = copy(lights.Cross1PedLUD);
  lights.Cross1PedRUD = copy(lights.Cross1PedLUD);
  lights.Cross1PedRDU = copy(lights.Cross1PedLUD);

  lights.Cross1PedULR = copy(lights.Cross1PedLUD);
  lights.Cross1PedURL = copy(lights.Cross1PedLUD);
  lights.Cross1PedDLR = copy(lights.Cross1PedLUD);
  lights.Cross1PedDRL = copy(lights.Cross1PedLUD);

  lights.Cross2PedLUD = copy(lights.Cross1PedLUD);
  lights.Cross2PedLDU = copy(lights.Cross1PedLUD);
  lights.Cross2PedRUD = copy(lights.Cross1PedLUD);
  lights.Cross2PedRDU = copy(lights.Cross1PedLUD);

  lights.Cross2PedULR = copy(lights.Cross1PedLUD);
  lights.Cross2PedURL = copy(lights.Cross1PedLUD);
  lights.Cross2PedDLR = copy(lights.Cross1PedLUD);
  lights.Cross2PedDRL = copy(lights.Cross1PedLUD);
}

export function BLINK_YELLOW_SIGNAL(): void {
  lights.Cross1CarU.GreenLamp = false;
  lights.Cross1CarU.YellowLamp = blinker.out.OUT;
  lights.Cross1CarU.RedLamp = false;

  lights.Cross1CarD = copy(lights.Cross1CarU);
  lights.Cross1CarL = copy(lights.Cross1CarU);
  lights.Cross1CarR = copy(lights.Cross1CarU);

  lights.Cross2CarU = copy(lights.Cross1CarU);
  lights.Cross2CarD = copy(lights.Cross1CarU);
  lights.Cross2CarL = copy(lights.Cross1CarU);
  lights.Cross2CarR = copy(lights.Cross1CarU);

  lights.Cross1PedLUD.GreenLight = false;
  lights.Cross1PedLUD.RedLight = false;
  lights.Cross1PedLUD.TimeToSequenceChange = 0;

  lights.Cross1PedLDU = copy(lights.Cross1PedLUD);
  lights.Cross1PedRUD = copy(lights.Cross1PedLUD);
  lights.Cross1PedRDU = copy(lights.Cross1PedLUD);

  lights.Cross1PedULR = copy(lights.Cross1PedLUD);
  lights.Cross1PedURL = copy(lights.Cross1PedLUD);
  lights.Cross1PedDLR = copy(lights.Cross1PedLUD);
  lights.Cross1PedDRL = copy(lights.Cross1PedLUD);

  lights.Cross2PedLUD = copy(lights.Cross1PedLUD);
  lights.Cross2PedLDU = copy(lights.Cross1PedLUD);
  lights.Cross2PedRUD = copy(lights.Cross1PedLUD);
  lights.Cross2PedRDU = copy(lights.Cross1PedLUD);

  lights.Cross2PedULR = copy(lights.Cross1PedLUD);
  lights.Cross2PedURL = copy(lights.Cross1PedLUD);
  lights.Cross2PedDLR = copy(lights.Cross1PedLUD);
  lights.Cross2PedDRL = copy(lights.Cross1PedLUD);
}
