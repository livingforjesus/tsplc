import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { HardwareDevice, ResolvedTsplcConfig } from "@tsplc/config";
import { iecTypeBits } from "./codegen/constants.ts";

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

async function edsFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true }).catch((cause: unknown) => {
    if (cause && typeof cause === "object" && "code" in cause && cause.code === "ENOENT") return [];
    throw cause;
  });
  const files: string[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await edsFiles(path)));
    else if (entry.isFile() && /\.eds$/i.test(entry.name)) files.push(path);
  }
  return files;
}

/** An explicit connection must carry the selected assemblies; otherwise a single match is implied. */
function selectConnection(
  id: string,
  settings: HardwareDevice,
  descriptor: HardwareDescriptor,
): EdsConnection | undefined {
  const compatible = descriptor.connections.filter(
    (connection) =>
      (!settings.inputs || connection.inputAssembly === settings.inputs.assembly) &&
      (!settings.outputs || connection.outputAssembly === settings.outputs.assembly),
  );
  if (settings.connection) {
    const connection = compatible.find((item) => item.id === settings.connection);
    if (!connection)
      throw new Error(
        `${id}: connection ${settings.connection} does not match the selected assemblies.`,
      );
    return connection;
  }
  if ((settings.inputs || settings.outputs) && compatible.length > 1)
    throw new Error(`${id}: select connection; several EDS connections match these assemblies.`);
  return compatible.length === 1 ? compatible[0] : undefined;
}

const addressWidths: Record<number, string> = { 1: "X", 8: "B", 16: "W", 32: "D" };

/** Bits, bytes, words and dwords are directly addressable when aligned to their own width. */
function directAddress(
  region: "I" | "Q",
  base: number,
  offsetBits: number,
  bits: number,
): string | undefined {
  const width = addressWidths[bits];
  if (!width) return undefined;
  const byte = base + Math.floor(offsetBits / 8);
  if (bits === 1) return `%${region}X${byte}.${offsetBits % 8}`;
  return (base * 8 + offsetBits) % bits === 0 ? `%${region}${width}${byte}` : undefined;
}

function assemblyChannels(
  device: string,
  direction: "input" | "output",
  instance: number,
  members: EdsMember[],
  base: number,
  payloadSize: number,
): IoChannel[] {
  const prefix = `${direction}s`,
    region = direction === "input" ? "I" : "Q",
    payloadBits = payloadSize * 8;
  const address = (offsetBits: number, bits: number) =>
    directAddress(region, base, offsetBits, bits);
  const channels: IoChannel[] = [];
  for (let i = 0; i < payloadSize; i++) {
    const key = `${prefix}.Byte${i}`;
    channels.push({
      device,
      id: key,
      name: `Byte ${i}`,
      direction,
      assembly: instance,
      offsetBits: i * 8,
      bits: 8,
      type: "BYTE",
      address: address(i * 8, 8),
      unit: "",
      description: "Assembly payload byte",
    });
    for (let bit = 0; bit < 8; bit++)
      channels.push({
        device,
        id: `${key}.Bit${bit}`,
        parent: key,
        name: `Bit ${bit}`,
        direction,
        assembly: instance,
        offsetBits: i * 8 + bit,
        bits: 1,
        type: "BOOL",
        address: address(i * 8 + bit, 1),
        unit: "",
        description: "Assembly payload bit",
      });
  }
  // Repeated parameter names are indexed in assembly order.
  const named = members
    .filter((member) => member.parameter)
    .map((member) => ({ member, name: member.name.replace(/[^\w]/g, "_") }));
  const occurrences = new Map<string, number>();
  for (const { name } of named) occurrences.set(name, (occurrences.get(name) ?? 0) + 1);
  const counts = new Map<string, number>();
  for (const { member, name } of named) {
    if (member.offsetBits >= payloadBits) continue;
    const count = counts.get(name) ?? 0;
    counts.set(name, count + 1);
    const key = `${prefix}.${name}${occurrences.get(name)! > 1 ? `[${count}]` : ""}`;
    const scalarBits = iecTypeBits[member.type];
    const channel: IoChannel = {
      device,
      id: key,
      name: member.name,
      direction,
      assembly: instance,
      offsetBits: member.offsetBits,
      bits: member.bits,
      type: member.type,
      address: scalarBits === member.bits ? address(member.offsetBits, member.bits) : undefined,
      unit: member.unit,
      description: member.description,
    };
    const span =
      scalarBits !== undefined &&
      scalarBits >= 8 &&
      member.bits > scalarBits &&
      member.bits % scalarBits === 0 &&
      member.offsetBits % scalarBits === 0;
    if (!span) {
      if (member.offsetBits + member.bits <= payloadBits) channels.push(channel);
      continue;
    }
    const length = Math.floor(Math.min(member.bits, payloadBits - member.offsetBits) / scalarBits);
    channel.type = `ARRAY[0..${length - 1}] OF ${member.type}`;
    channel.bits = length * scalarBits;
    // The whole span binds to a logical FixedArray at its first element's address.
    channel.address = address(member.offsetBits, scalarBits);
    channels.push(channel);
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
        address: address(offset, scalarBits),
      });
    }
  }
  return channels;
}

