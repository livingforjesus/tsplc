/* Heartbeat published by the slow task so host clients can see the PLC is alive. */
export interface ST_Watchdog {
  Ticks: UDINT;
  Alive: BOOL;
}
