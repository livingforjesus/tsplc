/* Physical admission inputs and station configuration. Reservations belong to the bridge. */
export interface ST_LineStation {
  Enabled: BOOL;
  Capacity: UINT;
  /* Physical queue-full sensor; independent of backend reservations. */
  QueueFull: BOOL;
}
