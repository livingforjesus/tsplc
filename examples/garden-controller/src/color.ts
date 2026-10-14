import { type BYTE, type DWORD, exact } from "@vplc/compiler/types";

export function BYTES_TO_DWORD(B0: BYTE, B1: BYTE, B2: BYTE, B3: BYTE): DWORD {
  // The original individual bit assignments pack B0 least significant through B3.
  return (
    exact<DWORD>(B0) | (exact<DWORD>(B1) << 8) | (exact<DWORD>(B2) << 16) | (exact<DWORD>(B3) << 24)
  );
}
