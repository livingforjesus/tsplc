(*
Pushbutton pressed state and input validity.
*)
TYPE ST_Button :
STRUCT
	(* FALSE until the owning PLC logic supplies a current status; FALSE on stale or unavailable inputs. *)
	Valid : BOOL;
	(* TRUE while pressed; not an automatically repeating request. *)
	Pressed : BOOL;
END_STRUCT
END_TYPE
