import { z } from "zod";
export const commandArgumentSchema = z
  .string()
  .refine((value) => value.trim().length > 0, "Command arguments must not be empty")
  .refine(
    (value) => !/["\r\n\0]/.test(value),
    "Command arguments must not contain quotes, line breaks, or null bytes",
  );
