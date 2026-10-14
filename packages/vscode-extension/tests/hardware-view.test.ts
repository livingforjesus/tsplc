import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { loadSources, resolveConfig } from "@tsplc/build";
import { tsplcConfigSchema } from "@tsplc/config/schema";
import { loadHardware } from "@tsplc/typegen/hardware";
import { hardwarePage, hardwareUpdate, monitoredSymbols } from "../src/hardware-renderer.ts";
import type { ProjectModel } from "../src/project-model.ts";

function project(): ProjectModel {
  return {
    root: "/fixture",
    configFile: "/fixture/tsplc.config.ts",
    source: "config",
    config: tsplcConfigSchema.parse({
      backend: "codesys",
      io: {
        and: { device: "Adapter", channel: "inputs.Byte0.Bit0" },
        "Line.Motor": { address: "%QX0.1" },
        Unknown: { address: "%IX0.7" },
      },
      monitor: {
        endpoint: "opc.tcp://fixture:4840",
        symbols: ["Line.Speed"],
        username: "reader <test>",
      },
    }),
    symbols: { and: "GVL_IO_2.plc_and", "Line.Motor": "Line.Motor" },
    hardware: {
      descriptors: [],
      devices: [
        {
          id: "Adapter",
          descriptor: "sample.eds",
          assemblies: [],
          statusSymbols: { State: "Driver.eState" },
          channels: [
            {
              device: "Adapter",
              id: "inputs.Byte0",
              name: "Byte 0",
              direction: "input",
              assembly: 100,
              offsetBits: 0,
              bits: 8,
              type: "BYTE",
              address: "%IB0",
              unit: "",
              description: "<sensor>",
            },
            {
              device: "Adapter",
              id: "inputs.Byte0.Bit0",
              parent: "inputs.Byte0",
              name: "Bit 0",
              direction: "input",
              assembly: 100,
              offsetBits: 0,
              bits: 1,
              type: "BOOL",
              address: "%IX0.0",
              unit: "",
              description: "Start",
            },
          ],
        },
      ],
    },
  };
}

function page(model: ProjectModel): string {
  return hardwarePage(model, {
    nonce: "fixture",
    cspSource: "https://webview.example",
    scriptUri: "script.js",
    styleUri: "style.css",
    relativePath: (path) => path,
  });
}

test("hardware page displays the effective connection and assembly plan for all three real EDS files", async () => {
  const model = project();
  model.root = resolve(import.meta.dir, "../../typegen/fixtures");
  model.config = tsplcConfigSchema.parse({
    backend: "codesys",
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
  });
  model.hardware = await loadHardware(model.config, model.root);
  const scanner = model.hardware.devices[0]!;
  expect(scanner.assemblies[0]).toMatchObject({ instance: 11, size: 496, capacity: 500 });
  expect(model.hardware.devices[1]?.assemblies.map((assembly) => assembly.instance)).toEqual([
    305, 306,
  ]);
  expect(model.hardware.devices[2]?.assemblies.map((assembly) => assembly.size)).toEqual([16, 28]);
  const html = page(model);
  for (const device of model.hardware.devices) {
    expect(html).toContain(`Connection: ${device.connection!.id}`);
    for (const assembly of device.assemblies) {
      expect(html).toContain(
        `<td>${assembly.instance}</td><td>${assembly.size} bytes</td><td>${assembly.capacity} bytes</td><td>${assembly.address}</td>`,
      );
    }
  }
  expect(html).toContain("Input (device → PLC)");
  expect(html).toContain("Output (PLC → device)");
  expect(html).toContain("EPATH:");

  model.config.devices.scanner!.inputs!.size = 500;
  model.hardware = await loadHardware(model.config, model.root);
  expect(page(model)).toContain("<td>11</td><td>500 bytes</td><td>500 bytes</td><td>%IB0</td>");
  model.hardware.devices[0]!.connection!.name = "<connection>";
  model.hardware.devices[0]!.assemblies[0]!.name = "<assembly>";
  expect(page(model)).toContain("&lt;connection&gt;");
  expect(page(model)).toContain("&lt;assembly&gt;");
});

