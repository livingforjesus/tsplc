(*
Chain status and individual zone controls and feedback for a motor-driven roller conveyor.
*)
TYPE ST_ConveyorStatus :
STRUCT
	(* FALSE until the owning PLC logic supplies a current status; FALSE on stale or unavailable inputs. *)
	Valid : BOOL;
	(* All assigned I/O transports exchanging current data. Does not prove power or wiring at each zone. *)
	Connected : BOOL;
	(* At least one configured equipment fault is active. Interpret FALSE only with FaultFeedbackValid. *)
	Faulted : BOOL;
	(* All required chain fault observations are assigned and current. *)
	FaultFeedbackValid : BOOL;
	(* At least one configured roller reports running, based on feedback rather than control outputs. *)
	Running : BOOL;
	(* All required chain running observations are assigned and current. Leave FALSE if unavailable. *)
	RunningFeedbackValid : BOOL;
END_STRUCT
END_TYPE
