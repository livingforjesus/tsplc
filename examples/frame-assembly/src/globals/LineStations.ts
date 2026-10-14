// biome-ignore-all lint/style/useConst: PLC VAR_GLOBAL storage is writable through InOut and external OPC UA publication.
import type { ST_LineStation } from "../types/ST_LineStation.ts";

/* Operator station work, queues, and incoming reservations. */
/* Framing station 1: receives picking bins and releases individually assembled orders. */
export let Station_Framing01: ST_LineStation = { Enabled: false, Capacity: 2, QueueFull: false };
/* Framing station 2: receives picking bins and releases individually assembled orders. */
export let Station_Framing02: ST_LineStation = { Enabled: false, Capacity: 2, QueueFull: false };
/* Framing station 3: receives picking bins and releases individually assembled orders. */
export let Station_Framing03: ST_LineStation = { Enabled: false, Capacity: 2, QueueFull: false };
/* Framing station 4: receives picking bins and releases individually assembled orders. */
export let Station_Framing04: ST_LineStation = { Enabled: false, Capacity: 2, QueueFull: false };
/* Framing station 5: receives picking bins and releases individually assembled orders. */
export let Station_Framing05: ST_LineStation = { Enabled: false, Capacity: 2, QueueFull: false };
/* Framing station 6: receives picking bins and releases individually assembled orders. */
export let Station_Framing06: ST_LineStation = { Enabled: false, Capacity: 2, QueueFull: false };
/* Framing station 7: receives picking bins and releases individually assembled orders. */
export let Station_Framing07: ST_LineStation = { Enabled: false, Capacity: 2, QueueFull: false };
/* Framing station 8: receives picking bins and releases individually assembled orders. */
export let Station_Framing08: ST_LineStation = { Enabled: false, Capacity: 2, QueueFull: false };
/* Framing station 9: receives picking bins and releases individually assembled orders. */
export let Station_Framing09: ST_LineStation = { Enabled: false, Capacity: 2, QueueFull: false };
/* Framing station 10: receives picking bins and releases individually assembled orders. */
export let Station_Framing10: ST_LineStation = { Enabled: false, Capacity: 2, QueueFull: false };
/* Framing station 11: receives picking bins and releases individually assembled orders. */
export let Station_Framing11: ST_LineStation = { Enabled: false, Capacity: 2, QueueFull: false };
/* Framing station 12: receives picking bins and releases individually assembled orders. */
export let Station_Framing12: ST_LineStation = { Enabled: false, Capacity: 2, QueueFull: false };
/* Receives oversized orders for assembly and packaging. */
export let Station_Oversize: ST_LineStation = { Enabled: false, Capacity: 2, QueueFull: false };
/* Receives canvas orders for operator processing. */
export let Station_Canvas: ST_LineStation = { Enabled: false, Capacity: 2, QueueFull: false };
