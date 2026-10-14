import { controller } from "./controller.ts";
import { simulator } from "./simulator.ts";

// Preserve the upstream cyclic task's controller-before-simulator program order.
export function main(): void {
  controller();
  simulator();
}
