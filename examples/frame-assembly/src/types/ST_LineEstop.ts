/*
Supervisory emergency-stop indication for all conveyor and diverter movement. Motion requires a separate start after the stop is cleared.
*/
export interface ST_LineEstop {
  /* FALSE until the owning PLC logic supplies a current status; FALSE on stale or unavailable inputs. */
  Valid: BOOL;
  /* Observed global conveyor/diverter stop demand. Clearing it does not restart motion; a separate start is required. FALSE with invalid data does not indicate permission to run. */
  Pressed: BOOL;
}
