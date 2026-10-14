// biome-ignore-all lint/style/useConst: PLC VAR_GLOBAL storage is writable through InOut and external OPC UA publication.
import type { ST_LineCollection } from "../types/ST_LineCollection.ts";

/* Empty-bin and QC collection full-sensor inputs. */
/* Collects empty bins released from framing stations. */
export let Collection_EmptyBins: ST_LineCollection = { Full: true };
/* Holds QC work for inspection and intervention. */
export let Collection_QualityControl: ST_LineCollection = { Full: true };
