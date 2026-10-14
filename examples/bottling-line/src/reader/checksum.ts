import { exact, wrap, wrapAdd } from "@tsplc/compiler/types";

/* Sum of the first `length` bytes, modulo 256. */
export function checksum(data: FixedArray<BYTE, 480>, length: UINT): BYTE {
  let total: UDINT = 0;
  for (let index: UINT = 0; index < 480; index++) {
    if (index >= length) {
      break;
    }
    total = wrapAdd<UDINT>(total, exact<UDINT>(data[index]));
  }
  return wrap<BYTE>(total);
}
