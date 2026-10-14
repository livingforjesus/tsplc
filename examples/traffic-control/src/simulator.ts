import { seconds } from "@vplc/compiler/types";
import * as sprites from "./sprites.ts";
import { blinker, state } from "./state.ts";
import { gIO } from "./gIO.ts";
import { MOVE_CARS, MOVE_PEDESTRIANS } from "./movement.ts";
import { CONTROL_LIGHTS, BLINK_DANGER_SIGNAL, BLINK_YELLOW_SIGNAL } from "./lights.ts";
import { FAULT_MONITOR } from "./faults.ts";

export function UPDATE_OBJECTS(): void {
  sprites.carC1HR.update({
    init: sprites.definitions.carC1HR,
    goTo: [0, 0],
    moveX: sprites.motion.carC1HR.moveX,
    moveY: sprites.motion.carC1HR.moveY,
  });
  sprites.carC1HL.update({
    init: sprites.definitions.carC1HL,
    goTo: [0, 0],
    moveX: sprites.motion.carC1HL.moveX,
    moveY: sprites.motion.carC1HL.moveY,
  });
  sprites.carC1VD.update({
    init: sprites.definitions.carC1VD,
    goTo: [0, 0],
    moveX: sprites.motion.carC1VD.moveX,
    moveY: sprites.motion.carC1VD.moveY,
  });
  sprites.carC1VU.update({
    init: sprites.definitions.carC1VU,
    goTo: [0, 0],
    moveX: sprites.motion.carC1VU.moveX,
    moveY: sprites.motion.carC1VU.moveY,
  });
  sprites.carC2VD.update({
    init: sprites.definitions.carC2VD,
    goTo: [0, 0],
    moveX: sprites.motion.carC2VD.moveX,
    moveY: sprites.motion.carC2VD.moveY,
  });
  sprites.carC2VU.update({
    init: sprites.definitions.carC2VU,
    goTo: [0, 0],
    moveX: sprites.motion.carC2VU.moveX,
    moveY: sprites.motion.carC2VU.moveY,
  });
  sprites.pedC1VU.update({
    init: sprites.definitions.pedC1VU,
    goTo: [0, 0],
    moveX: sprites.motion.pedC1VU.moveX,
    moveY: sprites.motion.pedC1VU.moveY,
  });
  sprites.pedC1VD.update({
    init: sprites.definitions.pedC1VD,
    goTo: [0, 0],
    moveX: sprites.motion.pedC1VD.moveX,
    moveY: sprites.motion.pedC1VD.moveY,
  });
  sprites.pedC2VU.update({
    init: sprites.definitions.pedC2VU,
    goTo: [0, 0],
    moveX: sprites.motion.pedC2VU.moveX,
    moveY: sprites.motion.pedC2VU.moveY,
  });
  sprites.pedC2VD.update({
    init: sprites.definitions.pedC2VD,
    goTo: [0, 0],
    moveX: sprites.motion.pedC2VD.moveX,
    moveY: sprites.motion.pedC2VD.moveY,
  });
  sprites.pedC1HL.update({
    init: sprites.definitions.pedC1HL,
    goTo: [0, 0],
    moveX: sprites.motion.pedC1HL.moveX,
    moveY: sprites.motion.pedC1HL.moveY,
  });
  sprites.pedC2HR.update({
    init: sprites.definitions.pedC2HR,
    goTo: [0, 0],
    moveX: sprites.motion.pedC2HR.moveX,
    moveY: sprites.motion.pedC2HR.moveY,
  });
}

export function simulator(): void {
  // Movement decisions use the previous held lamp image, before this scan copies gIO.
  MOVE_CARS();
  MOVE_PEDESTRIANS();

  if (state.vPoliceControl) {
    UPDATE_OBJECTS();
    BLINK_YELLOW_SIGNAL();
  } else if (state.vCollision || state.vDangerousCombination) {
    BLINK_DANGER_SIGNAL();
  } else {
    UPDATE_OBJECTS();
    CONTROL_LIGHTS();
    state.vFaultReason = "";
  }
  FAULT_MONITOR();
  gIO.PoliceModeActivated = state.vPoliceControl;

  // Lamp actions read the old OUT. The native block is updated last, as upstream.
  blinker.update({ ENABLE: true, TIMELOW: seconds(1), TIMEHIGH: seconds(1) });
}
