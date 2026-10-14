import type { ST_LineScannerInput } from "./ST_LineScannerInput.ts";
import type { ST_LineScannerOutput } from "./ST_LineScannerOutput.ts";

/*
Cognex DataMan 374X EtherNet/IP signals from input assembly 11 and output assembly 21. Input is reader-to-PLC; Output is PLC-to-reader.
These named fields are not packed assembly byte layouts. Map channels individually or decode/encode byte buffers, including reserved bytes and bit positions.
https://support.cognex.com/docs/dmst_2510/EN/Industrial_Protocols_Manual.pdf
*/
export interface ST_LineScanner {
  /* Reader-to-PLC signals from input assembly 11. */
  Input: ST_LineScannerInput;
  /* PLC-to-reader signals in output assembly 21. */
  Output: ST_LineScannerOutput;
}
