import type { E_LineCarrier } from "../E_LineCarrier.ts";
import type { E_LineStation } from "../E_LineStation.ts";

/* One scanned payload and its routing decision. No electrical outputs. */
export interface ST_LineDiverterRouting {
  /* Barcode associated with this lookup, including a straight-through result. */
  Barcode: STRING<80>;
  /* Outbound barcode identifies a reusable conveyor bin for collection. */
  EmptyBin: BOOL;
  /* Scanned order has an unresolved QC issue. */
  HasQC: BOOL;
  /* Assigned station identity. Direction is resolved by configured port mapping. */
  TargetStation: E_LineStation;
  /* Printed shipping label destination; Unknown passes through. */
  TargetCarrier: E_LineCarrier;
}
