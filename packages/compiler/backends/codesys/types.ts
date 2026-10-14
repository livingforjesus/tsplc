import type { Constant, GeneratedObject, PlcType } from "@vplc/compiler/ir";
import { Names } from "./names.ts";
import { scalarLiteral } from "./numeric.ts";

export class CodesysTypes {
  readonly objects: GeneratedObject[] = [];
  private readonly names = new Map<string, string>();
  private readonly fields = new Map<string, Map<string, string>>();

  constructor(
    private readonly types: ReadonlyMap<string, PlcType>,
    allocate: (label: string) => string,
    blockNames: ReadonlyMap<string, string>,
  ) {
    // Register every type and member name before following layout dependencies.
    for (const type of types.values()) {
      if (type.kind === "block") {
        const name = blockNames.get(type.block);
        if (!name) throw new Error("Missing verified block name");
        this.names.set(type.id, name);
      }
      if (["record", "array", "enum", "string"].includes(type.kind)) {
        // Authored structures and enums retain their public source names. Only
        // synthesized array/string layouts need a generated type prefix.
        const label = type.id.split(":").at(-1)!;
        this.names.set(
          type.id,
          allocate(type.kind === "record" || type.kind === "enum" ? label : `T_${label}`),
        );
      }
      if (type.kind === "record" || type.kind === "enum") {
        const names = new Names(),
          fields = new Map<string, string>();
        for (const member of type.kind === "record" ? type.fields : type.members) {
          fields.set(member.name, names.allocate(member.name, true));
        }
        this.fields.set(type.id, fields);
      }
    }

    // Verified layouts are acyclic. Emit child DUTs first, then their containing DUT.
    const emitted = new Set<string>();
    const emit = (type: PlcType): void => {
      if (type.kind === "block" || !this.names.has(type.id) || emitted.has(type.id)) return;
      if (type.kind === "array") emit(this.type(type.element));
      if (type.kind === "record") {
        for (const field of type.fields) emit(this.type(field.type));
      }
      emitted.add(type.id);
      const name = this.name(type.id);
      let declaration: string;
      if (type.kind === "record") {
        const fields = type.fields
          .map((field) => `    ${this.field(type.id, field.name)} : ${this.name(field.type)};`)
          .join("\n");
        declaration = `TYPE ${name} :
STRUCT
${fields}
END_STRUCT
END_TYPE
`;
      } else if (type.kind === "array") {
        declaration = `TYPE ${name} : ARRAY[${type.lowerBound}..${type.lowerBound + type.length - 1}] OF ${this.name(type.element)};
END_TYPE
`;
      } else if (type.kind === "string") {
        declaration = `TYPE ${name} : ${type.encoding === "utf8" ? "STRING" : "WSTRING"}(${type.capacity});
END_TYPE
`;
      } else if (type.kind === "enum") {
        const members = type.members
          .map((member) => `    ${this.field(type.id, member.name)} := ${member.value}`)
          .join(",\n");
        declaration = `{attribute 'qualified_only'}
{attribute 'strict'}
TYPE ${name} : (
${members}
) DINT;
END_TYPE
`;
      } else throw new Error("Unsupported verified data type");
      this.objects.push({ id: type.id, kind: "dataType", name, declaration });
    };
    for (const type of types.values()) emit(type);
  }

  private type(id: string): PlcType {
    const type = this.types.get(id);
    if (!type) throw new Error("Missing verified type");
    return type;
  }

  name(id: string): string {
    return this.names.get(id) ?? id;
  }

  field(id: string, name: string): string {
    const field = this.fields.get(id)?.get(name);
    if (!field) throw new Error("Missing verified field");
    return field;
  }

  declarationInitializer(value: Constant, id: string): string {
    const type = this.type(id);
    // Our DUT fields have no custom initializers. CODESYS initializes their
    // numbers/BOOL/strings to zero/false/empty, including nested arrays/records.
    // Keep explicit nonzero enum members and signed floating zero: omission must
    // not change the initial value selected by PLC semantics.
    if ((type.kind === "record" || type.kind === "array") && this.isZero(value)) return "";
    return ` := ${this.literal(value, id)}`;
  }

  private isZero(value: Constant): boolean {
    if (value.kind === "bool") return !value.value;
    if (value.kind === "integer") return value.value === "0";
    if (value.kind === "float") return Object.is(value.value, 0);
    if (value.kind === "string") return value.value === "";
    if (value.kind === "array") return value.items.every((item) => this.isZero(item));
    if (value.kind === "record")
      return Object.values(value.fields).every((item) => this.isZero(item));
    // Time/calendar values remain explicit without relying on target defaults.
    return false;
  }

  literal(value: Constant, id: string): string {
    const type = this.type(id);
    if (type.kind === "enum" && value.kind === "integer") {
      const member = type.members.find((member) => member.value === value.value);
      if (!member) throw new Error("Missing verified enum member");
      return `${this.name(id)}.${this.field(id, member.name)}`;
    }
    if (type.kind === "string" && value.kind === "string") {
      const wide = type.encoding === "utf16",
        quote = wide ? '"' : "'";
      let text = "";
      for (const char of value.value) {
        const code = char.charCodeAt(0);
        if (char === "$") text += "$$";
        else if (char === quote) text += `$${char}`;
        else if (code < 32 || code === 127)
          text += `$${code
            .toString(16)
            .toUpperCase()
            .padStart(wide ? 4 : 2, "0")}`;
        else text += char;
      }
      return `${quote}${text}${quote}`;
    }
    if (type.kind === "array" && value.kind === "array") {
      return `[${value.items.map((item) => this.literal(item, type.element)).join(", ")}]`;
    }
    if (type.kind === "record" && value.kind === "record") {
      const fields = type.fields.map((field) => {
        const initial = value.fields[field.name];
        if (!initial) throw new Error("Missing verified record initializer");
        return `${this.field(id, field.name)} := ${this.literal(initial, field.type)}`;
      });
      return `(${fields.join(", ")})`;
    }
    if (type.kind === "duration" && value.kind === "duration") {
      return `T#${BigInt(value.nanoseconds) / 1_000_000n}ms`;
    }
    if (type.kind === "calendar" && value.kind === "calendar") {
      if (type.domain === "date") return `D#${value.value}`;
      if (type.domain === "timeOfDay") return `TOD#${value.value}`;
      return `DT#${value.value.replace("T", "-")}`;
    }
    return scalarLiteral(value, id);
  }
}