export async function loadHardware(
  config: ResolvedTsplcConfig,
  root: string,
): Promise<HardwareCatalog> {
  const files = new Set<string>();
  for (const directory of [config.eds].flat())
    for (const file of await edsFiles(resolve(root, directory))) files.add(file);
  for (const device of Object.values(config.devices)) files.add(resolve(root, device.file));
  const descriptors = await Promise.all(
    [...files].map(async (file) => parseEds(await readFile(file, "utf8"), file)),
  );
  const devices = Object.entries(config.devices).map(([id, settings]) => {
    const descriptor = descriptors.find((d) => d.file === resolve(root, settings.file))!;
    const connection = selectConnection(id, settings, descriptor);
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
      const region = direction === "input" ? "I" : "Q";
      if (!selection.address.startsWith(`%${region}B`))
        throw new Error(`${id}: ${direction} assembly needs a %${region}B address.`);
      const declaredSize = direction === "input" ? connection?.inputSize : connection?.outputSize;
      const payloadSize = selection.size ?? declaredSize?.value ?? assembly.size;
      // A parameter-backed size may be overridden within its bounds; a literal size is fixed.
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
      channels.push(
        ...assemblyChannels(
          id,
          direction,
          selection.assembly,
          assembly.members,
          Number(selection.address.slice(3)),
          payloadSize,
        ),
      );
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
export function resolveIo(config: ResolvedTsplcConfig, catalog: HardwareCatalog) {
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
/** A bindable `io` key with its layout; array indexes appear as the literal `${number}`. */
export interface IoTarget {
  key: string;
  layout: string;
}

/**
 * Binding-compatibility class of an IEC type spelling. Equal classes share a
 * process-image layout: equal-width integer and bit-string scalars, REAL/LREAL and
 * BOOL by name, and arrays of those (not BOOL) by length, whatever their bounds.
 */
export function ioLayout(type: string): string | undefined {
  const array = /^ARRAY\s*\[\s*(-?\d+)\s*\.\.\s*(-?\d+)\s*\]\s*OF\s+(\w+)$/i.exec(type.trim());
  if (array) {
    const element = ioLayout(array[3]!);
    return element && element !== "BOOL"
      ? `${Number(array[2]) - Number(array[1]) + 1}x${element}`
      : undefined;
  }
  const name = type.trim().toUpperCase();
  if (name === "BOOL" || name === "REAL" || name === "LREAL") return name;
  const bits = iecTypeBits[name];
  return bits ? `INT${bits}` : undefined;
}

// Direct addresses by the width of one element; 64-bit layouts have no direct form.
const directWidths: Record<string, string> = {
  BOOL: "X",
  INT8: "B",
  INT16: "W",
  INT32: "D",
  REAL: "D",
};
const directBinding = (layout: string): string | undefined => {
  const width = directWidths[layout.replace(/^\d+x/, "")];
  if (!width) return undefined;
  return width === "X"
    ? '{ address: `%${"I" | "Q"}X${number}.${0 | 1 | 2 | 3 | 4 | 5 | 6 | 7}`; type?: string }'
    : `{ address: \`%\${"I" | "Q"}${width}\${number}\`; type?: string }`;
};

/**
 * With `targets` from a compiled TS project, `HardwareIoMapping` accepts only those
 * keys, each with channels or direct addresses of a compatible layout. Without them
 * (raw ST projects) any key is accepted and the build checks it.
 */
export function generateHardwareTypes(
  catalog: HardwareCatalog,
  targets?: readonly IoTarget[],
): string {
  const channel = (device: string, id: string) =>
    `{ device: ${JSON.stringify(device)}; channel: ${JSON.stringify(id)} }`;
  const channels = catalog.devices.flatMap((device) =>
    device.channels
      .filter((item) => item.address)
      .map((item) => ({ binding: channel(device.id, item.id), layout: ioLayout(item.type) })),
  );
  const direct =
    '{ address: `%${"I" | "Q"}${"B" | "W" | "D"}${number}` | `%${"I" | "Q"}X${number}.${0 | 1 | 2 | 3 | 4 | 5 | 6 | 7}`; type?: string }';
  const anyBinding = [...channels.map((item) => item.binding), direct].join("\n  | ");
  const mapping = targets
    ? [...new Set(targets.map((target) => target.layout))]
        .sort()
        .map((layout) => {
          const keys = targets
            .filter((target) => target.layout === layout)
            .map((target) => `\`${target.key}\``);
          const bindings = [
            ...channels.filter((item) => item.layout === layout).map((item) => item.binding),
            directBinding(layout),
          ].filter(Boolean);
          return `{\n  readonly [K in ${keys.join(" | ")}]?: ${bindings.join(" | ") || "never"};\n}`;
        })
        .join(" & ")
    : "Readonly<Record<string, HardwareIoBinding>>";
  return `// Generated by tsPLC. Run tsplc typegen after changing EDS files, device selections or PLC storage.\nexport type HardwareIoBinding = ${anyBinding};\nexport type HardwareIoMapping = ${mapping};\nexport const hardware = ${JSON.stringify(catalog, null, 2)} as const;\n`;
}
