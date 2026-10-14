import {
  type DINT,
  defaultValue,
  exact,
  type INT,
  ms,
  type UINT,
  wrap,
  wrapAdd,
} from "@vplc/compiler/types";
import { clock } from "./clock.ts";
import { simulateFlower } from "./flower.ts";
import { vGarden1 } from "./gardens/garden1.ts";
import { vGarden2 } from "./gardens/garden2.ts";
import { vGarden3 } from "./gardens/garden3.ts";
import { vGarden4 } from "./gardens/garden4.ts";
import { gIO } from "./gIO.ts";
import { absoluteOffset, moveAxis } from "./platform.ts";
import type { Platform_typ } from "./types.ts";

export const simulationState = defaultValue<{
  vG1PlantsAlive: UINT;
  vG2PlantsAlive: UINT;
  vG3PlantsAlive: UINT;
  vG4PlantsAlive: UINT;
}>();
export const platforms = defaultValue<{
  vGarden1Platform: Platform_typ;
  vGarden2Platform: Platform_typ;
  vGarden3Platform: Platform_typ;
  vGarden4Platform: Platform_typ;
}>();

export function SIMULATE_GARDEN1(): void {
  simulationState.vG1PlantsAlive = 0;
  // Wide sums truncate at the original rectangle function's INT input boundary.
  const nozzleX: INT = wrap<INT>(406 + exact<DINT>(platforms.vGarden1Platform.x) + 45);
  const nozzleY: INT = wrap<INT>(361 + exact<DINT>(platforms.vGarden1Platform.y) + 45);
  for (let i: UINT = 0; i < 25; i++) {
    vGarden1[i] = simulateFlower(
      vGarden1[i],
      clock.out.pulse,
      nozzleX,
      nozzleY,
      platforms.vGarden1Platform.OpenValveCmd,
    );
    if (vGarden1[i].alive)
      simulationState.vG1PlantsAlive = wrapAdd<UINT>(simulationState.vG1PlantsAlive, 1);
  }

  // Flowers observe the old platform position/valve; movement and feedback follow.
  platforms.vGarden1Platform.x = moveAxis(
    platforms.vGarden1Platform.x,
    gIO.Garden1_ServoX_CCW,
    gIO.Garden1_ServoX_CW,
    1,
    -404,
    0,
  );
  platforms.vGarden1Platform.y = moveAxis(
    platforms.vGarden1Platform.y,
    gIO.Garden1_ServoY_CCW,
    gIO.Garden1_ServoY_CW,
    1,
    -320,
    0,
  );
  gIO.Garden1_ServoX_Offset = absoluteOffset(platforms.vGarden1Platform.x);
  gIO.Garden1_ServoY_Offset = absoluteOffset(platforms.vGarden1Platform.y);
  platforms.vGarden1Platform.OpenValveCmd = gIO.Garden1_WaterTankOpenCmd;
}

export function SIMULATE_GARDEN2(): void {
  simulationState.vG2PlantsAlive = 0;
  // Wide sums truncate at the original rectangle function's INT input boundary.
  const nozzleX: INT = wrap<INT>(594 + exact<DINT>(platforms.vGarden2Platform.x) + 45);
  const nozzleY: INT = wrap<INT>(361 + exact<DINT>(platforms.vGarden2Platform.y) + 45);
  for (let i: UINT = 0; i < 25; i++) {
    vGarden2[i] = simulateFlower(
      vGarden2[i],
      clock.out.pulse,
      nozzleX,
      nozzleY,
      platforms.vGarden2Platform.OpenValveCmd,
    );
    if (vGarden2[i].alive)
      simulationState.vG2PlantsAlive = wrapAdd<UINT>(simulationState.vG2PlantsAlive, 1);
  }

  // Flowers observe the old platform position/valve; movement and feedback follow.
  platforms.vGarden2Platform.x = moveAxis(
    platforms.vGarden2Platform.x,
    gIO.Garden2_ServoX_CCW,
    gIO.Garden2_ServoX_CW,
    -1,
    0,
    404,
  );
  platforms.vGarden2Platform.y = moveAxis(
    platforms.vGarden2Platform.y,
    gIO.Garden2_ServoY_CCW,
    gIO.Garden2_ServoY_CW,
    1,
    -320,
    0,
  );
  gIO.Garden2_ServoX_Offset = absoluteOffset(platforms.vGarden2Platform.x);
  gIO.Garden2_ServoY_Offset = absoluteOffset(platforms.vGarden2Platform.y);
  platforms.vGarden2Platform.OpenValveCmd = gIO.Garden2_WaterTankOpenCmd;
}

