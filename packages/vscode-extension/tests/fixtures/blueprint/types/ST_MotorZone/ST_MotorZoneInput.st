(*
Control signals and feedback for one 24 V motor-driven roller zone controller.
*)
TYPE ST_MotorZoneInput :
STRUCT
	(* Zone sensor indication; TRUE when the photoeye is blocked. *)
	Sensor : BOOL;
	(* Aggregate error indication; no numeric diagnostic code is transmitted by this bit. *)
	Error : BOOL;
	(* Warning indication. *)
	Warning : BOOL;
	(* Synchronization indication; TRUE indicates motor running after polarity conversion. *)
	Sync : BOOL;
END_STRUCT
END_TYPE
