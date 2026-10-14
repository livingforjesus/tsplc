IF pConveyor = 0 THEN
	RETURN;
END_IF;

IF pConveyor^.CardCount > LineConstants.CardCapacity THEN
	RETURN;
END_IF;

FOR CardIndex := 1 TO pConveyor^.CardCount DO
	pConveyor^.Cards[CardIndex].Output.MotionAsserted := Asserted;
END_FOR;
