import { defaultValue, type INT } from "@vplc/compiler/types";
import { Sprite } from "./sprite.ts";
import type { SpriteDef_typ } from "./types.ts";

// These are the authored per-instance initial values from the PLCopen export.
export const definitions: {
  carC1HR: SpriteDef_typ;
  carC1HL: SpriteDef_typ;
  carC1VU: SpriteDef_typ;
  carC1VD: SpriteDef_typ;
  carC2VU: SpriteDef_typ;
  carC2VD: SpriteDef_typ;
  pedC1VU: SpriteDef_typ;
  pedC1VD: SpriteDef_typ;
  pedC2VU: SpriteDef_typ;
  pedC2VD: SpriteDef_typ;
  pedC1HL: SpriteDef_typ;
  pedC2HR: SpriteDef_typ;
} = {
  carC1HR: {
    x: 568,
    y: 264,
    speed: 0,
    width: 200,
    height: 80,
    screenWidth: 1980,
    screenHeight: 720,
  },
  carC1HL: {
    x: -50,
    y: 370,
    speed: 0,
    width: 200,
    height: 80,
    screenWidth: 1980,
    screenHeight: 720,
  },
  carC1VU: {
    x: 270,
    y: -50,
    speed: 0,
    width: 80,
    height: 200,
    screenWidth: 1980,
    screenHeight: 720,
  },
  carC1VD: {
    x: 372,
    y: 565,
    speed: 0,
    width: 80,
    height: 200,
    screenWidth: 1980,
    screenHeight: 720,
  },
  carC2VU: {
    x: 1528,
    y: -50,
    speed: 0,
    width: 80,
    height: 200,
    screenWidth: 1980,
    screenHeight: 720,
  },
  carC2VD: {
    x: 1631,
    y: 580,
    speed: 0,
    width: 80,
    height: 200,
    screenWidth: 1980,
    screenHeight: 720,
  },
  pedC1VU: {
    x: 171,
    y: 7,
    speed: 0,
    width: 50,
    height: 50,
    screenWidth: 1980,
    screenHeight: 720,
  },
  pedC1VD: {
    x: 486,
    y: 657,
    speed: 0,
    width: 50,
    height: 50,
    screenWidth: 1980,
    screenHeight: 720,
  },
  pedC2VU: {
    x: 1427,
    y: 2,
    speed: 0,
    width: 50,
    height: 50,
    screenWidth: 1980,
    screenHeight: 720,
  },
  pedC2VD: {
    x: 1742,
    y: 654,
    speed: 0,
    width: 50,
    height: 50,
    screenWidth: 1980,
    screenHeight: 720,
  },
  pedC1HL: {
    x: 9,
    y: 491,
    speed: 0,
    width: 50,
    height: 50,
    screenWidth: 1980,
    screenHeight: 720,
  },
  pedC2HR: {
    x: 1916,
    y: 174,
    speed: 0,
    width: 50,
    height: 50,
    screenWidth: 1980,
    screenHeight: 720,
  },
};

export const carC1HR = new Sprite();
export const carC1HL = new Sprite();
export const carC1VU = new Sprite();
export const carC1VD = new Sprite();
export const carC2VU = new Sprite();
export const carC2VD = new Sprite();
export const pedC1VU = new Sprite();
export const pedC1VD = new Sprite();
export const pedC2VU = new Sprite();
export const pedC2VD = new Sprite();
export const pedC1HL = new Sprite();
export const pedC2HR = new Sprite();

export const motion = defaultValue<{
  carC1HR: { moveX: INT; moveY: INT };
  carC1HL: { moveX: INT; moveY: INT };
  carC1VU: { moveX: INT; moveY: INT };
  carC1VD: { moveX: INT; moveY: INT };
  carC2VU: { moveX: INT; moveY: INT };
  carC2VD: { moveX: INT; moveY: INT };
  pedC1VU: { moveX: INT; moveY: INT };
  pedC1VD: { moveX: INT; moveY: INT };
  pedC2VU: { moveX: INT; moveY: INT };
  pedC2VD: { moveX: INT; moveY: INT };
  pedC1HL: { moveX: INT; moveY: INT };
  pedC2HR: { moveX: INT; moveY: INT };
}>();
