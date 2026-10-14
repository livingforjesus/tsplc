IF pConveyor = 0 THEN
	RETURN;
END_IF;

(* Reject invalid counts before writing any card. *)
IF pConveyor^.CardCount > LineConstants.ConveyorCardCapacity THEN
	RETURN;
END_IF;

(* Set CN2-1 control signals; the installed card mode determines their effect. *)
FOR CardIndex := 1 TO pConveyor^.CardCount DO
	pConveyor^.Cards[CardIndex].Output.MotionAsserted := Asserted;
END_FOR;
