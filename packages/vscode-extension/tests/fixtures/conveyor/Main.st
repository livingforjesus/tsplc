PROGRAM Main
VAR
	Inbound : FB_Conveyor;
END_VAR

Inbound(Conveyor := PlantIO.Inbound);
Inbound.SetMotionSignal(Asserted := TRUE);
END_PROGRAM
