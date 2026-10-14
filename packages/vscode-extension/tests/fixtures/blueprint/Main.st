PROGRAM Main
VAR
	Inbound : FB_LineConveyor;
END_VAR

(* Bind the conveyor each cycle before calling Inbound.SetMotionSignal(). *)
Inbound(Conveyor := LineIO.Conveyor_Inbound);

END_PROGRAM
