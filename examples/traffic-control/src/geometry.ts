import { exact, type BOOL, type DINT } from "@vplc/compiler/types";
import type { SpriteOutputs } from "./sprite.ts";
import type { SpriteDef_typ } from "./types.ts";

// Snapshot the original block outputs and definitions. Edge sums remain native
// wide temporaries: only assignments back into INT sprite storage wrap.
export function isSpriteColliding(
  sprite1: SpriteOutputs,
  init1: SpriteDef_typ,
  sprite2: SpriteOutputs,
  init2: SpriteDef_typ,
): BOOL {
  return (
    exact<DINT>(sprite1.actX) < exact<DINT>(sprite2.actX) + exact<DINT>(init2.width) &&
    exact<DINT>(sprite1.actX) + exact<DINT>(init1.width) > exact<DINT>(sprite2.actX) &&
    exact<DINT>(sprite1.actY) < exact<DINT>(sprite2.actY) + exact<DINT>(init2.height) &&
    exact<DINT>(init1.height) + exact<DINT>(sprite1.actY) > exact<DINT>(sprite2.actY)
  );
}
