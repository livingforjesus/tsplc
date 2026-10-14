import { afterAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { codesys, emitCodesys, planCodesys } from "@vplc/compiler/codesys";
import { analyze } from "@vplc/compiler";
import { normalizeModule, type VerifiedCoreModule } from "@vplc/compiler/ir";
import { machine, type Value } from "./support/machine.ts";

const example = join(dirname(fileURLToPath(import.meta.url)), "../examples/frame-assembly");
const directories: string[] = [];

function checked(tsconfig: string, module: string): VerifiedCoreModule {
  const frontend = analyze({ tsconfig, programs: { main: { module, export: "main" } } });
  if (!frontend.module) throw new Error(JSON.stringify(frontend.diagnostics));
  const result = normalizeModule(frontend.module);
  if (!result.core) throw new Error(JSON.stringify(result.diagnostics));
  return result.core;
}

// Tests compile the real PLC source. They never execute it as JavaScript or load
// a product PLC runtime; the test executor observes normalized scan semantics.
const core = checked(join(example, "tsconfig.json"), "./src/Main.ts");
type Runtime = ReturnType<typeof machine>;
type RecordValue = { [key: string]: Value };

function record(value: Value | undefined): RecordValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Expected a PLC record in the frame-assembly test.");
  }
  return value;
}

function device(runtime: Runtime, name: string, module?: string): RecordValue {
  return record(runtime.get(name, module));
}

function start(runtime: Runtime): void {
  for (const name of ["EmergencyStop01", "EmergencyStop02", "EmergencyStop03"]) {
    device(runtime, name).Valid = true;
  }
  runtime.scan();
  device(runtime, "Button_SystemStart01").Pressed = true;
  runtime.scan();
}

function driver(source: string): Runtime {
  const directory = mkdtempSync(join(tmpdir(), "plcts-frame-driver-"));
  directories.push(directory);
  writeFileSync(
    join(directory, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: { allowImportingTsExtensions: true },
      include: ["main.ts"],
    }),
  );
  writeFileSync(join(directory, "main.ts"), source.replaceAll("@frame/", `${example}/src/`));
  return machine(checked(join(directory, "tsconfig.json"), "./main.ts"));
}

afterAll(() => {
  for (const directory of directories) rmSync(directory, { recursive: true, force: true });
});

