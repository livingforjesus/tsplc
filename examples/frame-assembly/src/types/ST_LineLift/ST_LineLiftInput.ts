export interface ST_LineLiftInput {
  /* ZoneMax RIGHT motor status: 4:0082, Assembly #7 word 11 / I.Data[11].
	   ERSC v4.7 pp. 54-56: bits 0-1 jointly decode 00 stopped/braking,
	   01 CCW, 10 CW, 11 stopped/free coast. Never echo MotorRun as motion.
	   https://www.indsoft.bg/downloads/CL/ConveyLinx_Developers_Guide_v4_7.pdf
	   The commissioned I/O boundary decodes this word; no physical addresses in lift logic. */
  MotorRunningCW: BOOL;
  MotorRunningCCW: BOOL;
  /* Bit 12 */
  MotorOverloaded: BOOL;
  /* Bit 13. */
  MotorStalled: BOOL;
  /* Bit 11 */
  MotorNotConnected: BOOL;
  /* Bit 9 */
  MotorOverCurrent: BOOL;
  /* Bit 10 */
  MotorShortCircuit: BOOL;
  /* Bit 8 */
  MotorOverheated: BOOL;
  /* Bit 6 */
  MotorOverVoltage: BOOL;
  /* Bit 7 */
  MotorLowVoltage: BOOL;
  /* Unavailable drive: bit 15 (motor not used), or unavailable/stale status in the I/O mapping. */
  MotorUnavailable: BOOL;
}
