TYPE ST_Conveyor :
STRUCT
	CardCount : UINT;
	Cards : ARRAY[1..128] OF ST_Card;
END_STRUCT
END_TYPE
