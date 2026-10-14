import { E_Product } from "./types/E_Product.ts";
import type { ST_Recipe } from "./types/ST_Recipe.ts";

/* Map the rotary selector position to a recipe. Unknown positions fall back to water. */
export function selectRecipe(selector: BYTE): ST_Recipe {
  switch (selector) {
    case 2:
      return {
        Product: E_Product.Juice,
        Name: "Orange juice 1 L",
        FillTime: ms(2500),
        ConveyorSpeed: 300,
      };
    case 3:
    case 4:
      return {
        Product: E_Product.Soda,
        Name: "Lemon soda 0.5 L",
        FillTime: ms(1200),
        ConveyorSpeed: 450,
      };
    default:
      return {
        Product: E_Product.Water,
        Name: "Still water 1 L",
        FillTime: ms(2000),
        ConveyorSpeed: 400,
      };
  }
}
