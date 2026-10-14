export interface SourceSpan {
  file: string;
  start: number;
  end: number;
  line: number;
  column: number;
}

export interface Diagnostic {
  origin: "typescript" | "plc" | "config" | "backend" | "vendor";
  code: string;
  severity: "error" | "warning";
  message: string;
  span?: SourceSpan;
  notes?: readonly string[];
  related?: readonly { span: SourceSpan; message: string }[];
}

export function error(code: string, message: string, span?: SourceSpan): Diagnostic {
  return { origin: "plc", code, severity: "error", message, ...(span && { span }) };
}

export function hasErrors(diagnostics: readonly Diagnostic[]): boolean {
  return diagnostics.some((diagnostic) => diagnostic.severity === "error");
}

export function formatDiagnostic(diagnostic: Diagnostic, source?: string): string {
  const { span } = diagnostic;
  const location = span ? `${span.file}:${span.line}:${span.column}: ` : "";
  let result = `${location}${diagnostic.code}: ${diagnostic.message}`;
  if (source !== undefined && span) {
    const line = source.split(/\r?\n/)[span.line - 1];
    if (line !== undefined) {
      const width = Math.max(1, Math.min(span.end - span.start, line.length - span.column + 2));
      result += `\n${span.line} | ${line}\n${" ".repeat(String(span.line).length + 3 + span.column - 1)}${"^".repeat(width)}`;
    }
  }
  for (const related of diagnostic.related ?? []) {
    result += `\n  ${related.span.file}:${related.span.line}:${related.span.column}: ${related.message}`;
  }
  for (const note of diagnostic.notes ?? []) result += `\n  ${note}`;
  return result;
}
