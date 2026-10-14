{attribute 'linkalways'}
{attribute 'qualified_only'}
(* Operator station work, queues, and incoming reservations. *)
VAR_GLOBAL
	(* Filler 1: receives empty bottles and releases filled bottles. *)
	{attribute 'symbol' := 'readwrite'}
	Station_Filler01 : ST_Station;
	(* Filler 2: receives empty bottles and releases filled bottles. *)
	{attribute 'symbol' := 'readwrite'}
	Station_Filler02 : ST_Station;
	(* Filler 3: receives empty bottles and releases filled bottles. *)
	{attribute 'symbol' := 'readwrite'}
	Station_Filler03 : ST_Station;
	(* Filler 4: receives empty bottles and releases filled bottles. *)
	{attribute 'symbol' := 'readwrite'}
	Station_Filler04 : ST_Station;
	(* Filler 5: receives empty bottles and releases filled bottles. *)
	{attribute 'symbol' := 'readwrite'}
	Station_Filler05 : ST_Station;
	(* Filler 6: receives empty bottles and releases filled bottles. *)
	{attribute 'symbol' := 'readwrite'}
	Station_Filler06 : ST_Station;
	(* Filler 7: receives empty bottles and releases filled bottles. *)
	{attribute 'symbol' := 'readwrite'}
	Station_Filler07 : ST_Station;
	(* Filler 8: receives empty bottles and releases filled bottles. *)
	{attribute 'symbol' := 'readwrite'}
	Station_Filler08 : ST_Station;
	(* Filler 9: receives empty bottles and releases filled bottles. *)
	{attribute 'symbol' := 'readwrite'}
	Station_Filler09 : ST_Station;
	(* Filler 10: receives empty bottles and releases filled bottles. *)
	{attribute 'symbol' := 'readwrite'}
	Station_Filler10 : ST_Station;
	(* Filler 11: receives empty bottles and releases filled bottles. *)
	{attribute 'symbol' := 'readwrite'}
	Station_Filler11 : ST_Station;
	(* Filler 12: receives empty bottles and releases filled bottles. *)
	{attribute 'symbol' := 'readwrite'}
	Station_Filler12 : ST_Station;
	(* Receives oversized containers for manual filling. *)
	{attribute 'symbol' := 'readwrite'}
	Station_LargeFormat : ST_Station;
	(* Receives sample bottles for laboratory checks. *)
	{attribute 'symbol' := 'readwrite'}
	Station_Sampling : ST_Station;
	(* Capper 1: applies and torques a cap on each bottle. *)
	{attribute 'symbol' := 'readwrite'}
	Station_Capper01 : ST_Station;
	(* Capper 2: applies and torques a cap on each bottle. *)
	{attribute 'symbol' := 'readwrite'}
	Station_Capper02 : ST_Station;
	(* Labeler 1: applies the front and back labels while preserving the lot code. *)
	{attribute 'symbol' := 'readwrite'}
	Station_Labeler01 : ST_Station;
	(* Labeler 2: applies the front and back labels while preserving the lot code. *)
	{attribute 'symbol' := 'readwrite'}
	Station_Labeler02 : ST_Station;
	(* Case packer 1: packs bottles into cases and completes the case label. *)
	{attribute 'symbol' := 'readwrite'}
	Station_CasePacker01 : ST_Station;
	(* Case packer 2: packs bottles into cases and completes the case label. *)
	{attribute 'symbol' := 'readwrite'}
	Station_CasePacker02 : ST_Station;
END_VAR
