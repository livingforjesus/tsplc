/*
DOCUMENTED — auxiliary control signals and feedback for an Intelligrated CS1001 motor-driven roller card.
https://www.scribd.com/document/823553754/MDR-710-With-WWL-Installation-and-Maintenance-Manual
*/
export interface ST_LineCS1001Output {
  /* DOCUMENTED — assert CN2-1 according to the installed SW2-6 setting. TRUE can force run or hold accumulation; FALSE can release accumulation. This command is not proof the motor runs; use CN2-7 feedback. */
  MotionAsserted: BOOL;
  /* DOCUMENTED — CN2-2 reverses rotation in ZPA mode; SW3-1 selects polarity and SW3-2 base rotation.
	   Other modes may use this pin for slave-error signaling. Left/right depends on the installed motor. */
  DirectionOrSlaveErrorAsserted: BOOL;
  /* DOCUMENTED — optional CN2-3 reference in 0..10 V, not metres/second or 4..20 mA. Requires an analog-output module and scaling; X67BCD321.L12 digital channels cannot drive it. Otherwise use locally configured speed. */
  SpeedVolts: LREAL;
}
