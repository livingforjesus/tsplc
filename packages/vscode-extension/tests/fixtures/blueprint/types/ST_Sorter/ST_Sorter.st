(*
Zone controls, routing context, and transfer status for a two-zone right-angle sorter.
*)
TYPE ST_Sorter :
STRUCT
	(* Two zone controllers in the sorter assembly; each zone has its own control outputs and feedback. *)
	Zones : ARRAY[1..2] OF ST_MotorZone;
	(* Transfer sequence observations; these are not zone controller registers. *)
	Status : ST_SorterStatus;
	(* PLC-owned routing context, never mapped directly to electrical outputs. *)
	Routing : ST_SorterRouting;
END_STRUCT
END_TYPE
