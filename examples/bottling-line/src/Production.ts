import type { ST_Counters } from "./types/ST_Counters.ts";

/* Retained: the totals keep their values across a warm restart of the controller. */
export let Counters: ST_Counters = retain(defaultValue<ST_Counters>());
