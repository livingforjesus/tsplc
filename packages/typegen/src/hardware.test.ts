import { expect, test } from "bun:test";
import { readFile, mkdtemp, cp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { vplcConfigSchema } from "@vplc/config";
import {
  parseEds,
  readEdsRecords,
  loadHardware,
  resolveIo,
  generateHardwareTypes,
} from "./hardware.ts";
const fixture = resolve(import.meta.dir, "../../../docs/research/fixtures/opener_sample_app.eds");
test("reads the upstream EDS assembly directions, payload offsets and nested bit addresses", async () => {
  const descriptor = parseEds(await readFile(fixture, "utf8"));
  expect(descriptor.assemblies.find((a) => a.instance === 100)?.size).toBe(32);
  expect(descriptor.connections.find((c) => c.outputAssembly === 150)).toMatchObject({
    inputAssembly: 100,
    outputAssembly: 150,
  });
  const root = await mkdtemp(resolve(tmpdir(), "vplc-eds-"));
  await cp(fixture, resolve(root, "sample.eds"));
  const config = vplcConfigSchema.parse({
    backend: "codesys",
    devices: {
      adapter: {
        file: "sample.eds",
        inputs: { assembly: 100, address: "%IB21" },
        outputs: { assembly: 150, address: "%QB11" },
      },
    },
    io: {
      Start: { device: "adapter", channel: "inputs.Byte4.Bit3" },
      Motor: { device: "adapter", channel: "outputs.Byte1" },
    },
  });
  const catalog = await loadHardware(config, root);
  expect(resolveIo(config, catalog)).toEqual({
    Start: { address: "%IX25.3", type: "BOOL" },
    Motor: { address: "%QB12", type: "BYTE" },
  });
  expect(catalog.devices[0]?.channels.find((c) => c.id === "inputs.Input_Data[31]")?.address).toBe(
    "%IB52",
  );
  expect(generateHardwareTypes(catalog)).toContain('channel: "outputs.Byte1"');
});
test("preserves quoted separators and rejects truncated records and duplicate sections", () => {
  expect(readEdsRecords('[Device]\nProdName="a,b;$literal"; $comment\n').Device?.ProdName).toEqual([
    "a,b;$literal",
  ]);
  expect(() => readEdsRecords('[Device]\nProdName="unfinished"')).toThrow(
    "Unterminated EDS record",
  );
  expect(() => readEdsRecords("[Device]\n[Device]")).toThrow("Duplicate EDS section");
});

const frame = resolve(import.meta.dir, "../../../examples/frame-assembly");
function actualHardware(overrides: Record<string, unknown> = {}) {
  return vplcConfigSchema.parse({
    backend: "codesys",
    eds: "eds",
    devices: {
      scanner: {
        file: "eds/0678077312900100.eds",
        connection: "Connection1",
        inputs: { assembly: 11, address: "%IB0" },
        outputs: { assembly: 21, address: "%QB0" },
      },
      conveyor: {
        file: "eds/ConveyLinx_V5_10_CODESYS.eds",
        connection: "Connection4",
        inputs: { assembly: 305, address: "%IB512" },
        outputs: { assembly: 306, address: "%QB512" },
      },
      remoteIo: {
        file: "eds/EthernetIP_CPU1_IF1__ST1.eds",
        connection: "Connection1",
        inputs: { assembly: 124, address: "%IB576" },
        outputs: { assembly: 112, address: "%QB576" },
      },
    },
    ...overrides,
  });
}

test("actual Cognex EDS preserves packed flags, connection size and truncated byte spans", async () => {
  const config = actualHardware();
  const hardware = await loadHardware(config, frame);
  const scanner = hardware.devices.find((device) => device.id === "scanner")!;
  const channel = (id: string) => scanner.channels.find((entry) => entry.id === id);
  expect(channel("inputs.Trigger_Ready")).toMatchObject({ address: "%IX0.0", type: "BOOL" });
  expect(channel("inputs.General_Fault")).toMatchObject({ address: "%IX1.7", type: "BOOL" });
  expect(channel("inputs.Trigger_ID")).toMatchObject({ address: "%IW6", type: "UINT" });
  expect(channel("outputs.Trigger")).toMatchObject({ address: "%QX0.1", type: "BOOL" });
  expect(channel("inputs.Result_Data")).toMatchObject({ type: "ARRAY[0..479] OF BYTE" });
  expect(channel("inputs.Result_Data[479]")?.address).toBe("%IB495");
  expect(channel("inputs.Result_Data[480]")).toBeUndefined();
  expect(channel("outputs.User_Data[487]")?.address).toBe("%QB495");
  expect(channel("inputs.Byte496")).toBeUndefined();
  const descriptor = hardware.descriptors.find((entry) => entry.name.includes("DataMan"))!;
  expect(descriptor.assemblies[0]?.size).toBe(500);
  expect(descriptor.connections[0]?.inputSize).toMatchObject({
    value: 496,
    minimum: 2,
    maximum: 500,
  });
});

test("actual ConveyLinx and B&R EDS resolve 16-bit and record-independent runtime instances", async () => {
  const hardware = await loadHardware(actualHardware(), frame);
  const conveyor = hardware.devices.find((device) => device.id === "conveyor")!;
  expect(
    conveyor.channels.find((channel) => channel.id === "inputs.Zone_Status_Upstream"),
  ).toMatchObject({ assembly: 305, address: "%IW512", type: "UINT" });
  const remote = hardware.devices.find((device) => device.id === "remoteIo")!;
  expect(remote.channels.find((channel) => channel.id === "inputs.Byte15")).toMatchObject({
    assembly: 124,
    address: "%IB591",
  });
  expect(remote.channels.find((channel) => channel.id === "outputs.Byte27")).toMatchObject({
    assembly: 112,
    address: "%QB603",
  });
  const types = generateHardwareTypes(hardware);
  expect(types).toContain('channel: "inputs.Result_Data[479]"');
  expect(types).toContain('channel: "outputs.Byte27"');
});

test("actual Cognex connection overrides obey parameter bounds and static payload sizes", async () => {
  const config = actualHardware();
  config.devices.scanner!.inputs!.size = 500;
  expect(
    (await loadHardware(config, frame)).devices[0]?.channels.some(
      (channel) => channel.id === "inputs.Result_Data[483]",
    ),
  ).toBe(true);
  config.devices.scanner!.inputs!.size = 501;
  await expect(loadHardware(config, frame)).rejects.toThrow("outside");
  config.devices.scanner!.inputs!.size = 1;
  await expect(loadHardware(config, frame)).rejects.toThrow("outside");
});