export function SIMULATE_GARDEN3(): void {
  simulationState.vG3PlantsAlive = 0;
  // Wide sums truncate at the original rectangle function's INT input boundary.
  const nozzleX: INT = wrap<INT>(401 + exact<DINT>(platforms.vGarden3Platform.x) + 45);
  const nozzleY: INT = wrap<INT>(640 + exact<DINT>(platforms.vGarden3Platform.y) + 45);
  for (let i: UINT = 0; i < 25; i++) {
    vGarden3[i] = simulateFlower(
      vGarden3[i],
      clock.out.pulse,
      nozzleX,
      nozzleY,
      platforms.vGarden3Platform.OpenValveCmd,
    );
    if (vGarden3[i].alive)
      simulationState.vG3PlantsAlive = wrapAdd<UINT>(simulationState.vG3PlantsAlive, 1);
  }

  // Flowers observe the old platform position/valve; movement and feedback follow.
  platforms.vGarden3Platform.x = moveAxis(
    platforms.vGarden3Platform.x,
    gIO.Garden3_ServoX_CCW,
    gIO.Garden3_ServoX_CW,
    1,
    -404,
    0,
  );
  platforms.vGarden3Platform.y = moveAxis(
    platforms.vGarden3Platform.y,
    gIO.Garden3_ServoY_CCW,
    gIO.Garden3_ServoY_CW,
    -1,
    0,
    320,
  );
  gIO.Garden3_ServoX_Offset = absoluteOffset(platforms.vGarden3Platform.x);
  gIO.Garden3_ServoY_Offset = absoluteOffset(platforms.vGarden3Platform.y);
  platforms.vGarden3Platform.OpenValveCmd = gIO.Garden3_WaterTankOpenCmd;
}

export function SIMULATE_GARDEN4(): void {
  simulationState.vG4PlantsAlive = 0;
  // Wide sums truncate at the original rectangle function's INT input boundary.
  const nozzleX: INT = wrap<INT>(600 + exact<DINT>(platforms.vGarden4Platform.x) + 45);
  const nozzleY: INT = wrap<INT>(642 + exact<DINT>(platforms.vGarden4Platform.y) + 45);
  for (let i: UINT = 0; i < 25; i++) {
    vGarden4[i] = simulateFlower(
      vGarden4[i],
      clock.out.pulse,
      nozzleX,
      nozzleY,
      platforms.vGarden4Platform.OpenValveCmd,
    );
    if (vGarden4[i].alive)
      simulationState.vG4PlantsAlive = wrapAdd<UINT>(simulationState.vG4PlantsAlive, 1);
  }

  // Flowers observe the old platform position/valve; movement and feedback follow.
  platforms.vGarden4Platform.x = moveAxis(
    platforms.vGarden4Platform.x,
    gIO.Garden4_ServoX_CCW,
    gIO.Garden4_ServoX_CW,
    -1,
    0,
    404,
  );
  platforms.vGarden4Platform.y = moveAxis(
    platforms.vGarden4Platform.y,
    gIO.Garden4_ServoY_CCW,
    gIO.Garden4_ServoY_CW,
    -1,
    0,
    320,
  );
  gIO.Garden4_ServoX_Offset = absoluteOffset(platforms.vGarden4Platform.x);
  gIO.Garden4_ServoY_Offset = absoluteOffset(platforms.vGarden4Platform.y);
  platforms.vGarden4Platform.OpenValveCmd = gIO.Garden4_WaterTankOpenCmd;
}

export function simu(): void {
  clock.update({ f: ms(20) });
  SIMULATE_GARDEN1();
  SIMULATE_GARDEN2();
  SIMULATE_GARDEN3();
  SIMULATE_GARDEN4();
}
