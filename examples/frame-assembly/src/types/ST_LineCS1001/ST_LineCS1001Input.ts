/*
DOCUMENTED — auxiliary control signals and feedback for an Intelligrated CS1001 motor-driven roller card.
https://www.scribd.com/document/823553754/MDR-710-With-WWL-Installation-and-Maintenance-Manual
*/
export interface ST_LineCS1001Input {
  /* DOCUMENTED — CN2-4 sensor indication; TRUE when the photoeye is blocked. */
  Sensor: BOOL;
  /* DOCUMENTED — CN2-5 aggregate error indication; no numeric diagnostic code is transmitted by this bit. */
  Error: BOOL;
  /* DOCUMENTED — CN2-6 warning indication. */
  Warning: BOOL;
  /* DOCUMENTED — CN2-7 synchronization indication; TRUE indicates motor running after polarity conversion, independently of CN2-1 command. */
  Sync: BOOL;
}
