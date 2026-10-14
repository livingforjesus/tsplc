export interface ConfigDiagnostic {
  origin: "config";
  code: string;
  severity: "error";
  message: string;
}
