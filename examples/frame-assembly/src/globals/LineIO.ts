// biome-ignore-all lint/style/useConst: PLC VAR_GLOBAL storage is writable through InOut and external OPC UA publication.
import type { ST_LineAlarm } from "../types/ST_LineAlarm.ts";
import type { ST_LineButton } from "../types/ST_LineButton.ts";
import type { ST_LineConveyor } from "../types/ST_LineConveyor/ST_LineConveyor.ts";
import type { ST_LineDiverter } from "../types/ST_LineDiverter/ST_LineDiverter.ts";
import type { ST_LineEstop } from "../types/ST_LineEstop.ts";
import type { ST_LineLight } from "../types/ST_LineLight.ts";
import type { ST_LinePhotoeye } from "../types/ST_LinePhotoeye.ts";
import type { ST_LineScanner } from "../types/ST_LineScanner/ST_LineScanner.ts";

/* Conveyor line devices and operator controls. */
/* MDR driver card chain */
export let Conveyor_Inbound: ST_LineConveyor = defaultValue<ST_LineConveyor>();
/* MDR driver card chain */
export let Conveyor_Outbound: ST_LineConveyor = defaultValue<ST_LineConveyor>();
/* MDR driver card chain */
export let Conveyor_CarrierSorting: ST_LineConveyor = defaultValue<ST_LineConveyor>();
/* Cognex 374X for identifying over sized orders for diverter */
export let Scanner_Oversize: ST_LineScanner = defaultValue<ST_LineScanner>();
/* Cognex 374X for identifying canvas orders for diverter */
export let Scanner_Canvas: ST_LineScanner = defaultValue<ST_LineScanner>();
/* Cognex 374X for sending order data to framing station 1 or 2 */
export let Scanner_FramingPair01: ST_LineScanner = defaultValue<ST_LineScanner>();
/* Cognex 374X for sending order data to framing station 3 or 4 */
export let Scanner_FramingPair02: ST_LineScanner = defaultValue<ST_LineScanner>();
/* Cognex 374X for sending order data to framing station 5 or 6 */
export let Scanner_FramingPair03: ST_LineScanner = defaultValue<ST_LineScanner>();
/* Cognex 374X for sending order data to framing station 7 or 8 */
export let Scanner_FramingPair04: ST_LineScanner = defaultValue<ST_LineScanner>();
/* Cognex 374X for sending order data to framing station 9 or 10 */
export let Scanner_FramingPair05: ST_LineScanner = defaultValue<ST_LineScanner>();
/* Cognex 374X for sending order data to framing station 11 or 12 */
export let Scanner_FramingPair06: ST_LineScanner = defaultValue<ST_LineScanner>();
/* Cognex 374X for identifying empty bin for diverter */
export let Scanner_EmptyBinCollection: ST_LineScanner = defaultValue<ST_LineScanner>();
/* Cognex 374X for identifying QC flagged orders for diverter */
export let Scanner_QualityControl: ST_LineScanner = defaultValue<ST_LineScanner>();
/* Cognex 374X sending order data to shrink wrap station 1 */
export let Scanner_ShrinkWrap01: ST_LineScanner = defaultValue<ST_LineScanner>();
/* Cognex 374X sending order data to shrink wrap station 2 */
export let Scanner_ShrinkWrap02: ST_LineScanner = defaultValue<ST_LineScanner>();
/* Cognex 374X sending order data to bubble wrap station 1 */
export let Scanner_BubbleWrap01: ST_LineScanner = defaultValue<ST_LineScanner>();
/* Cognex 374X sending order data to bubble wrap station 2 */
export let Scanner_BubbleWrap02: ST_LineScanner = defaultValue<ST_LineScanner>();
/* Cognex 374X sending order data to boxing station 1 */
export let Scanner_Boxing01: ST_LineScanner = defaultValue<ST_LineScanner>();
/* Cognex 374X sending order data to boxing station 2 */
export let Scanner_Boxing02: ST_LineScanner = defaultValue<ST_LineScanner>();
/* Carrier reader before diverter 1. */
export let Scanner_Carrier01: ST_LineScanner = defaultValue<ST_LineScanner>();
/* Carrier reader before diverter 2. */
export let Scanner_Carrier02: ST_LineScanner = defaultValue<ST_LineScanner>();
/* Carrier reader before diverter 3. */
export let Scanner_Carrier03: ST_LineScanner = defaultValue<ST_LineScanner>();
/* Carrier reader before diverter 4. */
export let Scanner_Carrier04: ST_LineScanner = defaultValue<ST_LineScanner>();
/* Photo-eye used to for final back up dectection to prompt stopping of the diverter */
export let Photoeye_Oversize_BackupLimit: ST_LinePhotoeye = defaultValue<ST_LinePhotoeye>();
/* Photo-eye used for initial warning of backup of orders in oversized order direction */
export let Photoeye_Oversize_BackupWarning: ST_LinePhotoeye = defaultValue<ST_LinePhotoeye>();
/* Photo-eye used to for final back up dectection to prompt stopping of the diverter */
export let Photoeye_Canvas_BackupLimit: ST_LinePhotoeye = defaultValue<ST_LinePhotoeye>();
/* Photo-eye used for initial warning of backup of orders in canvas direction */
export let Photoeye_Canvas_BackupWarning: ST_LinePhotoeye = defaultValue<ST_LinePhotoeye>();
/* Photo-eye used for order detection at framing station 1 for Div_FS_1 */
export let Photoeye_Framing01_Presence: ST_LinePhotoeye = defaultValue<ST_LinePhotoeye>();
/* Photo-eye used for duration of divert at framing station 1 for Div_FS_1 */
export let Photoeye_Framing01_DivertFeedback: ST_LinePhotoeye = defaultValue<ST_LinePhotoeye>();
/* Photo-eye used for order detection at framing station 2 for Div_FS_1 */
export let Photoeye_Framing02_Presence: ST_LinePhotoeye = defaultValue<ST_LinePhotoeye>();
/* Photo-eye used for duration of divert at framing station 2 for Div_FS_1 */
export let Photoeye_Framing02_DivertFeedback: ST_LinePhotoeye = defaultValue<ST_LinePhotoeye>();
/* Photo-eye used for order detection at framing station 3 for Div_FS_2 */
export let Photoeye_Framing03_Presence: ST_LinePhotoeye = defaultValue<ST_LinePhotoeye>();
/* Photo-eye used for duration of divert at framing station 3 for Div_FS_2 */
export let Photoeye_Framing03_DivertFeedback: ST_LinePhotoeye = defaultValue<ST_LinePhotoeye>();
/* Photo-eye used for order detection at framing station 4 for Div_FS_2 */
export let Photoeye_Framing04_Presence: ST_LinePhotoeye = defaultValue<ST_LinePhotoeye>();
/* Photo-eye used for duration of divert at framing station 4 for Div_FS_2 */
export let Photoeye_Framing04_DivertFeedback: ST_LinePhotoeye = defaultValue<ST_LinePhotoeye>();
/* Photo-eye used for order detection at framing station 5 for Div_FS_3 */
export let Photoeye_Framing05_Presence: ST_LinePhotoeye = defaultValue<ST_LinePhotoeye>();
/* Photo-eye used for duration of divert at framing station 5 for Div_FS_3 */
export let Photoeye_Framing05_DivertFeedback: ST_LinePhotoeye = defaultValue<ST_LinePhotoeye>();
/* Photo-eye used for order detection at framing station 6 for Div_FS_3 */
export let Photoeye_Framing06_Presence: ST_LinePhotoeye = defaultValue<ST_LinePhotoeye>();
/* Photo-eye used for duration of divert at framing station 6 for Div_FS_3 */
export let Photoeye_Framing06_DivertFeedback: ST_LinePhotoeye = defaultValue<ST_LinePhotoeye>();
/* Photo-eye used for order detection at framing station 7 for Div_FS_4 */
export let Photoeye_Framing07_Presence: ST_LinePhotoeye = defaultValue<ST_LinePhotoeye>();
/* Photo-eye used for duration of divert at framing station 7 for Div_FS_4 */
export let Photoeye_Framing07_DivertFeedback: ST_LinePhotoeye = defaultValue<ST_LinePhotoeye>();
/* Photo-eye used for order detection at framing station 8 for Div_FS_4 */
export let Photoeye_Framing08_Presence: ST_LinePhotoeye = defaultValue<ST_LinePhotoeye>();
/* Photo-eye used for duration of divert at framing station 8 for Div_FS_4 */
export let Photoeye_Framing08_DivertFeedback: ST_LinePhotoeye = defaultValue<ST_LinePhotoeye>();
/* Photo-eye used for order detection at framing station 9 for Div_FS_5 */
export let Photoeye_Framing09_Presence: ST_LinePhotoeye = defaultValue<ST_LinePhotoeye>();
/* Photo-eye used for duration of divert at framing station 9 for Div_FS_5 */
export let Photoeye_Framing09_DivertFeedback: ST_LinePhotoeye = defaultValue<ST_LinePhotoeye>();
/* Photo-eye used for order detection at framing station 10 for Div_FS_5 */
export let Photoeye_Framing10_Presence: ST_LinePhotoeye = defaultValue<ST_LinePhotoeye>();
/* Photo-eye used for duration of divert at framing station 10 for Div_FS_5 */
export let Photoeye_Framing10_DivertFeedback: ST_LinePhotoeye = defaultValue<ST_LinePhotoeye>();
/* Photo-eye used for order detection at framing station 11 for Div_FS_6 */
export let Photoeye_Framing11_Presence: ST_LinePhotoeye = defaultValue<ST_LinePhotoeye>();
/* Photo-eye used for duration of divert at framing station 11 for Div_FS_6 */
export let Photoeye_Framing11_DivertFeedback: ST_LinePhotoeye = defaultValue<ST_LinePhotoeye>();
/* Photo-eye used for order detection at framing station 12 for Div_FS_6 */
export let Photoeye_Framing12_Presence: ST_LinePhotoeye = defaultValue<ST_LinePhotoeye>();
/* Photo-eye used for duration of divert at framing station 12 for Div_FS_6 */
export let Photoeye_Framing12_DivertFeedback: ST_LinePhotoeye = defaultValue<ST_LinePhotoeye>();
/* Diverts oversized orders left. */
export let Diverter_Oversize: ST_LineDiverter = defaultValue<ST_LineDiverter>();
/* Diverts canvas orders left. */
export let Diverter_Canvas: ST_LineDiverter = defaultValue<ST_LineDiverter>();
/* Diverts orders between framing stations 1 and 2 */
export let Diverter_FramingPair01: ST_LineDiverter = defaultValue<ST_LineDiverter>();
/* Diverts orders between framing stations 3 and 4 */
export let Diverter_FramingPair02: ST_LineDiverter = defaultValue<ST_LineDiverter>();
/* Diverts orders between framing stations 5 and 6 */
export let Diverter_FramingPair03: ST_LineDiverter = defaultValue<ST_LineDiverter>();
/* Diverts orders between framing stations 7 and 8 */
export let Diverter_FramingPair04: ST_LineDiverter = defaultValue<ST_LineDiverter>();
/* Diverts orders between framing stations 9 and 10 */
export let Diverter_FramingPair05: ST_LineDiverter = defaultValue<ST_LineDiverter>();
/* Diverts orders between framing stations 11 and 12 */
export let Diverter_FramingPair06: ST_LineDiverter = defaultValue<ST_LineDiverter>();
/* Diverts empty bins right; normal orders and QC work continue straight. */
export let Diverter_EmptyBinCollection: ST_LineDiverter = defaultValue<ST_LineDiverter>();
/* Diverts orders flagged QC right and passes through all others */
export let Diverter_QualityControl: ST_LineDiverter = defaultValue<ST_LineDiverter>();
/* Alternates through to finishing lane 1 and left to finishing lane 2. */
export let Diverter_ShrinkWrapLoadBalancer: ST_LineDiverter = defaultValue<ST_LineDiverter>();
/* Diverts all right */
export let Diverter_ShrinkWrap01: ST_LineDiverter = defaultValue<ST_LineDiverter>();
/* Diverts carrier 1 right; passes through all others. */
export let Diverter_Carrier01: ST_LineDiverter = defaultValue<ST_LineDiverter>();
/* Diverts carrier 2 left and carrier 3 right; passes through all others. */
export let Diverter_Carrier02: ST_LineDiverter = defaultValue<ST_LineDiverter>();
/* Diverts carrier 4 left and carrier 5 right; passes through all others. */
export let Diverter_Carrier03: ST_LineDiverter = defaultValue<ST_LineDiverter>();
/* Diverts carrier 6 left and carrier 7 right; passes through all others. */
export let Diverter_Carrier04: ST_LineDiverter = defaultValue<ST_LineDiverter>();
/* Push button for overall system activation */
export let Button_SystemStart01: ST_LineButton = defaultValue<ST_LineButton>();
/* Push button for overall system activation */
export let Button_SystemStart02: ST_LineButton = defaultValue<ST_LineButton>();
/* Push button for overall system activation */
export let Button_SystemStart03: ST_LineButton = defaultValue<ST_LineButton>();
/* Push button for overall system deactivation */
export let Button_SystemStop01: ST_LineButton = defaultValue<ST_LineButton>();
/* Push button for overall system deactivation */
export let Button_SystemStop02: ST_LineButton = defaultValue<ST_LineButton>();
/* Push button for overall system deactivation */
export let Button_SystemStop03: ST_LineButton = defaultValue<ST_LineButton>();
/* Emergency stop for system */
export let EmergencyStop01: ST_LineEstop = defaultValue<ST_LineEstop>();
/* Emergency stop for system */
export let EmergencyStop02: ST_LineEstop = defaultValue<ST_LineEstop>();
/* Emergency stop for system */
export let EmergencyStop03: ST_LineEstop = defaultValue<ST_LineEstop>();
/* Stack light for overall system status */
export let StackLight_System01: ST_LineLight = defaultValue<ST_LineLight>();
/* Stack light for overall system status */
export let StackLight_System02: ST_LineLight = defaultValue<ST_LineLight>();
/* Stack light for overall system status */
export let StackLight_System03: ST_LineLight = defaultValue<ST_LineLight>();
/* Alarm rings briefly as conveyor system activates, connected to stack light */
export let Alarm_SystemStartup: ST_LineAlarm = defaultValue<ST_LineAlarm>();
