import {
  type BOOL,
  type BYTE,
  copy,
  type DINT,
  exact,
  type INT,
  type LREAL,
  type REAL,
  saturate,
  wrap,
} from "@vplc/compiler/types";
import { BYTES_TO_DWORD } from "./color.ts";
import { checkOverlapRectangle } from "./geometry.ts";
import type { Flower_typ } from "./types.ts";

export function simulateFlower(
  flower: Flower_typ,
  pulse: BOOL,
  nozzleX: INT,
  nozzleY: INT,
  valveOpen: BOOL,
): Flower_typ {
  const result: Flower_typ = copy(flower);

  // Untyped 0.07 promotes subtraction and MAX to LREAL; store REAL only afterward.
  let humidity: LREAL = exact<LREAL>(result.hum);
  if (pulse) humidity = humidity - 0.07;
  else humidity = humidity - 0.0;
  if (humidity < 0) humidity = 0;
  result.hum = saturate<REAL>(humidity);

  // Watering is a separate original REAL assignment after the decrease/MAX store.
  if (checkOverlapRectangle(result.x, result.y, 80, 80, nozzleX, nozzleY, 10, 10) && valveOpen) {
    if (pulse) result.hum = result.hum + 4.0;
    else result.hum = result.hum + 0.0;
  }

  result.alive = !(result.red >= 254 && result.green < 100);
  if (result.hum <= 0 || result.hum >= 200) {
    if (pulse) result.red = wrap<BYTE>(exact<DINT>(result.red) + 1);
    if (pulse && result.red > 253) result.green = wrap<BYTE>(exact<DINT>(result.green) - 1);
  } else if (result.alive) {
    if (pulse) result.green = wrap<BYTE>(exact<DINT>(result.green) + 1);
    if (pulse && result.green > 253) result.red = wrap<BYTE>(exact<DINT>(result.red) - 1);
  }

  // BYTE assignment wraps before LIMIT. The updated first channel controls the
  // second decrement; alive was sampled before either color change or clamp.
  if (result.red < 1) result.red = 1;
  else if (result.red > 254) result.red = 254;
  if (result.green < 1) result.green = 1;
  else if (result.green > 254) result.green = 254;
  result.color = BYTES_TO_DWORD(result.blue, result.green, result.red, result.alpha);
  return copy(result);
}
