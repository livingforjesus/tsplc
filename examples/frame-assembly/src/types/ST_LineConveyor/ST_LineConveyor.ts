import type { ST_LineCS1001 } from "../ST_LineCS1001/ST_LineCS1001.ts";

/*
Individual Intelligrated CS1001 card controls and feedback for an MDR conveyor using B&R X67 I/O.
https://www.scribd.com/document/823553754/MDR-710-With-WWL-Installation-and-Maintenance-Manual
https://www.br-automation.com/en-in/products/io-systems/x67-system/bus-controller-modules/x67bcd321l12/
*/
export interface ST_LineConveyor {
  /* PLC run request used by the simulation; not CS1001 motor feedback or a wired enable signal. */
  Enabled: BOOL;
  /* Assigned CS1001 cards in slots 1..CardCount; 0 means none assigned. Bounded by LineConstants.ConveyorCardCapacity. */
  CardCount: UINT;
  /* Intelligrated CS1001 cards controlling this conveyor, with individual control outputs and feedback. */
  Cards: FixedArray<ST_LineCS1001, 256, 1>;
}
