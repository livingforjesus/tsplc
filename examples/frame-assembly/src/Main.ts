import { PRG_Diverters } from "./diverters/PRG_Diverters.ts";
import { PRG_LineScanners } from "./scanners/PRG_LineScanners.ts";
import { PRG_ConveyorSetup } from "./transport/PRG_ConveyorSetup.ts";

export function main(): void {
  PRG_ConveyorSetup();
  PRG_LineScanners();
  PRG_Diverters();
}
