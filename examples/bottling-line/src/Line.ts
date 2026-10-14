import type { ST_Conveyor } from "./types/ST_Conveyor.ts";
import type { ST_Filler } from "./types/ST_Filler.ts";
import type { ST_LineStatus } from "./types/ST_LineStatus.ts";
import type { ST_Reader } from "./types/ST_Reader.ts";

/*
Line devices. tsplc.config.ts binds fields of these globals directly to EDS
channels, e.g. "Line.Filler.Valves[1].Open"; the list is published over OPC UA.
*/
export let Status: ST_LineStatus = defaultValue<ST_LineStatus>();
export let Infeed: ST_Conveyor = defaultValue<ST_Conveyor>();
export let Reader: ST_Reader = defaultValue<ST_Reader>();
export let Filler: ST_Filler = defaultValue<ST_Filler>();
