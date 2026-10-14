import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { ResolvedVplcConfig } from "@vplc/config";

export interface EdsParameter {
  id: string;
  name: string;
  type: string;
  size: number;
  unit: string;
  description: string;
  minimum?: number;
  maximum?: number;
  default?: number;
}
export interface EdsMember {
  parameter?: string;
  name: string;
  offsetBits: number;
  bits: number;
  type: string;
  unit: string;
  description: string;
}
export interface EdsAssembly {
  id: string;
  instance?: number;
  name: string;
  size: number;
  members: EdsMember[];
}
export interface EdsConnection {
  id: string;
  name: string;
  outputAssembly?: number;
  inputAssembly?: number;
  path: string;
  inputSize?: EdsSize;
  outputSize?: EdsSize;
}
export interface EdsSize {
  value: number;
  parameter?: string;
  minimum?: number;
  maximum?: number;
}
export interface HardwareDescriptor {
  file: string;
  name: string;
  vendor: string;
  productCode: string;
  parameters: EdsParameter[];
  assemblies: EdsAssembly[];
  connections: EdsConnection[];
}
export interface IoChannel {
  device: string;
  id: string;
  name: string;
  direction: "input" | "output";
  assembly: number;
  offsetBits: number;
  bits: number;
  type: string;
  address?: string;
  parent?: string;
  unit: string;
  description: string;
}
export interface SelectedAssembly {
  direction: "input" | "output";
  instance: number;
  name: string;
  address: string;
  size: number;
  capacity: number;
}
export interface HardwareCatalog {
  descriptors: HardwareDescriptor[];
  devices: {
    id: string;
    descriptor: string;
    connection?: Pick<EdsConnection, "id" | "name" | "path">;
    assemblies: SelectedAssembly[];
    channels: IoChannel[];
    statusSymbols: Record<string, string>;
  }[];
}

const cipTypes: Record<number, string> = {
  0xc1: "BOOL",
  0xc2: "SINT",
  0xc3: "INT",
  0xc4: "DINT",
  0xc5: "LINT",
  0xc6: "USINT",
  0xc7: "UINT",
  0xc8: "UDINT",
  0xc9: "ULINT",
  0xca: "REAL",
  0xcb: "LREAL",
  0xd1: "BYTE",
  0xd2: "WORD",
  0xd3: "DWORD",
  0xd4: "LWORD",
};

