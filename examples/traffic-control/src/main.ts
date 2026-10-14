import { controller } from "./controller.ts";
import { simulator } from "./simulator.ts";

// Original task order: the controller runs before the complete simulator.
export function main(): void {
  controller();
  simulator();
}
