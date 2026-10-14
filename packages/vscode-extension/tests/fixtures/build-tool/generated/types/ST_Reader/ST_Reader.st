(*
Fixed-mount barcode reader EtherNet/IP signals from input assembly 11 and output assembly 21. Input is reader-to-PLC; Output is PLC-to-reader.
*)
TYPE ST_Reader :
STRUCT
	(* Reader-to-PLC signals from input assembly 11. *)
	Input : ST_ReaderInput;
	(* PLC-to-reader signals in output assembly 21. *)
	Output : ST_ReaderOutput;
END_STRUCT
END_TYPE
