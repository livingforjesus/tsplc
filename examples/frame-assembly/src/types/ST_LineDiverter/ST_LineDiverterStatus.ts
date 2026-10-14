/* PLC transfer observations, not controller registers or proof of physical I/O health. */
export interface ST_LineDiverterStatus {
  /* Applied command: 0=hold, 1=through, 2=left, 3=right. Chosen once when occupied and ready; retained until departure. */
  SelectedDirection: INT;
}
