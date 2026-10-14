// CODESYS declaration, statement, operator and elementary-type keywords.
// https://content.helpme-codesys.com/en/CODESYS%20Development%20System/_cds_keywords.html
const keywords = new Set(
  `
ACTION END_ACTION PROGRAM END_PROGRAM FUNCTION END_FUNCTION FUNCTION_BLOCK END_FUNCTION_BLOCK
INTERFACE END_INTERFACE METHOD END_METHOD PROPERTY END_PROPERTY
TYPE END_TYPE STRUCT END_STRUCT UNION END_UNION ARRAY POINTER REFERENCE
VAR END_VAR VAR_INPUT VAR_OUTPUT VAR_IN_OUT VAR_TEMP VAR_GLOBAL VAR_EXTERNAL
VAR_ACCESS VAR_CONFIG VAR_STAT VAR_INST VAR_GENERIC
CONSTANT RETAIN NON_RETAIN PERSISTENT AT READ_ONLY READ_WRITE PARAMS
CONFIGURATION END_CONFIGURATION RESOURCE END_RESOURCE TASK WITH SINGLE INTERVAL PRIORITY
PRIVATE PUBLIC PROTECTED INTERNAL ABSTRACT FINAL OVERRIDE EXTENDS IMPLEMENTS THIS SUPER
IF THEN ELSIF ELSE END_IF CASE OF END_CASE FOR TO BY DO END_FOR
WHILE END_WHILE REPEAT UNTIL END_REPEAT RETURN EXIT CONTINUE JMP
TRUE FALSE BOOL BYTE WORD DWORD LWORD SINT USINT INT UINT DINT UDINT LINT ULINT
REAL LREAL TIME LTIME DATE LDATE DATE_AND_TIME LDATE_AND_TIME TIME_OF_DAY LTIME_OF_DAY
DT LDT TOD LTOD STRING WSTRING CHAR WCHAR
ANY ANY_BIT ANY_DATE ANY_DERIVED ANY_ELEMENTARY ANY_INT ANY_MAGNITUDE ANY_NUM
ANY_REAL ANY_STRING ANY_UNSIGNED
AND AND_THEN OR OR_ELSE XOR NOT MOD ADD SUB MUL DIV MOVE SEL MIN MAX LIMIT
ABS ACOS ASIN ATAN COS SIN TAN EXP EXPT LN LOG SQRT TRUNC SHL SHR ROL ROR
ADR SIZEOF CONCAT DELETE FIND INSERT LEFT LEN MID REPLACE RIGHT
`
    .trim()
    .split(/\s+/),
);
const types =
  "(?:BOOL|BYTE|WORD|DWORD|LWORD|SINT|USINT|INT|UINT|DINT|UDINT|LINT|ULINT|REAL|LREAL|TIME|LTIME|DATE|LDATE|DATE_AND_TIME|LDATE_AND_TIME|TIME_OF_DAY|LTIME_OF_DAY|DT|LDT|TOD|LTOD|STRING|WSTRING|CHAR|WCHAR)";
const conversion = new RegExp(`^(?:${types}_TO_${types}|TO_${types}|TRUNC_${types})$`);
export function isIecIdentifier(name: string): boolean {
  const upper = name.toUpperCase();
  return (
    /^[A-Za-z][A-Za-z0-9_]*$/.test(name) &&
    !name.includes("__") &&
    !keywords.has(upper) &&
    !conversion.test(upper)
  );
}

export class Names {
  private readonly used = new Set<string>();
  reserve(name: string): void {
    this.used.add(name.toUpperCase());
    // Qualified native types must keep their library prefix resolvable in the
    // declaration scope, not merely reserve the complete dotted spelling.
    const prefix = name.split(".")[0];
    if (prefix) this.used.add(prefix.toUpperCase());
  }
  allocate(label: string, preserve = true): string {
    const base =
      preserve && isIecIdentifier(label)
        ? label
        : "plc_" +
          (label
            .replace(/[^A-Za-z0-9_]/g, "_")
            .replace(/_+/g, "_")
            .replace(/^_+|_+$/g, "") || "name");
    let name = base;
    for (let suffix = 2; this.used.has(name.toUpperCase()); suffix++) name = `${base}_${suffix}`;
    this.reserve(name);
    return name;
  }
}
