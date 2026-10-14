import { lights, state } from "./state.ts";
import { CHECK_COLLISSIONS } from "./collisions.ts";

export function FAULT_MONITOR(): void {
  // Checks if dangerous situations occur, horizontal wave and vertical wave green at the same time
  state.vDangerousCombination = false;

  // Green vertical and horizontal pedestrians green
  if (
    lights.Cross1CarU.GreenLamp &&
    (lights.Cross1PedULR.GreenLight || lights.Cross1PedURL.GreenLight)
  ) {
    state.vDangerousCombination = true;
    state.vFaultReason =
      "DANGEROUS COMBINATION AT CROSS1 -> VERTICAL CARS AND HORIZONTAL PEDESTRIANS GREEN AT THE SAME TIME";
  }
  if (
    lights.Cross2CarU.GreenLamp &&
    (lights.Cross2PedULR.GreenLight || lights.Cross2PedURL.GreenLight)
  ) {
    state.vDangerousCombination = true;
    state.vFaultReason =
      "DANGEROUS COMBINATION AT CROSS2 -> VERTICAL CARS AND HORIZONTAL PEDESTRIANS GREEN AT THE SAME TIME";
  }
  if (
    lights.Cross1CarD.GreenLamp &&
    (lights.Cross1PedDLR.GreenLight || lights.Cross1PedDRL.GreenLight)
  ) {
    state.vDangerousCombination = true;
    state.vFaultReason =
      "DANGEROUS COMBINATION AT CROSS1 -> VERTICAL CARS AND HORIZONTAL PEDESTRIANS GREEN AT THE SAME TIME";
  }
  if (
    lights.Cross2CarD.GreenLamp &&
    (lights.Cross2PedDLR.GreenLight || lights.Cross2PedDRL.GreenLight)
  ) {
    state.vDangerousCombination = true;
    state.vFaultReason =
      "DANGEROUS COMBINATION AT CROSS2 -> VERTICAL CARS AND HORIZONTAL PEDESTRIANS GREEN AT THE SAME TIME";
  }

  // Green horizontal and vertical pedestrians green
  if (
    lights.Cross1CarL.GreenLamp &&
    (lights.Cross1PedLUD.GreenLight || lights.Cross1PedLDU.GreenLight)
  ) {
    state.vDangerousCombination = true;
    state.vFaultReason =
      "DANGEROUS COMBINATION AT CROSS1 -> HORIZONTAL CARS AND VERTICAL PEDESTRIANS GREEN AT THE SAME TIME";
  }
  if (
    lights.Cross1CarR.GreenLamp &&
    (lights.Cross1PedRUD.GreenLight || lights.Cross1PedRDU.GreenLight)
  ) {
    state.vDangerousCombination = true;
    state.vFaultReason =
      "DANGEROUS COMBINATION AT CROSS1 -> HORIZONTAL CARS AND VERTICAL PEDESTRIANS GREEN AT THE SAME TIME";
  }
  if (
    lights.Cross2CarL.GreenLamp &&
    (lights.Cross2PedLUD.GreenLight || lights.Cross2PedLDU.GreenLight)
  ) {
    state.vDangerousCombination = true;
    state.vFaultReason =
      "DANGEROUS COMBINATION AT CROSS2 -> HORIZONTAL CARS AND VERTICAL PEDESTRIANS GREEN AT THE SAME TIME";
  }
  if (
    lights.Cross2CarR.GreenLamp &&
    (lights.Cross2PedRUD.GreenLight || lights.Cross2PedRDU.GreenLight)
  ) {
    state.vDangerousCombination = true;
    state.vFaultReason =
      "DANGEROUS COMBINATION AT CROSS2 -> HORIZONTAL CARS AND VERTICAL PEDESTRIANS GREEN AT THE SAME TIME";
  }

  // Checks if there was a collission with car-car and ped - car
  CHECK_COLLISSIONS();
}
