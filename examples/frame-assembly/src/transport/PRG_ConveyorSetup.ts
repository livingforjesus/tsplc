import * as LineIO from "../globals/LineIO.ts";
import { FB_LineConveyor } from "./FB_LineConveyor/FB_LineConveyor.ts";

const Inbound = new FB_LineConveyor();
const Outbound = new FB_LineConveyor();
const CarrierSorting = new FB_LineConveyor();
let ConveyorStarted: BOOL = false;
let StartPressed: BOOL = false;
let StartArmed: BOOL = false;
let StopPressed: BOOL = false;
let EmergencyStopPressed: BOOL = false;

export function PRG_ConveyorSetup(): void {
  StartPressed =
    LineIO.Button_SystemStart01.Pressed ||
    LineIO.Button_SystemStart02.Pressed ||
    LineIO.Button_SystemStart03.Pressed;
  StopPressed =
    LineIO.Button_SystemStop01.Pressed ||
    LineIO.Button_SystemStop02.Pressed ||
    LineIO.Button_SystemStop03.Pressed;
  EmergencyStopPressed =
    !LineIO.EmergencyStop01.Valid ||
    !LineIO.EmergencyStop02.Valid ||
    !LineIO.EmergencyStop03.Valid ||
    LineIO.EmergencyStop01.Pressed ||
    LineIO.EmergencyStop02.Pressed ||
    LineIO.EmergencyStop03.Pressed;

  /* A stop disarms start; the button must be released and pressed again after the stop clears. */
  if (StopPressed || EmergencyStopPressed) {
    ConveyorStarted = false;
    StartArmed = false;
  } else if (!StartPressed) {
    StartArmed = true;
  } else if (StartArmed) {
    ConveyorStarted = true;
    StartArmed = false;
  }

  /* Transport cards require SW2-6 OFF: Stop asserts accumulation holds; Start clears them for native ZPA. */
  Inbound.update({
    Conveyor: ref(LineIO.Conveyor_Inbound),
    CardCount: 113,
    Enabled: ConveyorStarted,
  });
  Outbound.update({
    Conveyor: ref(LineIO.Conveyor_Outbound),
    CardCount: 68,
    Enabled: ConveyorStarted,
  });
  CarrierSorting.update({
    Conveyor: ref(LineIO.Conveyor_CarrierSorting),
    CardCount: 25,
    Enabled: ConveyorStarted,
  });
}
