PROGRAM Main
VAR
	Capper : FB_Capper;
END_VAR
PRG_ReadInputs();
PRG_Transport();
Capper(BottlePresent := IO.BottlePresent);
IO.CapperRun := Capper.Running;
PRG_Publish();
END_PROGRAM
