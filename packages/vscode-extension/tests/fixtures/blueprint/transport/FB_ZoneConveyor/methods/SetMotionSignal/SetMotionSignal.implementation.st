IF pConveyor = 0 THEN
	RETURN;
END_IF;

(* Reject invalid counts before writing any zone. *)
IF pConveyor^.ZoneCount > PlantConstants.ConveyorZoneCapacity THEN
	RETURN;
END_IF;

(* Set the run signal; each zone controller's configured mode determines its effect. *)
FOR ZoneIndex := 1 TO pConveyor^.ZoneCount DO
	pConveyor^.Zones[ZoneIndex].Output.MotionAsserted := Asserted;
END_FOR;
