PROGRAM Main
VAR
	Inbound : FB_Conveyor;
END_VAR

Inbound(Conveyor := LineIO.Inbound);
Inbound.SetMotionSignal(Asserted := TRUE);
END_PROGRAM
