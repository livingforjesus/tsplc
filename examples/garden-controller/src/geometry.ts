import { type BOOL, type DINT, exact, type INT } from "@vplc/compiler/types";

export function checkOverlapRectangle(
  R1_X: INT,
  R1_Y: INT,
  R1_W: INT,
  R1_H: INT,
  R2_X: INT,
  R2_Y: INT,
  R2_W: INT,
  R2_H: INT,
): BOOL {
  // Native edge sums remain wide until a storage/input assignment truncates.
  return (
    exact<DINT>(R1_X) < exact<DINT>(R2_X) + exact<DINT>(R2_W) &&
    exact<DINT>(R1_X) + exact<DINT>(R1_W) > exact<DINT>(R2_X) &&
    exact<DINT>(R1_Y) < exact<DINT>(R2_Y) + exact<DINT>(R2_H) &&
    exact<DINT>(R1_H) + exact<DINT>(R1_Y) > exact<DINT>(R2_Y)
  );
}