describe("complete frame-assembly port", () => {
  test("tracks every authored file and preserves the externally published GVL ABI", () => {
    const manifest = readFileSync(join(example, "PORT.md"), "utf8");
    const rows = [
      ...manifest.matchAll(
        /\|\s*`([^`]+)`\s*\|\s*`([^`]+)`\s*\|\s*`([a-f0-9]{64})`\s*\|\s*`([a-f0-9]{64})`\s*\|/g,
      ),
    ];
    expect(rows).toHaveLength(51);
    expect(rows.filter((row) => row[1]?.endsWith(".st"))).toHaveLength(42);
    for (const row of rows) {
      const path = row[2];
      const expectedHash = row[4];
      if (!path || !expectedHash) throw new Error("Incomplete ported manifest row.");
      const hash = createHash("sha256")
        .update(readFileSync(join(example, path)))
        .digest("hex");
      expect(hash).toBe(expectedHash);
    }

    const names = ["LineIO", "LineStations", "LineCollections", "LineScannerRequests"];
    const result = planCodesys(
      core,
      {
        tasks: [
          {
            name: "MainTask",
            intervalNanoseconds: "20000000",
            priority: 1,
            programs: ["main"],
          },
        ],
      },
      codesys({
        engineering: { kind: "v3.5" },
        profile: { directAddressing: "byte" },
        io: {},
        globalListNames: Object.fromEntries(
          [...names, "LineConstants"].map((name) => [name, name]),
        ),
        publishGlobalLists: names,
        programNames: { main: "Main" },
      }).options,
    );
    if (!result.plan) throw new Error(JSON.stringify(result.diagnostics));
    const bundle = emitCodesys(result.plan);
    expect(bundle.diagnostics).toEqual([]);

    // Existing OPC UA and simulation consumers import these published DUT names.
    const carrier = bundle.objects.find((object) => object.name === "E_LineCarrier");
    const scanner = bundle.objects.find((object) => object.name === "ST_LineScanner");
    expect(carrier?.kind).toBe("dataType");
    expect(carrier?.declaration).toContain("TYPE E_LineCarrier");
    expect(scanner?.declaration).toContain("TYPE ST_LineScanner");
    const cardTypes = bundle.objects.filter((object) =>
      /^ST_LineCS1001(?:Input|Output)?$/.test(object.name),
    );
    expect(cardTypes).toHaveLength(3);
    expect(cardTypes.every((object) => object.sourcePath?.startsWith("types/ST_LineCS1001/"))).toBe(
      true,
    );

    for (const name of names) {
      const object = bundle.objects.find((object) => object.name === name);
      if (!object) throw new Error(`Missing original GVL ${name}.`);
      expect(object.declaration).toStartWith("{attribute 'linkalways'}");
      const moduleVariables = core.variables.filter((variable) =>
        variable.span.file.endsWith(`/globals/${name}.ts`),
      );
      expect(object.declaration.match(/attribute 'symbol' := 'readwrite'/g)).toHaveLength(
        moduleVariables.length,
      );
      for (const variable of moduleVariables)
        expect(object.declaration).toContain(`    ${variable.name} : `);
    }
    expect(
      bundle.objects.find((object) => object.name === "LineConstants")?.declaration,
    ).not.toContain("attribute 'symbol'");
    const records = core.types.filter((type) => type.kind === "record");
    expect(records.find((type) => type.id.includes("ST_LineScannerInput"))).toBeDefined();
    expect(
      core.types.some(
        (type) => type.kind === "array" && type.length === 256 && type.lowerBound === 1,
      ),
    ).toBe(true);
    expect(core.types.some((type) => type.kind === "array" && type.length === 484)).toBe(true);
    expect(core.types.some((type) => type.kind === "array" && type.length === 492)).toBe(true);
  });

  test("updates all conveyor slots and requires a fresh start after stop or invalid estop", () => {
    const runtime = machine(core);
    start(runtime);
    for (const [name, count] of [
      ["Conveyor_Inbound", 113],
      ["Conveyor_Outbound", 68],
      ["Conveyor_CarrierSorting", 25],
    ] as const) {
      const conveyor = device(runtime, name);
      expect(conveyor.Enabled).toBe(true);
      expect(conveyor.CardCount).toBe(BigInt(count));
      const cards = conveyor.Cards;
      if (!Array.isArray(cards)) throw new Error("Expected fixed conveyor card array.");
      expect(cards).toHaveLength(256);
      expect(
        cards.every((card, index) => record(record(card).Output).MotionAsserted === index >= count),
      ).toBe(true);
    }

    device(runtime, "Button_SystemStop01").Pressed = true;
    runtime.scan();
    device(runtime, "Button_SystemStop01").Pressed = false;
    runtime.scan();
    expect(device(runtime, "Conveyor_Inbound").Enabled).toBe(false);
    device(runtime, "Button_SystemStart01").Pressed = false;
    runtime.scan();
    device(runtime, "Button_SystemStart01").Pressed = true;
    runtime.scan();
    expect(device(runtime, "Conveyor_Inbound").Enabled).toBe(true);

    device(runtime, "EmergencyStop02").Valid = false;
    runtime.scan();
    device(runtime, "EmergencyStop02").Valid = true;
    runtime.scan();
    expect(device(runtime, "Conveyor_Inbound").Enabled).toBe(false);
    const stoppedCards = device(runtime, "Conveyor_Inbound").Cards;
    if (!Array.isArray(stoppedCards)) throw new Error("Expected fixed card array.");
    expect(stoppedCards.every((card) => record(record(card).Output).MotionAsserted === true)).toBe(
      true,
    );
  });

  test("scanner captures all 484 bytes and holds ACK through the complete worker handshake", () => {
    const runtime = machine(core);
    const scanner = device(runtime, "Scanner_Oversize");
    const input = record(scanner.Input);
    const bytes = Array.from({ length: 484 }, (_, index) => BigInt(index % 256));
    Object.assign(input, {
      ResultsAvailable: true,
      ResultCode: 1n,
      ResultLength: 484n,
      ResultData: bytes,
    });
    runtime.scan();
    const request = device(runtime, "Oversize", "LineScannerRequests");
    expect(request.RequestReady).toBe(true);
    expect(request.BarcodeLength).toBe(484n);
    expect(request.Barcode).toEqual(bytes);
    expect(request.ConveyorId).toBe(1n);
    expect(request.DiverterId).toBe(1n);
    expect(record(scanner.Output).ResultsAck).toBe(true);
    input.ResultData = Array(484).fill(9n);
    runtime.scan();
    expect(request.Barcode).toEqual(bytes);

    const diverter = device(runtime, "Diverter_Oversize");
    record(diverter.Route).TargetStation = 2n;
    request.ResultReady = true;
    request.ApplyRouting = false;
    record(request.RoutingResult).Barcode = "straight-through";
    record(request.RoutingResult).TargetStation = 1n;
    runtime.scan();
    expect(request.RequestReady).toBe(false);
    expect(diverter.RouteReady).toBe(true);
    expect(record(diverter.Route).Barcode).toBe("straight-through");
    expect(record(diverter.Route).TargetStation).toBe(2n);
    expect(record(scanner.Output).ResultsAck).toBe(true);
    input.ResultsAvailable = false;
    runtime.scan();
    expect(record(scanner.Output).ResultsAck).toBe(false);
  });

  test("scanner rejects unreadable lengths and respects existing route and worker ownership", () => {
    for (const [code, length] of [
      [0n, 10n],
      [1n, 0n],
      [1n, 485n],
    ]) {
      const runtime = machine(core);
      Object.assign(record(device(runtime, "Scanner_Oversize").Input), {
        ResultsAvailable: true,
        ResultCode: code,
        ResultLength: length,
      });
      runtime.scan();
      expect(device(runtime, "Oversize", "LineScannerRequests").RequestReady).toBe(false);
      expect(device(runtime, "Diverter_Oversize").RouteReady).toBe(true);
      expect(record(device(runtime, "Scanner_Oversize").Output).ResultsAck).toBe(true);
    }
    for (const owner of ["RequestReady", "ResultReady", "RouteReady", "ResultsAck"]) {
      const runtime = machine(core);
      const scanner = device(runtime, "Scanner_Oversize");
      const request = device(runtime, "Oversize", "LineScannerRequests");
      Object.assign(record(scanner.Input), {
        ResultsAvailable: true,
        ResultCode: 1n,
        ResultLength: 10n,
      });
      if (owner === "RouteReady") device(runtime, "Diverter_Oversize").RouteReady = true;
      else if (owner === "ResultsAck") record(scanner.Output).ResultsAck = true;
      else request[owner] = true;
      runtime.scan();
      expect(request.BarcodeLength).toBe(0n);
      expect(request.RequestReady).toBe(owner === "RequestReady");
    }
  });

  test("main applies a scanner reply before diverter selection in the same scan", () => {
    const runtime = machine(core);
    for (const name of ["EmergencyStop01", "EmergencyStop02", "EmergencyStop03"])
      device(runtime, name).Valid = true;
    const station = device(runtime, "Station_Oversize");
    expect(station.Capacity).toBe(2n);
    expect(device(runtime, "Collection_EmptyBins").Full).toBe(true);
    station.Enabled = true;
    runtime.scan();

    device(runtime, "Button_SystemStart01").Pressed = true;
    const request = device(runtime, "Oversize", "LineScannerRequests");
    Object.assign(request, { RequestReady: true, ResultReady: true, ApplyRouting: true });
    Object.assign(record(request.RoutingResult), {
      Barcode: "frame-123",
      TargetStation: 1n,
      HasQC: true,
    });
    const diverter = device(runtime, "Diverter_Oversize");
    diverter.BinPresent = true;
    runtime.scan();
    expect(device(runtime, "Conveyor_Inbound").Enabled).toBe(true);
    expect(request.RequestReady).toBe(false);
    expect(record(diverter.Route).Barcode).toBe("frame-123");
    expect(record(diverter.Route).HasQC).toBe(true);
    expect(record(diverter.Status).SelectedDirection).toBe(2n);
  });

  test("diverter locks unavailable routes and clears readiness only on departure", () => {
    const runtime = driver(`
      import { FB_Diverter } from "@frame/diverters/FB_Diverter/FB_Diverter.ts";
      import type { ST_LineDiverter } from "@frame/types/ST_LineDiverter/ST_LineDiverter.ts";
      const control = new FB_Diverter();
      let Diverter: ST_LineDiverter = defaultValue<ST_LineDiverter>();
      let Enabled: BOOL = true;
      let Direction: INT = 2;
      let Available: BOOL = false;
      export function main(): void {
        control.update({ Enabled, RequestedDirection: Direction, LeftAvailable: Available,
          RightAvailable: true, Diverter: ref(Diverter) });
      }
    `);
    const diverter = device(runtime, "Diverter");
    diverter.RouteReady = true;
    Object.assign(record(diverter.Route), {
      Barcode: "early",
      TargetStation: 1n,
      HasQC: true,
      EmptyBin: true,
      TargetCarrier: 1n,
    });
    runtime.scan();
    expect(diverter.RouteReady).toBe(true);
    expect(record(diverter.Route).Barcode).toBe("early");
    diverter.BinPresent = true;
    runtime.scan();
    expect(record(diverter.Status).SelectedDirection).toBe(1n);
    runtime.set("Available", true);
    runtime.scan();
    expect(record(diverter.Status).SelectedDirection).toBe(1n);

    const lift = record(diverter.Lift);
    record(lift.Input).MotorOverloaded = true;
    runtime.scan();
    expect(record(lift.Status).Position).toBe(1n);
    expect(record(record(diverter.ThroughDrive).Output).MotionAsserted).toBe(true);
    runtime.set("Enabled", false);
    runtime.scan();
    expect(record(record(diverter.ThroughDrive).Output).MotionAsserted).toBe(false);

    diverter.BinPresent = false;
    runtime.scan();
    expect(diverter.RouteReady).toBe(false);
    expect(diverter.Route).toEqual({
      Barcode: "",
      EmptyBin: false,
      HasQC: false,
      TargetStation: 0n,
      TargetCarrier: 0n,
    });
  });

  test("lift requires qualified endpoint feedback and latches timeout until a fresh request", () => {
    const source = `
      import { FB_LineLift } from "@frame/lifts/FB_LineLift/FB_LineLift.ts";
      import type { ST_LineLift } from "@frame/types/ST_LineLift/ST_LineLift.ts";
      const control = new FB_LineLift();
      let Lift: ST_LineLift = defaultValue<ST_LineLift>();
      export function main(): void { control.update({ Lift: ref(Lift), MotionTimeout: ms(30) }); }
    `;
    const runtime = driver(source);
    const lift = device(runtime, "Lift");
    lift.Command = 1n;
    runtime.scan(10);
    expect(record(lift.Output).MotorRun).toBe(false);
    runtime.scan(10);
    expect(record(lift.Output).MotorRun).toBe(true);
    expect(record(lift.Output).MotorReverse).toBe(true);
    runtime.scan(30);
    expect(record(lift.Status).MotionTimedOut).toBe(true);
    expect(record(lift.Status).Faulted).toBe(true);
    expect(record(lift.Output).MotorRun).toBe(false);
    runtime.scan(30);
    expect(record(lift.Output).MotorRun).toBe(false);
    lift.Command = 0n;
    runtime.scan();
    lift.Command = 1n;
    runtime.scan();
    expect(record(lift.Status).MotionTimedOut).toBe(false);
    runtime.scan(10);
    record(lift.Input).MotorOverloaded = true;
    record(lift.Input).MotorStalled = true;
    runtime.scan(10);
    expect(record(lift.Status).Position).toBe(2n);
    expect(record(lift.Status).Faulted).toBe(false);
    expect(record(lift.Output).MotorRun).toBe(false);

    for (const fault of [
      "MotorOverloaded",
      "MotorStalled",
      "MotorNotConnected",
      "MotorOverCurrent",
      "MotorShortCircuit",
      "MotorOverheated",
      "MotorOverVoltage",
      "MotorLowVoltage",
      "MotorUnavailable",
    ]) {
      const failed = driver(source);
      const hardware = device(failed, "Lift");
      hardware.Command = 1n;
      record(hardware.Input)[fault] = true;
      failed.scan();
      expect(record(hardware.Status).Faulted).toBe(true);
      expect(record(hardware.Status).Position).toBe(0n);
      expect(record(hardware.Output).MotorRun).toBe(false);
    }
  });

  test("lift rejects conflicting and wrong-direction feedback during motion", () => {
    const source = `
      import { FB_LineLift } from "@frame/lifts/FB_LineLift/FB_LineLift.ts";
      import type { ST_LineLift } from "@frame/types/ST_LineLift/ST_LineLift.ts";
      const control = new FB_LineLift();
      let Lift: ST_LineLift = defaultValue<ST_LineLift>();
      export function main(): void { control.update({ Lift: ref(Lift), MotionTimeout: seconds(3) }); }
    `;
    for (const [command, feedback] of [
      [1n, { MotorRunningCW: true, MotorRunningCCW: true }],
      [1n, { MotorRunningCW: false, MotorRunningCCW: true }],
      [2n, { MotorRunningCW: true, MotorRunningCCW: false }],
    ] as const) {
      const runtime = driver(source);
      const lift = device(runtime, "Lift");
      lift.Command = command;
      runtime.scan();
      runtime.scan();
      expect(record(lift.Output).MotorRun).toBe(true);
      Object.assign(record(lift.Input), feedback);
      runtime.scan();
      expect(record(lift.Status).Faulted).toBe(true);
      expect(record(lift.Status).Position).toBe(0n);
      expect(record(lift.Output).MotorRun).toBe(false);
    }
  });

  test("finishing alternates once per arrival, beginning with straight through", () => {
    const runtime = machine(core);
    start(runtime);
    const diverter = device(runtime, "Diverter_ShrinkWrapLoadBalancer");
    diverter.BinPresent = true;
    runtime.scan();
    expect(record(diverter.Status).SelectedDirection).toBe(1n);
    runtime.scan();
    expect(record(diverter.Status).SelectedDirection).toBe(1n);
    diverter.BinPresent = false;
    runtime.scan();
    diverter.BinPresent = true;
    runtime.scan();
    expect(record(diverter.Status).SelectedDirection).toBe(2n);
  });
});
