{attribute 'qualified_only'}
(* Application encodings, not hardware addresses. *)
VAR_GLOBAL CONSTANT
	ConveyorZoneCapacity : INT := 128;
	RouteNone : INT := 0;
	RouteThrough : INT := 1;
	RouteLeft : INT := 2;
	RouteRight : INT := 3;
	ProductUnknown : INT := 0;
	ProductStill : INT := 1;
	ProductSparkling : INT := 2;
	ProductJuice : INT := 3;
END_VAR
