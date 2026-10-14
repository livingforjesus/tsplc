CASE State OF
	E_CapperState.Idle:
		IF BottlePresent THEN
			State := E_CapperState.Capping;
		END_IF
	E_CapperState.Capping:
		Capped := Capped + 1;
		State := E_CapperState.Idle;
END_CASE
Running := State = E_CapperState.Capping;
