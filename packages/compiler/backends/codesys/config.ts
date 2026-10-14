import type { TargetDescriptor } from "@tsplc/config";
import { z } from "zod";
import { engineeringSchema } from "./engineering.ts";
import { isIecIdentifier } from "./names.ts";

const addressSchema = z
  .object({
    kind: z.literal("direct"),
    address: z.string().regex(/^%(?:[IQ]X[0-9]+\.[0-7]|[IQ][BWD][0-9]+)$/),
    type: z.string().optional(),
  })
  .strict();
// Explicit IEC object names keep their exact spelling, so they must already be valid.
const iecNames = z
  .record(
    z.string().min(1),
    z.string().refine(isIecIdentifier, "Use a valid, non-reserved IEC identifier."),
  )
  .optional();
export const optionsSchema = z
  .object({
    engineering: engineeringSchema,
    profile: z
      .object({
        directAddressing: z.literal("byte"),
        numericAddressing: z.enum(["byte", "element"]).optional(),
      })
      .strict(),
    io: z.record(z.string().min(1), addressSchema),
    globalListNames: iecNames,
    publishGlobalLists: z.array(z.string().min(1)).optional(),
    programNames: iecNames,
  })
  .strict();
export type CodesysOptions = z.infer<typeof optionsSchema>;
export function codesys(
  options: z.input<typeof optionsSchema>,
): TargetDescriptor<z.input<typeof optionsSchema>> {
  return { kind: "codesys", options };
}
export function direct(
  address:
    | `%IX${number}.${number}`
    | `%QX${number}.${number}`
    | `%I${"B" | "W" | "D"}${number}`
    | `%Q${"B" | "W" | "D"}${number}`,
): z.infer<typeof addressSchema> {
  return { kind: "direct", address };
}
