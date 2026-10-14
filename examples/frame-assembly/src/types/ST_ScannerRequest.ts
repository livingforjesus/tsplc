import type { E_LineDiverter } from "./E_LineDiverter.ts";
import type { ST_LineDiverterRouting } from "./ST_LineDiverter/ST_LineDiverterRouting.ts";

export interface ST_ScannerRequest {
  /* PLC-owned context copied with the barcode. */
  ConveyorId: INT;
  DiverterId: E_LineDiverter;
  /* PLC-owned. Barcode and BarcodeLength stay unchanged while TRUE. */
  RequestReady: BOOL;
  Barcode: FixedArray<BYTE, 484>;
  /* Only these bytes belong to the barcode; trailing bytes are unspecified. */
  BarcodeLength: UINT;
  /* Worker-owned. Set after writing RoutingResult; clear after RequestReady clears. */
  ResultReady: BOOL;
  /* Apply only at the matching diverter; other readers still complete the handshake. */
  ApplyRouting: BOOL;
  RoutingResult: ST_LineDiverterRouting;
}
