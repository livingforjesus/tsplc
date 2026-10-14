import {
  copy,
  defaultValue,
  exact,
  FunctionBlock,
  wrapAdd,
  wrapSubtract,
  type BOOL,
  type FixedArray,
  type INT,
  type DINT,
} from "@vplc/compiler/types";
import type { SpriteDef_typ } from "./types.ts";

export interface SpriteInputs {
  init: SpriteDef_typ;
  goTo: FixedArray<INT, 2>;
  moveX: INT;
  moveY: INT;
}
export interface SpriteOutputs {
  x: INT;
  y: INT;
  atDestination: BOOL;
  actX: INT;
  actY: INT;
}

export class Sprite extends FunctionBlock<SpriteInputs, SpriteOutputs> {
  private vInit: BOOL = true;
  private vSpriteDef: SpriteDef_typ = defaultValue<SpriteDef_typ>();

  protected execute(input: SpriteInputs): SpriteOutputs {
    // Only the first update initializes the persistent sprite position.
    if (this.vInit) {
      this.vSpriteDef = copy(input.init);
      this.vInit = false;
    }
    this.vSpriteDef.x = wrapAdd<INT>(this.vSpriteDef.x, input.moveX);
    this.vSpriteDef.y = wrapAdd<INT>(this.vSpriteDef.y, input.moveY);

    if (this.vSpriteDef.x > this.vSpriteDef.screenWidth) {
      this.vSpriteDef.x = wrapSubtract<INT>(0, this.vSpriteDef.width);
    } else if (exact<DINT>(this.vSpriteDef.x) < 0 - exact<DINT>(this.vSpriteDef.width)) {
      this.vSpriteDef.x = this.vSpriteDef.screenWidth;
    }
    if (this.vSpriteDef.y > this.vSpriteDef.screenHeight) {
      this.vSpriteDef.y = wrapSubtract<INT>(0, this.vSpriteDef.height);
    } else if (exact<DINT>(this.vSpriteDef.y) < 0 - exact<DINT>(this.vSpriteDef.height)) {
      this.vSpriteDef.y = this.vSpriteDef.screenHeight;
    }

    // goTo is unused upstream; atDestination retains its public FALSE default.
    return {
      x: wrapSubtract<INT>(this.vSpriteDef.x, input.init.x),
      y: wrapSubtract<INT>(this.vSpriteDef.y, input.init.y),
      atDestination: false,
      actX: this.vSpriteDef.x,
      actY: this.vSpriteDef.y,
    };
  }
}
