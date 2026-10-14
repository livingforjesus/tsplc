/* One filling head. Open is wired to a remote IO output. */
export interface ST_Valve {
  Open: BOOL;
  /* Bottles filled by this head since the last controller reset. */
  Fills: UDINT;
}
