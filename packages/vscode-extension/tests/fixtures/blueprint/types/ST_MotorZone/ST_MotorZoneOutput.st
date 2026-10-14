(*
Control signals and feedback for one 24 V motor-driven roller zone controller.
*)
TYPE ST_MotorZoneOutput :
STRUCT
	(* Run signal according to the configured zone mode. TRUE can force run or hold accumulation; FALSE can release accumulation. *)
	MotionAsserted : BOOL;
	(* Role depends on zone mode. Do not interpret as left/right sorter routing. *)
	DirectionOrSlaveErrorAsserted : BOOL;
	(* Optional speed reference in 0..10 V. Not metres/second and not a 4..20 mA signal. *)
	SpeedVolts : LREAL;
END_STRUCT
END_TYPE
