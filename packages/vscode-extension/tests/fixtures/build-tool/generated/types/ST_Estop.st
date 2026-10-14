(*
Supervisory emergency-stop indication for all conveyor and sorter movement. Motion requires a separate start after the stop is cleared.
*)
TYPE ST_Estop :
STRUCT
	(* FALSE until the owning PLC logic supplies a current status; FALSE on stale or unavailable inputs. *)
	Valid : BOOL;
	(* Observed global conveyor/sorter stop demand. Clearing it does not restart motion; a separate start is required. FALSE with invalid data does not indicate permission to run. *)
	Pressed : BOOL;
END_STRUCT
END_TYPE
