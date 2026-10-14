/*
Separate green and red lamp outputs for a two-lamp stack light. PLC logic selects the indication and times red flashing for faults.
*/
export interface ST_LineLight {
  /* Switches the green lamp on when TRUE. */
  Green: BOOL;
  /* Switches the red lamp on when TRUE; toggle in PLC logic to flash. */
  Red: BOOL;
}
