/* 
	Docs can be found at https://www.manula.com/manuals/pulseroller/conveylinx-ersc/2/en/topic/plc-i-o-mode-assembly-outputs 
*/
export interface ST_LineLiftOutput {
  MotorRun: BOOL;
  /* Installed configured CCW: FALSE = CCW = Lower; TRUE = CW = Raise. */
  MotorReverse: BOOL;
}