/** EDS records are comma separated, terminated by semicolons, with $ comments. */
export function readEdsRecords(text: string): Record<string, Record<string, string[]>> {
  let clean = "",
    quote = false,
    comment = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (comment) {
      if (c === "\n") {
        comment = false;
        clean += c;
      }
      continue;
    }
    if (c === '"') {
      if (quote && text[i + 1] === '"') {
        clean += '""';
        i++;
        continue;
      }
      quote = !quote;
    }
    if (c === "$" && !quote) {
      comment = true;
      continue;
    }
    clean += c;
  }
  if (quote) throw new Error("Unterminated EDS string.");
  const result: Record<string, Record<string, string[]>> = {};
  let section: Record<string, string[]> | undefined;
  const tokens = /\[([^\]\r\n]+)\]|([A-Za-z_][\w]*)\s*=\s*((?:"(?:[^"]|"")*"|[^;])*)\s*;/g;
  let end = 0;
  for (const match of clean.matchAll(tokens)) {
    if (clean.slice(end, match.index).trim()) throw new Error("Malformed EDS record or section.");
    end = match.index! + match[0].length;
    if (match[1]) {
      const key = match[1].trim();
      if (result[key]) throw new Error(`Duplicate EDS section ${key}.`);
      section = result[key] = {};
      continue;
    }
    if (!section) throw new Error("EDS record outside a section.");
    const key = match[2]!;
    if (section[key]) throw new Error(`Duplicate EDS record ${key}.`);
    const fields: string[] = [];
    let field = "",
      quoted = false;
    const body = match[3]!;
    for (let i = 0; i < body.length; i++) {
      const c = body[i]!;
      if (c === '"') {
        if (quoted && body[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = !quoted;
      } else if (c === "," && !quoted) {
        fields.push(field.trim());
        field = "";
      } else field += c;
    }
    fields.push(field.trim());
    section[key] = fields;
  }
  if (clean.slice(end).trim()) throw new Error("Unterminated EDS record.");
  return result;
}
function integer(value: string | undefined, label: string, allowZero = true): number {
  if (!value || !/^(?:\d+|0x[\da-f]+)$/i.test(value))
    throw new Error(`Invalid EDS ${label}: ${value ?? "missing"}.`);
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < (allowZero ? 0 : 1) || n > 16_777_216)
    throw new Error(`Unsupported EDS ${label}: ${value}.`);
  return n;
}
// EPATH logical segments encode class, instance, attribute and connection-point
// IDs. Record names such as Assem1 are format references, not runtime instances.
function logicalPath(path: string): { instance?: number; points: number[] } {
  const bytes = path.trim()
    ? path
        .trim()
        .split(/\s+/)
        .map((token) => {
          if (!/^[0-9a-f]{2}$/i.test(token))
            throw new Error(`Unsupported EDS path token ${token}.`);
          return parseInt(token, 16);
        })
    : [];
  const result: { instance?: number; points: number[] } = { points: [] };
  for (let offset = 0; offset < bytes.length;) {
    const segment = bytes[offset++]!;
    const width = segment & 3;
    if ((segment & 0xe0) !== 0x20 || width > 2)
      throw new Error(`Unsupported EDS logical path segment ${segment.toString(16)}.`);
    if (width && bytes[offset++] !== 0) throw new Error("Invalid EDS logical path padding.");
    const length = 1 << width;
    if (offset + length > bytes.length) throw new Error("Truncated EDS logical path.");
    let value = 0;
    for (let index = 0; index < length; index++) value += bytes[offset++]! * 2 ** (index * 8);
    if ((segment & 0xfc) === 0x24) result.instance = value;
    if ((segment & 0xfc) === 0x2c) result.points.push(value);
  }
  return result;
}
const optionalNumber = (value: string | undefined) =>
  value?.trim() && Number.isFinite(Number(value)) ? Number(value) : undefined;

