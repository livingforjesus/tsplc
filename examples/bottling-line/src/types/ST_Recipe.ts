import type { E_Product } from "./E_Product.ts";

/* Fill parameters for one product. */
export interface ST_Recipe {
  Product: E_Product;
  /* Display name for the HMI. */
  Name: STRING<24>;
  /* How long each valve stays open. */
  FillTime: TIME;
  /* Infeed conveyor speed command in ConveyLinx units. */
  ConveyorSpeed: UINT;
}
