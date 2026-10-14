import { wrapAdd } from "@tsplc/compiler/types";
import * as Diagnostics from "./Diagnostics.ts";

/* Runs in HeartbeatTask. It owns Diagnostics, so no state crosses tasks. */
export function heartbeat(): void {
  Diagnostics.Watchdog.Ticks = wrapAdd<UDINT>(Diagnostics.Watchdog.Ticks, 1);
  Diagnostics.Watchdog.Alive = !Diagnostics.Watchdog.Alive;
}
