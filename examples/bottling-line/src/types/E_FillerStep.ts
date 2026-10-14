/* Filler sequence: wait for a full set of bottles, fill them, then release them. */
export enum E_FillerStep {
  WaitForBottles = 0,
  Filling = 1,
  Releasing = 2,
}
