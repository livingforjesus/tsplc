(*
Chain status and individual zone controls and feedback for a motor-driven roller conveyor.
*)
TYPE ST_Conveyor :
STRUCT
	(* Assigned zones in slots 1..ZoneCount; 0 means none assigned. Maximum 128. *)
	ZoneCount : UINT;
	(* Zone controllers driving this conveyor, with individual control outputs and feedback. *)
	Zones : ARRAY[1..128] OF ST_MotorZone;
	(* Aggregate status over explicitly configured chain members. *)
	Status : ST_ConveyorStatus;
END_STRUCT
END_TYPE
