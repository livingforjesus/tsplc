FUNCTION_BLOCK FB_Capper
VAR_INPUT
	BottlePresent : BOOL;
END_VAR
VAR_OUTPUT
	Running : BOOL;
END_VAR
VAR
	State : E_CapperState := E_CapperState.Idle;
	Capped : UDINT;
END_VAR
