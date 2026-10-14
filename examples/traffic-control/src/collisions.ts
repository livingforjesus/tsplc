import type { STRING } from "@vplc/compiler/types";
import * as sprites from "./sprites.ts";
import { state } from "./state.ts";
import { isSpriteColliding } from "./geometry.ts";
import type { SpriteOutputs } from "./sprite.ts";
import type { SpriteDef_typ } from "./types.ts";

function checkCollision(
  first: SpriteOutputs,
  firstDefinition: SpriteDef_typ,
  second: SpriteOutputs,
  secondDefinition: SpriteDef_typ,
  reason: STRING<255>,
): void {
  if (isSpriteColliding(first, firstDefinition, second, secondDefinition)) {
    state.vCollision = true;
    state.vCrashFlagX = first.actX;
    state.vCrashFlagY = second.actY;
    state.vFaultReason = reason;
  }
}

export function CHECK_COLLISSIONS(): void {
  // Every check runs. The last collision wins the displayed reason and coordinates.
  state.vCollision = false;

  // Car-to-car collisions.
  checkCollision(
    sprites.carC1HR.out,
    sprites.definitions.carC1HR,
    sprites.carC1HL.out,
    sprites.definitions.carC1HL,
    "COLLISSION AT CAR C1HR AND CAR C1HL",
  );
  checkCollision(
    sprites.carC1HR.out,
    sprites.definitions.carC1HR,
    sprites.carC1VU.out,
    sprites.definitions.carC1VU,
    "COLLISSION AT CAR C1HR AND CAR C1VU",
  );
  checkCollision(
    sprites.carC1HR.out,
    sprites.definitions.carC1HR,
    sprites.carC1VD.out,
    sprites.definitions.carC1VD,
    "COLLISSION AT CAR C1HR AND CAR C1VD",
  );
  checkCollision(
    sprites.carC1HR.out,
    sprites.definitions.carC1HR,
    sprites.carC2VD.out,
    sprites.definitions.carC2VD,
    "COLLISSION AT CAR C1HR AND CAR C2VD",
  );
  checkCollision(
    sprites.carC1HR.out,
    sprites.definitions.carC1HR,
    sprites.carC2VU.out,
    sprites.definitions.carC2VU,
    "COLLISSION AT CAR C1HR AND CAR C2VU",
  );
  checkCollision(
    sprites.carC1HL.out,
    sprites.definitions.carC1HL,
    sprites.carC1VU.out,
    sprites.definitions.carC1VU,
    "COLLISSION AT CAR C1HL AND CAR C1VU",
  );
  checkCollision(
    sprites.carC1HL.out,
    sprites.definitions.carC1HL,
    sprites.carC1VD.out,
    sprites.definitions.carC1VD,
    "COLLISSION AT CAR C1HL AND CAR C1VD",
  );
  checkCollision(
    sprites.carC1HL.out,
    sprites.definitions.carC1HL,
    sprites.carC2VU.out,
    sprites.definitions.carC2VU,
    "COLLISSION AT CAR C1HL AND CAR C2VU",
  );
  checkCollision(
    sprites.carC1HL.out,
    sprites.definitions.carC1HL,
    sprites.carC2VD.out,
    sprites.definitions.carC2VD,
    "COLLISSION AT CAR C1HL AND CAR C2VD",
  );
  checkCollision(
    sprites.carC1VU.out,
    sprites.definitions.carC1VU,
    sprites.carC1VD.out,
    sprites.definitions.carC1VD,
    "COLLISSION AT CAR C1VU AND CAR C1VD",
  );
  checkCollision(
    sprites.carC1VU.out,
    sprites.definitions.carC1VU,
    sprites.carC2VD.out,
    sprites.definitions.carC2VD,
    "COLLISSION AT CAR C1VU AND CAR C2VD",
  );
  checkCollision(
    sprites.carC1VU.out,
    sprites.definitions.carC1VU,
    sprites.carC2VU.out,
    sprites.definitions.carC2VU,
    "COLLISSION AT CAR C1VU AND CAR C2VU",
  );
  checkCollision(
    sprites.carC1VD.out,
    sprites.definitions.carC1VD,
    sprites.carC2VD.out,
    sprites.definitions.carC2VD,
    "COLLISSION AT CAR C1VD AND CAR C2VD",
  );
  checkCollision(
    sprites.carC1VD.out,
    sprites.definitions.carC1VD,
    sprites.carC2VU.out,
    sprites.definitions.carC2VU,
    "COLLISSION AT CAR C1VD AND CAR C2VU",
  );
  checkCollision(
    sprites.carC2VD.out,
    sprites.definitions.carC2VD,
    sprites.carC2VU.out,
    sprites.definitions.carC2VU,
    "COLLISSION AT CAR C2VD AND CAR C2VU",
  );
  // carC1HR: all six pedestrians, in upstream priority order.
  checkCollision(
    sprites.carC1HR.out,
    sprites.definitions.carC1HR,
    sprites.pedC1HL.out,
    sprites.definitions.pedC1HL,
    "COLLISSION AT CAR C1HR AND PEDESTRIAN C1HL",
  );
  checkCollision(
    sprites.carC1HR.out,
    sprites.definitions.carC1HR,
    sprites.pedC1VU.out,
    sprites.definitions.pedC1VU,
    "COLLISSION AT CAR C1HR AND PEDESTRIAN C1VU",
  );
  checkCollision(
    sprites.carC1HR.out,
    sprites.definitions.carC1HR,
    sprites.pedC1VD.out,
    sprites.definitions.pedC1VD,
    "COLLISSION AT CAR C1HR AND PEDESTRIAN C1VD",
  );
  checkCollision(
    sprites.carC1HR.out,
    sprites.definitions.carC1HR,
    sprites.pedC2VU.out,
    sprites.definitions.pedC2VU,
    "COLLISSION AT CAR C1HR AND PEDESTRIAN C2VU",
  );
  checkCollision(
    sprites.carC1HR.out,
    sprites.definitions.carC1HR,
    sprites.pedC2VD.out,
    sprites.definitions.pedC2VD,
    "COLLISSION AT CAR C1HR AND PEDESTRIAN C2VD",
  );
  checkCollision(
    sprites.carC1HR.out,
    sprites.definitions.carC1HR,
    sprites.pedC2HR.out,
    sprites.definitions.pedC2HR,
    "COLLISSION AT CAR C1HR AND PEDESTRIAN C2HR",
  );
  // carC1HL: all six pedestrians, in upstream priority order.
  checkCollision(
    sprites.carC1HL.out,
    sprites.definitions.carC1HL,
    sprites.pedC1HL.out,
    sprites.definitions.pedC1HL,
    "COLLISSION AT CAR C1HL AND PEDESTRIAN C1HL",
  );
  checkCollision(
    sprites.carC1HL.out,
    sprites.definitions.carC1HL,
    sprites.pedC1VU.out,
    sprites.definitions.pedC1VU,
    "COLLISSION AT CAR C1HL AND PEDESTRIAN C1VU",
  );
  checkCollision(
    sprites.carC1HL.out,
    sprites.definitions.carC1HL,
    sprites.pedC1VD.out,
    sprites.definitions.pedC1VD,
    "COLLISSION AT CAR C1HL AND PEDESTRIAN C1VD",
  );
  checkCollision(
    sprites.carC1HL.out,
    sprites.definitions.carC1HL,
    sprites.pedC2VU.out,
    sprites.definitions.pedC2VU,
    "COLLISSION AT CAR C1HL AND PEDESTRIAN C2VU",
  );
  checkCollision(
    sprites.carC1HL.out,
    sprites.definitions.carC1HL,
    sprites.pedC2VD.out,
    sprites.definitions.pedC2VD,
    "COLLISSION AT CAR C1HL AND PEDESTRIAN C2VD",
  );
  checkCollision(
    sprites.carC1HL.out,
    sprites.definitions.carC1HL,
    sprites.pedC2HR.out,
    sprites.definitions.pedC2HR,
    "COLLISSION AT CAR C1HL AND PEDESTRIAN C2HR",
  );
  // carC1VU: all six pedestrians, in upstream priority order.
  checkCollision(
    sprites.carC1VU.out,
    sprites.definitions.carC1VU,
    sprites.pedC1HL.out,
    sprites.definitions.pedC1HL,
    "COLLISSION AT CAR C1VU AND PEDESTRIAN C1HL",
  );
  checkCollision(
    sprites.carC1VU.out,
    sprites.definitions.carC1VU,
    sprites.pedC1VU.out,
    sprites.definitions.pedC1VU,
    "COLLISSION AT CAR C1VU AND PEDESTRIAN C1VU",
  );
  checkCollision(
    sprites.carC1VU.out,
    sprites.definitions.carC1VU,
    sprites.pedC1VD.out,
    sprites.definitions.pedC1VD,
    "COLLISSION AT CAR C1VU AND PEDESTRIAN C1VD",
  );
  checkCollision(
    sprites.carC1VU.out,
    sprites.definitions.carC1VU,
    sprites.pedC2VU.out,
    sprites.definitions.pedC2VU,
    "COLLISSION AT CAR C1VU AND PEDESTRIAN C2VU",
  );
  checkCollision(
    sprites.carC1VU.out,
    sprites.definitions.carC1VU,
    sprites.pedC2VD.out,
    sprites.definitions.pedC2VD,
    "COLLISSION AT CAR C1VU AND PEDESTRIAN C2VD",
  );
  checkCollision(
    sprites.carC1VU.out,
    sprites.definitions.carC1VU,
    sprites.pedC2HR.out,
    sprites.definitions.pedC2HR,
    "COLLISSION AT CAR C1VU AND PEDESTRIAN C2HR",
  );
  // carC1VD: all six pedestrians, in upstream priority order.
  checkCollision(
    sprites.carC1VD.out,
    sprites.definitions.carC1VD,
    sprites.pedC1HL.out,
    sprites.definitions.pedC1HL,
    "COLLISSION AT CAR C1VD AND PEDESTRIAN C1HL",
  );
  checkCollision(
    sprites.carC1VD.out,
    sprites.definitions.carC1VD,
    sprites.pedC1VU.out,
    sprites.definitions.pedC1VU,
    "COLLISSION AT CAR C1VD AND PEDESTRIAN C1VU",
  );
  checkCollision(
    sprites.carC1VD.out,
    sprites.definitions.carC1VD,
    sprites.pedC1VD.out,
    sprites.definitions.pedC1VD,
    "COLLISSION AT CAR C1VD AND PEDESTRIAN C1VD",
  );
  checkCollision(
    sprites.carC1VD.out,
    sprites.definitions.carC1VD,
    sprites.pedC2VU.out,
    sprites.definitions.pedC2VU,
    "COLLISSION AT CAR C1VD AND PEDESTRIAN C2VU",
  );
  checkCollision(
    sprites.carC1VD.out,
    sprites.definitions.carC1VD,
    sprites.pedC2VD.out,
    sprites.definitions.pedC2VD,
    "COLLISSION AT CAR C1VD AND PEDESTRIAN C2VD",
  );
  checkCollision(
    sprites.carC1VD.out,
    sprites.definitions.carC1VD,
    sprites.pedC2HR.out,
    sprites.definitions.pedC2HR,
    "COLLISSION AT CAR C1VD AND PEDESTRIAN C2HR",
  );
  // carC2VU: all six pedestrians, in upstream priority order.
  checkCollision(
    sprites.carC2VU.out,
    sprites.definitions.carC2VU,
    sprites.pedC1HL.out,
    sprites.definitions.pedC1HL,
    "COLLISSION AT CAR C2VU AND PEDESTRIAN C1HL",
  );
  checkCollision(
    sprites.carC2VU.out,
    sprites.definitions.carC2VU,
    sprites.pedC1VU.out,
    sprites.definitions.pedC1VU,
    "COLLISSION AT CAR C2VU AND PEDESTRIAN C1VU",
  );
  checkCollision(
    sprites.carC2VU.out,
    sprites.definitions.carC2VU,
    sprites.pedC1VD.out,
    sprites.definitions.pedC1VD,
    "COLLISSION AT CAR C2VU AND PEDESTRIAN C1VD",
  );
  checkCollision(
    sprites.carC2VU.out,
    sprites.definitions.carC2VU,
    sprites.pedC2VU.out,
    sprites.definitions.pedC2VU,
    "COLLISSION AT CAR C2VU AND PEDESTRIAN C2VU",
  );
  checkCollision(
    sprites.carC2VU.out,
    sprites.definitions.carC2VU,
    sprites.pedC2VD.out,
    sprites.definitions.pedC2VD,
    "COLLISSION AT CAR C2VU AND PEDESTRIAN C2VD",
  );
  checkCollision(
    sprites.carC2VU.out,
    sprites.definitions.carC2VU,
    sprites.pedC2HR.out,
    sprites.definitions.pedC2HR,
    "COLLISSION AT CAR C2VU AND PEDESTRIAN C2HR",
  );
  // carC2VD: all six pedestrians, in upstream priority order.
  checkCollision(
    sprites.carC2VD.out,
    sprites.definitions.carC2VD,
    sprites.pedC1HL.out,
    sprites.definitions.pedC1HL,
    "COLLISSION AT CAR C2VD AND PEDESTRIAN C1HL",
  );
  checkCollision(
    sprites.carC2VD.out,
    sprites.definitions.carC2VD,
    sprites.pedC1VU.out,
    sprites.definitions.pedC1VU,
    "COLLISSION AT CAR C2VD AND PEDESTRIAN pedC1VU",
  );
  checkCollision(
    sprites.carC2VD.out,
    sprites.definitions.carC2VD,
    sprites.pedC1VD.out,
    sprites.definitions.pedC1VD,
    "COLLISSION AT CAR C2VD AND PEDESTRIAN C1VD",
  );
  checkCollision(
    sprites.carC2VD.out,
    sprites.definitions.carC2VD,
    sprites.pedC2VU.out,
    sprites.definitions.pedC2VU,
    "COLLISSION AT CAR C2VD AND PEDESTRIAN C2VU",
  );
  checkCollision(
    sprites.carC2VD.out,
    sprites.definitions.carC2VD,
    sprites.pedC2VD.out,
    sprites.definitions.pedC2VD,
    "COLLISSION AT CAR C2VD AND PEDESTRIAN C2VD",
  );
  checkCollision(
    sprites.carC2VD.out,
    sprites.definitions.carC2VD,
    sprites.pedC2HR.out,
    sprites.definitions.pedC2HR,
    "COLLISSION AT CAR C2VD AND PEDESTRIAN C2HR",
  );
  if (!state.vCollision) {
    state.vCrashFlagX = -200;
    state.vCrashFlagY = -200;
  }
}
