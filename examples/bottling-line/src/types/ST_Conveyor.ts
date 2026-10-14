/* Infeed conveyor zone driven by a ConveyLinx module. */
export interface ST_Conveyor {
  /* Raw upstream zone status, shown on the HMI. The module reports it as UINT. */
  Status: WORD;
  /* Speed command for the current recipe; zero holds the bottles. */
  Speed: UINT;
}