test("task view uses the shared raw schedule and shows legacy template timing honestly", () => {
  const model = project();
  expect(page(model)).toContain("No task plan configured.");
  model.config = tsplcConfigSchema.parse({
    backend: "codesys",
    build: { template: "base.project" },
  });
  expect(page(model)).toContain(
    "<td>MainTask</td><td>Template</td><td>Template</td><td>Entry: src/Main.st</td>",
  );
  model.config = tsplcConfigSchema.parse({
    backend: "codesys",
    build: { template: "base.project", task: "Scan", entry: "plc/Production.st" },
  });
  expect(page(model)).toContain(
    "<td>Scan</td><td>Template</td><td>Template</td><td>Entry: plc/Production.st</td>",
  );
  model.config = tsplcConfigSchema.parse({
    backend: "codesys",
    build: { template: "base.project", entry: "plc/Production/declaration.st" },
  });
  expect(page(model)).toContain("<td>Entry: plc/Production/declaration.st</td>");
  expect(page(model)).not.toContain("<td>declaration</td>");
  model.config = tsplcConfigSchema.parse({
    backend: "codesys",
    build: { template: "base.project" },
    tasks: [
      {
        name: "FastScan",
        schedule: { kind: "cyclic", interval: { kind: "duration", nanoseconds: "20000000" } },
        priority: 3,
        programs: ["ReadInputs", "Production"],
      },
    ],
  });
  expect(page(model)).toContain(
    "<td>FastScan</td><td>20 ms</td><td>3</td><td>ReadInputs → Production</td>",
  );
  model.config = tsplcConfigSchema.parse({
    backend: "codesys",
    build: {
      template: "base.project",
      tasks: [
        { name: "LegacyScan", intervalNanoseconds: "10000000", priority: 1, programs: ["Main"] },
      ],
    },
  });
  expect(page(model)).toContain("<td>LegacyScan</td><td>10 ms</td><td>1</td><td>Main</td>");
});

test("legacy entry display leaves split and mismatched PROGRAM identity to the source loader", async () => {
  const model = project();
  model.root = await mkdtemp(resolve(tmpdir(), "tsplc-task-entry-"));
  model.configFile = resolve(model.root, "tsplc.config.ts");
  try {
    await mkdir(resolve(model.root, "src/Production"), { recursive: true });
    await writeFile(resolve(model.root, "src/Production/declaration.st"), "PROGRAM Production\n");
    await writeFile(resolve(model.root, "src/Production/implementation.st"), "(* scan *)");
    model.config = tsplcConfigSchema.parse({
      backend: "codesys",
      build: { template: "base.project", entry: "src/Production/declaration.st" },
    });
    const loaded = await loadSources(resolveConfig(model.config.build, model.configFile));
    expect(loaded.entry).toBe("Production");
    expect(page(model)).toContain("<td>Entry: src/Production/declaration.st</td>");
    expect(page(model)).not.toContain("<td>declaration</td>");

    await writeFile(
      resolve(model.root, "src/UnexpectedName.st"),
      "PROGRAM ActualProgram\nEND_PROGRAM",
    );
    model.config.build!.entry = "src/UnexpectedName.st";
    await expect(loadSources(resolveConfig(model.config.build, model.configFile))).rejects.toThrow(
      "Source name UnexpectedName does not match declaration ActualProgram",
    );
    expect(page(model)).toContain("<td>Entry: src/UnexpectedName.st</td>");
    expect(page(model)).not.toContain("<td>UnexpectedName</td>");
  } finally {
    await rm(model.root, { recursive: true, force: true });
  }
});

test("hardware page uses emitted symbols, expandable byte rows and escaped descriptor text", () => {
  const model = project();
  model.config.name = "Adapter <test>";
  const html = hardwarePage(model, {
    nonce: "fixture",
    cspSource: "https://webview.example",
    scriptUri: "https://webview.example/script.js",
    styleUri: "https://webview.example/style.css",
    relativePath: (path) => path,
  });
  expect(html).toContain("Adapter &lt;test&gt;");
  expect(html).toContain("&lt;sensor&gt;");
  expect(html).toContain('data-symbol="GVL_IO_2.plc_and"');
  expect(html).not.toContain('data-symbol="GVL_IO.and"');
  expect(html).not.toContain('data-symbol="GVL_IO.Unknown"');
  expect(html).toContain('data-bit-toggle="Adapter:inputs.Byte0"');
  expect(html).toContain('data-parent="Adapter:inputs.Byte0" hidden');
  expect(html).toContain("default-src 'none'");
  expect(html).toContain("SignAndEncrypt");
  expect(html).toContain("Basic256Sha256");
  expect(html).toContain("reader &lt;test&gt;");
  expect(html).toContain('data-action="forgetPassword"');
  expect([...monitoredSymbols(project())]).toEqual([
    "GVL_IO_2.plc_and",
    "Line.Motor",
    "Driver.eState",
    "Line.Speed",
  ]);
  const missingSymbols = project();
  missingSymbols.config = tsplcConfigSchema.parse({
    ...missingSymbols.config,
    io: { constructor: { address: "%IX0.6" } },
  });
  const missingHtml = hardwarePage(missingSymbols, {
    nonce: "fixture",
    cspSource: "https://webview.example",
    scriptUri: "script.js",
    styleUri: "style.css",
    relativePath: (path) => path,
  });
  expect(missingHtml).not.toContain("[native code]");
});

