{attribute 'linkalways'}
{attribute 'qualified_only'}
(* Accumulation buffer occupancy and capacity. *)
VAR_GLOBAL
	(* Collects empty crates released from the packing stations. *)
	{attribute 'symbol' := 'readwrite'}
	Buffer_EmptyCrates : ST_Buffer;
	(* Holds rejected bottles for inspection and intervention. *)
	{attribute 'symbol' := 'readwrite'}
	Buffer_Rejects : ST_Buffer;
	(* Collects finished cases assigned to pallet lane 1. *)
	{attribute 'symbol' := 'readwrite'}
	Buffer_Pallet01 : ST_Buffer;
	(* Collects finished cases assigned to pallet lane 2. *)
	{attribute 'symbol' := 'readwrite'}
	Buffer_Pallet02 : ST_Buffer;
	(* Collects finished cases assigned to pallet lane 3. *)
	{attribute 'symbol' := 'readwrite'}
	Buffer_Pallet03 : ST_Buffer;
	(* Collects finished cases assigned to pallet lane 4. *)
	{attribute 'symbol' := 'readwrite'}
	Buffer_Pallet04 : ST_Buffer;
END_VAR
