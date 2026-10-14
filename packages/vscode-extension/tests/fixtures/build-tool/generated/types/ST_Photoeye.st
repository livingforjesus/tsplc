(*
Detection and alarm signals from a photoelectric proximity sensor.
*)
TYPE ST_Photoeye :
STRUCT
	(* Object-detection output (PNP). *)
	Detection : BOOL;
	(* Sensor alarm output. *)
	Alarm : BOOL;
END_STRUCT
END_TYPE
