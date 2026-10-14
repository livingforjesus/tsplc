(*
Control signals and feedback for one 24 V motor-driven roller zone controller.
*)
TYPE ST_MotorZone :
STRUCT
	(* Normalized control signals toward one zone; mapping handles electrical polarity. *)
	Output : ST_MotorZoneOutput;
	(* Digital feedback from the zone controller, interpreted using the configured signal polarity. *)
	Input : ST_MotorZoneInput;
END_STRUCT
END_TYPE
