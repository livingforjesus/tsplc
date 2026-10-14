import type { ST_Watchdog } from "./types/ST_Watchdog.ts";

/* Owned by the heartbeat program in the slow task. */
export let Watchdog: ST_Watchdog = defaultValue<ST_Watchdog>();