export function parseEds(text: string, file = "device.eds"): HardwareDescriptor {
  const records = readEdsRecords(text),
    device = records.Device;
  if (!device?.ProdName?.[0]) throw new Error(`${file}: missing EDS Device.ProdName.`);
  const parameters = Object.entries(records.Params ?? {})
    .filter(([id]) => /^Param\d+$/.test(id))
    .map(([id, fields]): EdsParameter => ({
      id,
      name: fields[6] || id,
      type: cipTypes[Number(fields[4])] ?? "opaque",
      size: integer(fields[5], `${id} data size`, false),
      unit: fields[7] ?? "",
      description: fields[8] ?? "",
      minimum: optionalNumber(fields[9]),
      maximum: optionalNumber(fields[10]),
      default: optionalNumber(fields[11]),
    }));
  const params = new Map(parameters.map((parameter) => [parameter.id, parameter]));
  const instances = new Map<string, number>();
  const size = (value: string | undefined): EdsSize | undefined => {
    if (!value) return;
    if (!value.startsWith("Param")) return { value: integer(value, "connection size") };
    const parameter = params.get(value);
    if (!parameter || parameter.default === undefined)
      throw new Error(`${file}: connection size ${value} has no numeric default.`);
    return {
      value: parameter.default,
      parameter: value,
      minimum: parameter.minimum,
      maximum: parameter.maximum,
    };
  };
  const connections = Object.entries(records["Connection Manager"] ?? {})
    .filter(([id]) => /^Connection\d+$/.test(id))
    .map(([id, fields]): EdsConnection => {
      const path = fields[14] ?? "",
        points = logicalPath(path).points;
      const assembly = (
        reference: string | undefined,
        point: number | undefined,
      ): number | undefined => {
        if (!reference) return;
        if (!/^Assem\d+$/.test(reference) || !records.Assembly?.[reference])
          throw new Error(`${file}: unknown connection assembly ${reference}.`);
        const instance = point ?? logicalPath(records.Assembly[reference]![1] ?? "").instance;
        if (instance === undefined)
          throw new Error(`${file}: no runtime instance for ${reference}.`);
        const previous = instances.get(reference);
        if (previous !== undefined && previous !== instance)
          throw new Error(`${file}: ${reference} has conflicting runtime instances.`);
        instances.set(reference, instance);
        return instance;
      };
      return {
        id,
        name: fields[12] || id,
        path,
        outputAssembly: assembly(fields[4], points.at(-2)),
        inputAssembly: assembly(fields[7], points.at(-1)),
        outputSize: size(fields[3]),
        inputSize: size(fields[6]),
      };
    });
  const assemblies = Object.entries(records.Assembly ?? {})
    .filter(([id]) => /^Assem\d+$/.test(id))
    .map(([id, fields]): EdsAssembly => {
      const members: EdsMember[] = [];
      let offsetBits = 0;
      for (let index = 6; index < fields.length; index += 2) {
        if (!fields[index] && !fields[index + 1]) continue;
        const bits = integer(fields[index], `${id} member bits`, false),
          reference = fields[index + 1];
        const parameter = reference ? params.get(reference) : undefined;
        if (reference && !parameter)
          throw new Error(`${file}: ${id} references unknown parameter ${reference}.`);
        members.push({
          ...(reference ? { parameter: reference } : {}),
          name: parameter?.name ?? "Padding",
          offsetBits,
          bits,
          type: parameter?.type ?? "padding",
          unit: parameter?.unit ?? "",
          description: parameter?.description ?? "",
        });
        offsetBits += bits;
      }
      const size = fields[2] ? integer(fields[2], `${id} size`) : Math.ceil(offsetBits / 8);
      if (offsetBits > size * 8)
        throw new Error(`${file}: ${id} members exceed its ${size} byte payload.`);
      const instance = logicalPath(fields[1] ?? "").instance ?? instances.get(id);
      return { id, instance, name: fields[0] || id, size, members };
    });
  return {
    file,
    name: device.ProdName[0],
    vendor: device.VendName?.[0] ?? "",
    productCode: device.ProdCode?.[0] ?? "",
    parameters,
    assemblies,
    connections,
  };
}

