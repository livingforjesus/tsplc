IF pConveyor = 0 THEN
	RETURN;
END_IF;

IF pConveyor^.ZoneCount > PlantConstants.ZoneCapacity THEN
	RETURN;
END_IF;

FOR ZoneIndex := 1 TO pConveyor^.ZoneCount DO
	pConveyor^.Zones[ZoneIndex].Output.MotionAsserted := Asserted;
END_FOR;
