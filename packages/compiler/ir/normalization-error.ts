import { error, type Diagnostic, type SourceSpan } from "./diagnostics.ts";

export class InvalidCore extends Error {
  constructor(readonly diagnostic: Diagnostic) {
    super(diagnostic.message);
  }
}
export function reject(message: string, span?: SourceSpan): never {
  throw new InvalidCore(error("PLC6001", message, span));
}