export async function loadHardware(
  config: ResolvedVplcConfig,
  root: string,
): Promise<HardwareCatalog> {
  const files = new Set<string>();
  const visit = async (directory: string) => {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (cause) {
      if (cause && typeof cause === "object" && "code" in cause && cause.code === "ENOENT") return;
      throw cause;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile() && /\.eds$/i.test(entry.name)) files.add(path);
    }
  };
  for (const directory of typeof config.eds === "string" ? [config.eds] : config.eds)
    await visit(resolve(root, directory));
  for (const device of Object.values(config.devices)) files.add(resolve(root, device.file));
  const descriptors = await Promise.all(
    [...files].map(async (file) => parseEds(await readFile(file, "utf8"), file)),
  );
  const devices = Object.entries(config.devices).map(([id, settings]) => {
    const descriptor = descriptors.find((d) => d.file === resolve(root, settings.file))!;
    const compatible = descriptor.connections.filter(
      (connection) =>
        (!settings.inputs || connection.inputAssembly === settings.inputs.assembly) &&
        (!settings.outputs || connection.outputAssembly === settings.outputs.assembly),
    );
    const connection = settings.connection
      ? descriptor.connections.find((item) => item.id === settings.connection)
      : compatible.length === 1
        ? compatible[0]
        : undefined;
    if (settings.connection && (!connection || !compatible.includes(connection)))
      throw new Error(
        `${id}: connection ${settings.connection} does not match the selected assemblies.`,
      );
    if (!settings.connection && (settings.inputs || settings.outputs) && compatible.length > 1)
      throw new Error(`${id}: select connection; several EDS connections match these assemblies.`);
    const channels: IoChannel[] = [];
    const assemblies: SelectedAssembly[] = [];
    for (const [direction, selection] of [
      ["input", settings.inputs],
      ["output", settings.outputs],
    ] as const) {
      if (!selection) continue;
      const assembly = descriptor.assemblies.find((a) => a.instance === selection.assembly);
      if (!assembly)
        throw new Error(
          `${id}: assembly ${selection.assembly} is not present in ${settings.file}.`,
        );
      const prefix = direction === "input" ? "inputs" : "outputs",
        region = direction === "input" ? "I" : "Q";
      if (!selection.address.startsWith(`%${region}B`))
        throw new Error(`${id}: ${direction} assembly needs a %${region}B address.`);
      const base = Number(selection.address.slice(3));
      const declaredSize = direction === "input" ? connection?.inputSize : connection?.outputSize;
      const payloadSize = selection.size ?? declaredSize?.value ?? assembly.size;
      if (
        !Number.isSafeInteger(payloadSize) ||
        payloadSize <= 0 ||
        payloadSize > assembly.size ||
        (declaredSize?.minimum !== undefined && payloadSize < declaredSize.minimum) ||
        (declaredSize?.maximum !== undefined && payloadSize > declaredSize.maximum) ||
        (selection.size !== undefined &&
          declaredSize &&
          !declaredSize.parameter &&
          payloadSize !== declaredSize.value)
      )
        throw new Error(
          `${id}: ${direction} payload size ${payloadSize} is outside the selected EDS connection's bounds.`,
        );
      assemblies.push({
        direction,
        instance: selection.assembly,
        name: assembly.name,
        address: selection.address,
        size: payloadSize,
        capacity: assembly.size,
      });
      for (let i = 0; i < payloadSize; i++) {
        const key = `${prefix}.Byte${i}`;
        channels.push({
          device: id,
          id: key,
          name: `Byte ${i}`,
          direction,
          assembly: selection.assembly,
          offsetBits: i * 8,
          bits: 8,
          type: "BYTE",
          address: `%${region}B${base + i}`,
          unit: "",
          description: "Assembly payload byte",
        });
        for (let bit = 0; bit < 8; bit++)
          channels.push({
            device: id,
            id: `${key}.Bit${bit}`,
            parent: key,
            name: `Bit ${bit}`,
            direction,
            assembly: selection.assembly,
            offsetBits: i * 8 + bit,
            bits: 1,
            type: "BOOL",
            address: `%${region}X${base + i}.${bit}`,
            unit: "",
            description: "Assembly payload bit",
          });
      }
      const counts = new Map<string, number>();
      const occurrences = new Map<string, number>();
      for (const member of assembly.members) {
        if (!member.parameter) continue;
        const name = member.name.replace(/[^\w]/g, "_");
        occurrences.set(name, (occurrences.get(name) ?? 0) + 1);
      }
      for (const member of assembly.members) {
        if (!member.parameter || member.offsetBits >= payloadSize * 8) continue;
        const name = member.name.replace(/[^\w]/g, "_"),
          count = counts.get(name) ?? 0;
        counts.set(name, count + 1);
        const key = `${prefix}.${name}${occurrences.get(name)! > 1 ? `[${count}]` : ""}`;
        const width =
          member.bits === 1
            ? "X"
            : member.bits === 8
              ? "B"
              : member.bits === 16
                ? "W"
                : member.bits === 32
                  ? "D"
                  : undefined;
        const typeBits: Record<string, number> = {
          BOOL: 1,
          SINT: 8,
          USINT: 8,
          BYTE: 8,
          INT: 16,
          UINT: 16,
          WORD: 16,
          DINT: 32,
          UDINT: 32,
          DWORD: 32,
          REAL: 32,
          LINT: 64,
          ULINT: 64,
          LWORD: 64,
          LREAL: 64,
        };
        const aligned =
          (member.bits === 1 || (base * 8 + member.offsetBits) % member.bits === 0) &&
          typeBits[member.type] === member.bits;
        const address =
          width && aligned
            ? `%${region}${width}${base + Math.floor(member.offsetBits / 8)}${width === "X" ? `.${member.offsetBits % 8}` : ""}`
            : undefined;
        const channel: IoChannel = {
          device: id,
          id: key,
          name: member.name,
          direction,
          assembly: selection.assembly,
          offsetBits: member.offsetBits,
          bits: member.bits,
          type: member.type,
          address,
          unit: member.unit,
          description: member.description,
        };
        const scalarBits = typeBits[member.type];
        if (
          scalarBits &&
          scalarBits >= 8 &&
          member.bits > scalarBits &&
          member.bits % scalarBits === 0 &&
          member.offsetBits % scalarBits === 0
        ) {
          const length = Math.floor(
            Math.min(member.bits, payloadSize * 8 - member.offsetBits) / scalarBits,
          );
          channel.type = `ARRAY[0..${length - 1}] OF ${member.type}`;
          channel.bits = length * scalarBits;
          channels.push(channel);
          const elementWidth = { 8: "B", 16: "W", 32: "D" }[scalarBits];
          for (let index = 0; index < length; index++) {
            const offset = member.offsetBits + index * scalarBits;
            channels.push({
              ...channel,
              id: `${key}[${index}]`,
              parent: key,
              name: `${member.name}[${index}]`,
              type: member.type,
              bits: scalarBits,
              offsetBits: offset,
              address:
                elementWidth && (base * 8 + offset) % scalarBits === 0
                  ? `%${region}${elementWidth}${base + offset / 8}`
                  : undefined,
            });
          }
        } else if (member.offsetBits + member.bits <= payloadSize * 8) channels.push(channel);
      }
    }
    return {
      id,
      descriptor: descriptor.file,
      connection: connection && { id: connection.id, name: connection.name, path: connection.path },
      assemblies,
      channels,
      statusSymbols: settings.statusSymbols ?? {},
    };
  });
  return { descriptors, devices };
}
export function resolveIo(config: ResolvedVplcConfig, catalog: HardwareCatalog) {
  return Object.fromEntries(
    Object.entries(config.io).map(([symbol, binding]) => {
      if ("address" in binding) return [symbol, binding];
      const device = catalog.devices.find((d) => d.id === binding.device);
      const channel = device?.channels.find((c) => c.id === binding.channel);
      if (!channel?.address)
        throw new Error(
          `${symbol}: unknown or unaddressable channel ${binding.device}.${binding.channel}.`,
        );
      return [symbol, { address: channel.address, type: channel.type }];
    }),
  );
}
export function generateHardwareTypes(catalog: HardwareCatalog): string {
  const choices = catalog.devices.flatMap((d) =>
    d.channels
      .filter((c) => c.address)
      .map((c) => `{ device: ${JSON.stringify(d.id)}; channel: ${JSON.stringify(c.id)} }`),
  );
  const direct =
    '{ address: `%${"I" | "Q"}${"B" | "W" | "D"}${number}` | `%${"I" | "Q"}X${number}.${0 | 1 | 2 | 3 | 4 | 5 | 6 | 7}`; type?: string }';
  return `// Generated by vPLC. Run vplc typegen after changing EDS files or device selections.\nexport type HardwareIoBinding = ${[...choices, direct].join("\n  | ")};\nexport type HardwareIoMapping = Readonly<Record<string, HardwareIoBinding>>;\nexport const hardware = ${JSON.stringify(catalog, null, 2)} as const;\n`;
}
