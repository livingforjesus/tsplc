import { z } from "zod";

export const compilerDiagnosticSchema = z
  .object({
    category: z.string(),
    text: z.string(),
    severity: z.string().nullable(),
    project: z.string().nullable(),
    object: z
      .object({
        name: z.string(),
        guid: z.string(),
        path: z.array(z.string()),
        /** Verified against this message project's active application GUID. */
        isApplicationChild: z.boolean().nullable(),
      })
      .passthrough()
      .nullable(),
    /** Opaque vendor position. It must not be decoded as a line or column. */
    position: z.string().nullable(),
    positionText: z.string().nullable(),
    positionOffset: z.int().nullable(),
    length: z.int().nullable(),
    prefix: z.string().nullable(),
    number: z.int().nullable(),
  })
  .passthrough();

export type CodesysCompilerDiagnostic = z.infer<typeof compilerDiagnosticSchema>;

/** Preserves vendor diagnostics as the cause of a buildProject failure. */
export class CodesysCompilerError extends Error {
  constructor(
    message: string,
    readonly diagnostics: readonly CodesysCompilerDiagnostic[],
  ) {
    super(message);
    this.name = "CodesysCompilerError";
  }
}

// A failed container job publishes diagnostics separately from its successful build receipt.
export const buildFailureFile = ".codesys/docker/failure.json";
export const buildFailureSchema = z.strictObject({
  operationId: z.uuid(),
  message: z.string(),
  diagnostics: z.array(compilerDiagnosticSchema),
});

/** Keep the primary compiler location and the shutdown context across the Docker boundary. */
export function describeBuildFailure(cause: unknown) {
  const messages: string[] = [];
  let diagnostics: readonly CodesysCompilerDiagnostic[] = [];
  let current = cause;
  while (current instanceof Error) {
    messages.push(current.message);
    if (current instanceof AggregateError) {
      // withWorkerShutdown puts the primary failure in cause and secondary failures in errors.
      for (const secondary of current.errors.slice(1))
        messages.push(secondary instanceof Error ? secondary.message : String(secondary));
    }
    if (current instanceof CodesysCompilerError) diagnostics = current.diagnostics;
    current = current.cause;
  }
  return { message: messages.length ? messages.join("\n") : String(cause), diagnostics };
}
