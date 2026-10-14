import type { ST_LineCS1001 } from "../ST_LineCS1001/ST_LineCS1001.ts";
import type { ST_LineLift } from "../ST_LineLift/ST_LineLift.ts";
import type { ST_LineDiverterRouting } from "./ST_LineDiverterRouting.ts";
import type { ST_LineDiverterStatus } from "./ST_LineDiverterStatus.ts";

/* Two CS1001 cards are confirmed for each diverter. Verify their motor assignments and pin mapping during assembly. */
export interface ST_LineDiverter {
  ThroughDrive: ST_LineCS1001;
  TransferDrive: ST_LineCS1001;
  /* Normalized bin occupancy input; confirm sensor coverage across the full transfer. */
  BinPresent: BOOL;
  Lift: ST_LineLift;
  /* Transfer sequence observations; these are not CS1001 registers. */
  Status: ST_LineDiverterStatus;
  /* Lookup result used directly for the next payload; unchanged until that payload leaves. */
  Route: ST_LineDiverterRouting;
  /* TRUE from lookup completion through departure, including a pass-through/no-read decision. */
  RouteReady: BOOL;
}
