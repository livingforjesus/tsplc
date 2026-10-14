PROGRAM Main
VAR
	Inbound : FB_ZoneConveyor;
END_VAR

(* Bind the conveyor each cycle before calling Inbound.SetMotionSignal(). *)
Inbound(Conveyor := PlantIO.Conveyor_Infeed);

END_PROGRAM
