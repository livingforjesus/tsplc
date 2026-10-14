import * as sprites from "./sprites.ts";
import { lights } from "./state.ts";

export function MOVE_CARS(): void {
  // Car C1 HL. Moves from left to right, stops at the crossroads and moves if only green is lit
  if (sprites.carC1HL.out.actX === -49) {
    if (
      lights.Cross1CarL.GreenLamp &&
      !(lights.Cross1CarL.RedLamp || lights.Cross1CarL.YellowLamp)
    ) {
      sprites.motion.carC1HL.moveX = 1;
    } else {
      sprites.motion.carC1HL.moveX = 0;
    }
  } else if (sprites.carC1HL.out.actX === 1211) {
    if (
      lights.Cross2CarL.GreenLamp &&
      !(lights.Cross2CarL.RedLamp || lights.Cross2CarL.YellowLamp)
    ) {
      sprites.motion.carC1HL.moveX = 1;
    } else {
      sprites.motion.carC1HL.moveX = 0;
    }
  } else {
    sprites.motion.carC1HL.moveX = 1;
  }

  // Car C1 HR. Moves from right to left, stops at the crossroads and moves if only green is lit
  if (sprites.carC1HR.out.actX === 567) {
    if (
      lights.Cross1CarR.GreenLamp &&
      !(lights.Cross1CarR.RedLamp || lights.Cross1CarR.YellowLamp)
    ) {
      sprites.motion.carC1HR.moveX = -1;
    } else {
      sprites.motion.carC1HR.moveX = 0;
    }
  } else if (sprites.carC1HR.out.actX === 1829) {
    if (
      lights.Cross2CarR.GreenLamp &&
      !(lights.Cross2CarR.RedLamp || lights.Cross2CarR.YellowLamp)
    ) {
      sprites.motion.carC1HR.moveX = -1;
    } else {
      sprites.motion.carC1HR.moveX = 0;
    }
  } else {
    sprites.motion.carC1HR.moveX = -1;
  }

  // Car C1 VU. Moves from up to down, stops at the crossroads and moves if only green is lit
  if (sprites.carC1VU.out.actY === -49) {
    if (
      lights.Cross1CarU.GreenLamp &&
      !(lights.Cross1CarU.RedLamp || lights.Cross1CarU.YellowLamp)
    ) {
      sprites.motion.carC1VU.moveY = 1;
    } else {
      sprites.motion.carC1VU.moveY = 0;
    }
  } else {
    sprites.motion.carC1VU.moveY = 1;
  }

  // Car C2 VU. Moves from up to down, stops at the crossroads and moves if only green is lit
  if (sprites.carC2VU.out.actY === -49) {
    if (
      lights.Cross2CarU.GreenLamp &&
      !(lights.Cross2CarU.RedLamp || lights.Cross2CarU.YellowLamp)
    ) {
      sprites.motion.carC2VU.moveY = 1;
    } else {
      sprites.motion.carC2VU.moveY = 0;
    }
  } else {
    sprites.motion.carC2VU.moveY = 1;
  }

  // Car C1 VD. Moves from down to up, stops at the crossroads and moves if only green is lit
  if (sprites.carC1VD.out.actY === 564) {
    if (
      lights.Cross1CarD.GreenLamp &&
      !(lights.Cross1CarD.RedLamp || lights.Cross1CarD.YellowLamp)
    ) {
      sprites.motion.carC1VD.moveY = -1;
    } else {
      sprites.motion.carC1VD.moveY = 0;
    }
  } else {
    sprites.motion.carC1VD.moveY = -1;
  }

  // Car C2 VD. Moves from down to up, stops at the crossroads and moves if only green is lit
  if (sprites.carC2VD.out.actY === 564) {
    if (
      lights.Cross2CarD.GreenLamp &&
      !(lights.Cross2CarD.RedLamp || lights.Cross2CarD.YellowLamp)
    ) {
      sprites.motion.carC2VD.moveY = -1;
    } else {
      sprites.motion.carC2VD.moveY = 0;
    }
  } else {
    sprites.motion.carC2VD.moveY = -1;
  }
}

export function MOVE_PEDESTRIANS(): void {
  // Pedestrian C1 VU. Moves from up to down, stops at the crossroads and moves if only green is lit
  if (sprites.pedC1VU.out.actY === 180) {
    if (lights.Cross1PedLUD.GreenLight && !lights.Cross1PedLUD.RedLight) {
      sprites.motion.pedC1VU.moveY = 1;
    } else {
      sprites.motion.pedC1VU.moveY = 0;
    }
  } else {
    sprites.motion.pedC1VU.moveY = 1;
  }

  // Pedestrian C2 VU. Moves from up to down, stops at the crossroads and moves if only green is lit
  if (sprites.pedC2VU.out.actY === 180) {
    if (lights.Cross2PedLUD.GreenLight && !lights.Cross2PedLUD.RedLight) {
      sprites.motion.pedC2VU.moveY = 1;
    } else {
      sprites.motion.pedC2VU.moveY = 0;
    }
  } else {
    sprites.motion.pedC2VU.moveY = 1;
  }

  // Pedestrian C1 VD. Moves from down to up, stops at the crossroads and moves if only green is lit
  if (sprites.pedC1VD.out.actY === 480) {
    if (lights.Cross1PedLDU.GreenLight && !lights.Cross1PedLDU.RedLight) {
      sprites.motion.pedC1VD.moveY = -1;
    } else {
      sprites.motion.pedC1VD.moveY = 0;
    }
  } else {
    sprites.motion.pedC1VD.moveY = -1;
  }

  // Pedestrian C1 VD. Moves from down to up, stops at the crossroads and moves if only green is lit
  if (sprites.pedC2VD.out.actY === 480) {
    if (lights.Cross2PedLDU.GreenLight && !lights.Cross2PedLDU.RedLight) {
      sprites.motion.pedC2VD.moveY = -1;
    } else {
      sprites.motion.pedC2VD.moveY = 0;
    }
  } else {
    sprites.motion.pedC2VD.moveY = -1;
  }

  // Pedestrian C1 HL. Moves from left to right, stops at the crossroads and moves if only green is lit
  if (sprites.pedC1HL.out.actX === 190) {
    if (lights.Cross1PedDLR.GreenLight && !lights.Cross1PedDLR.RedLight) {
      sprites.motion.pedC1HL.moveX = 1;
    } else {
      sprites.motion.pedC1HL.moveX = 0;
    }
  } else if (sprites.pedC1HL.out.actX === 1450) {
    if (lights.Cross2PedDLR.GreenLight && !lights.Cross2PedDLR.RedLight) {
      sprites.motion.pedC1HL.moveX = 1;
    } else {
      sprites.motion.pedC1HL.moveX = 0;
    }
  } else {
    sprites.motion.pedC1HL.moveX = 1;
  }

  // Pedestrian C1 HR. Moves from right to left, stops at the crossroads and moves if only green is lit
  if (sprites.pedC2HR.out.actX === 1740) {
    if (lights.Cross2PedURL.GreenLight && !lights.Cross2PedURL.RedLight) {
      sprites.motion.pedC2HR.moveX = -1;
    } else {
      sprites.motion.pedC2HR.moveX = 0;
    }
  } else if (sprites.pedC2HR.out.actX === 480) {
    if (lights.Cross1PedURL.GreenLight && !lights.Cross1PedURL.RedLight) {
      sprites.motion.pedC2HR.moveX = -1;
    } else {
      sprites.motion.pedC2HR.moveX = 0;
    }
  } else {
    sprites.motion.pedC2HR.moveX = -1;
  }
}
