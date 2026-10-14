import type { ST_LineStation } from "../types/ST_LineStation.ts";

/** Recheck physical admission; the scanner reply already owns a backend reservation. */
export function F_StationAvailable(Station: ST_LineStation): BOOL {
  return Station.Enabled && !Station.QueueFull && Station.Capacity > 0;
}