test("connection loss marks old values stale while preserving quality and timestamps", () => {
  const sample = {
    value: 42n,
    good: true,
    quality: "Good",
    receivedAt: "2026-10-13T00:00:00Z",
    sourceTimestamp: "2026-10-12T23:59:59Z",
  };
  const samples = new Map([["Counter", sample]]);
  expect(hardwareUpdate("Connected", samples).samples[0]).toMatchObject({
    text: "42",
    state: "good",
  });
  expect(hardwareUpdate("Connection lost", samples).samples[0]).toMatchObject({
    text: "42 (stale)",
    state: "stale",
  });
  expect(hardwareUpdate("Connection lost", samples).samples[0]?.title).toContain(
    "Source 2026-10-12T23:59:59Z",
  );
  expect(
    hardwareUpdate(
      "Connected",
      new Map([["Counter", { ...sample, good: false, quality: "BadNotConnected" }]]),
    ).samples[0],
  ).toMatchObject({ text: "BadNotConnected", state: "bad" });
});

test("monitor messages update text without replacing controls, focus or expanded rows", () => {
  const listeners = new Map<string, (event?: unknown) => void>();
  const row = { dataset: { parent: "Adapter:inputs.Byte0" }, hidden: true };
  const cell = { dataset: { symbol: "Counter" }, textContent: "—", title: "", className: "muted" };
  const section = { dataset: { section: "Adapter:input" }, open: true, addEventListener() {} };
  const attributes = new Map([["aria-expanded", "false"]]);
  const button = {
    dataset: { bitToggle: "Adapter:inputs.Byte0" },
    textContent: "+",
    getAttribute: (key: string) => attributes.get(key),
    setAttribute: (key: string, value: string) => attributes.set(key, value),
    addEventListener: (name: string, listener: () => void) => listeners.set(name, listener),
  };
  const connection = { textContent: "Disconnected" };
  const saved: unknown[] = [],
    messages: unknown[] = [];
  const document = {
    body: { dataset: { project: "/fixture/tsplc.config.ts" } },
    activeElement: button,
    querySelectorAll: (selector: string) =>
      ({
        "details[data-section]": [section],
        "[data-bit-toggle]": [button],
        "tr[data-parent]": [row],
        "[data-symbol]": [cell],
        "[data-action]": [],
      })[selector as "[data-symbol]"],
    getElementById: () => connection,
  };
  runInNewContext(readFileSync(new URL("../media/hardware-view.js", import.meta.url), "utf8"), {
    document,
    window: {
      addEventListener: (name: string, listener: (event: unknown) => void) =>
        listeners.set(name, listener),
    },
    acquireVsCodeApi: () => ({
      getState: () => undefined,
      setState: (state: unknown) => saved.push(state),
      postMessage: (message: unknown) => messages.push(message),
    }),
  });
  listeners.get("click")?.();
  expect(row.hidden).toBe(false);
  expect(attributes.get("aria-expanded")).toBe("true");
  section.open = false;
  listeners.get("message")?.({
    data: {
      action: "samples",
      connection: "Connected",
      samples: [
        { symbol: "Counter", text: '<img src="x" onerror="bad()">', title: "Good", state: "good" },
      ],
    },
  });
  expect(cell.textContent).toBe('<img src="x" onerror="bad()">');
  expect(connection.textContent).toBe("Connected");
  expect(document.activeElement).toBe(button);
  expect(section.open).toBe(false);
  expect(row.hidden).toBe(false);
  expect(messages).toEqual([{ action: "ready" }]);
  expect(saved).toHaveLength(1);
  listeners.get("message")?.({
    data: { action: "samples", connection: "Disconnected", samples: [] },
  });
  expect(cell.textContent).toBe("—");
  expect(cell.className).toBe("muted");
});
