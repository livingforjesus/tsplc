(*
Zone controls, routing context, and transfer status for a two-zone right-angle sorter.
*)
TYPE ST_SorterRouting :
STRUCT
	(* 0=unknown; 1..4=configured pallet lane. Unknown must hold. *)
	PalletLane : INT;
	(* Identity to which the requested route applies. *)
	CommandPayload : STRING(80);
	(* PlantConstants.Product*: 0=unknown, 1=still, 2=sparkling, 3=juice. *)
	ProductType : INT;
	(* Payload is a crate with no remaining bottles. *)
	EmptyCrate : BOOL;
	(* Payload requires inspection before release. *)
	NeedsInspection : BOOL;
	(* Derived from receiving sensors, enable state, and reservations; not a reader observation. *)
	ReceivingAvailable : BOOL;
	(* Assigned station identity. Direction is resolved by configured port mapping. *)
	TargetStation : STRING(80);
END_STRUCT
END_TYPE
