// biome-ignore-all lint/style/useConst: PLC VAR_GLOBAL storage is writable through InOut and external OPC UA publication.
import type { ST_ScannerRequest } from "../types/ST_ScannerRequest.ts";

/* One outstanding routing lookup per reader. */
export let Oversize: ST_ScannerRequest = defaultValue<ST_ScannerRequest>();
export let Canvas: ST_ScannerRequest = defaultValue<ST_ScannerRequest>();
export let FramingPair01: ST_ScannerRequest = defaultValue<ST_ScannerRequest>();
export let FramingPair02: ST_ScannerRequest = defaultValue<ST_ScannerRequest>();
export let FramingPair03: ST_ScannerRequest = defaultValue<ST_ScannerRequest>();
export let FramingPair04: ST_ScannerRequest = defaultValue<ST_ScannerRequest>();
export let FramingPair05: ST_ScannerRequest = defaultValue<ST_ScannerRequest>();
export let FramingPair06: ST_ScannerRequest = defaultValue<ST_ScannerRequest>();
export let EmptyBinCollection: ST_ScannerRequest = defaultValue<ST_ScannerRequest>();
export let QualityControl: ST_ScannerRequest = defaultValue<ST_ScannerRequest>();
export let Carrier01: ST_ScannerRequest = defaultValue<ST_ScannerRequest>();
export let Carrier02: ST_ScannerRequest = defaultValue<ST_ScannerRequest>();
export let Carrier03: ST_ScannerRequest = defaultValue<ST_ScannerRequest>();
export let Carrier04: ST_ScannerRequest = defaultValue<ST_ScannerRequest>();
