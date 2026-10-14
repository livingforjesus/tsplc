TYPE ST_Conveyor :
STRUCT
	ZoneCount : UINT;
	Zones : ARRAY[1..128] OF ST_Zone;
END_STRUCT
END_TYPE
