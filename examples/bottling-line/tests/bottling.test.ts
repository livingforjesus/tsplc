import { beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadSources, resolveConfig, type SourceObject } from "@tsplc/build";
import { analyze } from "@tsplc/compiler";
import { emitCodesys } from "@tsplc/compiler/codesys";
import { normalizeModule, type VerifiedCoreModule } from "@tsplc/compiler/ir";
import { checkProject, projectIoTargets } from "@tsplc/compiler/project";
import { loadTsplcConfig, rawBuildConfig } from "@tsplc/config";
import { generateProject } from "@tsplc/typegen";
import { loadHardware, resolveIo } from "@tsplc/typegen/hardware";
import { machine, type Value } from "../../../tests/support/machine.ts";

const example = join(dirname(fileURLToPath(import.meta.url)), "..");

function checked(module: string, name: string): VerifiedCoreModule {
  const source = analyze({
    tsconfig: join(example, "tsconfig.json"),
    programs: { [name]: { module, export: name } },
  });
  if (!source.module) throw new Error(JSON.stringify(source.diagnostics));
  const normalized = normalizeModule(source.module);
  if (!normalized.core) throw new Error(JSON.stringify(normalized.diagnostics));
  return normalized.core;
}

// Tests execute normalized PLC IR with timer/edge models. The TypeScript source is
// compiler input; it never runs as JavaScript.
const core = checked("./src/main.ts", "main");
type Runtime = ReturnType<typeof machine>;
type RecordValue = { [key: string]: Value };

function record(value: Value | undefined): RecordValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Expected a PLC record");
  }
  return value;
}

function list(value: Value | undefined): Value[] {
  if (!Array.isArray(value)) throw new Error("Expected a PLC array");
  return value;
}

const line = (runtime: Runtime, name: string) => record(runtime.get(name, "Line"));
const counters = (runtime: Runtime) => record(runtime.get("Counters", "Production"));
const valves = (runtime: Runtime) => list(line(runtime, "Filler").Valves).map(record);

/** Hold Start for one scan with a healthy emergency-stop chain. */
function start(runtime: Runtime): void {
  runtime.set("EStopHealthy", true);
  runtime.set("StartButton", true);
  runtime.scan(10);
  runtime.set("StartButton", false);
  runtime.scan(10);
}

describe("bottling line project", () => {
  // The config type-checks its io keys against generated/hardware.ts, which is not
  // committed. Generate the typed form first, as `tsplc typegen` does on a fresh checkout.
  beforeAll(async () => {
    const config = join(example, "tsplc.config.ts");
    await generateProject(config, {
      hardwareOnly: true,
      targets: await projectIoTargets(config),
    });
  });

  test("emits published lists, retained counters, Util.BLINK, both tasks and every IO binding", async () => {
    const checkedProject = await checkProject(join(example, "tsplc.config.ts"));
    expect(checkedProject.diagnostics).toEqual([]);
    const plan = checkedProject.plan;
    if (!plan) throw new Error("Expected a CODESYS plan.");
    expect(plan.deployment.tasks).toEqual([
      { name: "MainTask", intervalNanoseconds: "10000000", priority: 1, programs: ["main"] },
      {
        name: "HeartbeatTask",
        intervalNanoseconds: "100000000",
        priority: 10,
        programs: ["heartbeat"],
      },
    ]);
    const bundle = emitCodesys(plan);
    expect(bundle.diagnostics).toEqual([]);
    const object = (name: string) => {
      const found = bundle.objects.find((item) => item.name === name);
      if (!found) throw new Error(`Missing emitted object ${name}.`);
      return found;
    };

    // Programs and globals keep the IEC names selected in tsplc.config.ts.
    expect(object("Main").kind).toBe("program");
    expect(object("Heartbeat").kind).toBe("program");
    for (const name of ["Line", "Production", "Diagnostics"]) {
      const declaration = object(name).declaration;
      expect(declaration).toStartWith("{attribute 'linkalways'}");
      const variables = plan.core.variables.filter((variable) =>
        variable.span.file.endsWith(`/src/${name}.ts`),
      );
      expect(declaration.match(/attribute 'symbol' := 'readwrite'/g)).toHaveLength(
        variables.length,
      );
    }
    expect(object("Production").declaration).toContain("VAR_GLOBAL RETAIN");
    expect(object("Settings").declaration).toContain("VAR_GLOBAL CONSTANT");
    expect(object("Settings").declaration).not.toContain("attribute 'symbol'");
    expect(object("FB_StackLight").declaration).toContain("flasher : Util.BLINK;");
    for (const name of ["E_LineState", "E_FillerStep", "E_Product", "ST_Reader", "ST_Filler"])
      expect(object(name).declaration).toContain(`TYPE ${name}`);
    expect(
      plan.core.types.some(
        (type) => type.kind === "array" && type.length === 4 && type.lowerBound === 1,
      ),
    ).toBe(true);
    expect(plan.core.types.some((type) => type.kind === "array" && type.length === 480)).toBe(true);

    // Storage paths, logical names and direct addresses all resolve to physical variables.
    const io = object("GVL_IO").declaration;
    for (const declaration of [
      "Line_Filler_BottlesInPlace_physical AT %IX576.2 : BOOL;",
      "Line_Filler_Valves_1_Open_physical AT %QX577.0 : BOOL;",
      "Line_Filler_Valves_4_Open_physical AT %QX577.3 : BOOL;",
      "Line_Reader_Input_ResultCode_physical AT %IW10 : WORD;",
      "Line_Reader_Input_ResultData_physical AT %IB16 : plc_T_array_BYTE_480_0;",
      "Line_Reader_Output_ResultsAck_physical AT %QX0.3 : BOOL;",
      "Line_Infeed_Status_physical AT %IW512 : WORD;",
      "Line_Infeed_Speed_physical AT %QW524 : UINT;",
      "StartButton_physical AT %IX576.0 : BOOL;",
      "RecipeSelector_physical AT %IB577 : BYTE;",
      "RejectGate_physical AT %QX576.1 : BOOL;",
      "EStopHealthy_physical AT %IX700.0 : BOOL;",
      "FaultLamp_physical AT %QX700.1 : BOOL;",
    ])
      expect(io).toContain(declaration);

    // Inputs are copied in before the scan body; outputs are committed after it.
    const body = (object("Main").implementation ?? "").split("\n");
    const call = body.indexOf("plc_discard := F_main();");
    expect(call).toBeGreaterThan(0);
    expect(
      body.indexOf("Line.Reader.Input.ResultData := GVL_IO.Line_Reader_Input_ResultData_physical;"),
    ).toBeLessThan(call);
    expect(
      body.indexOf("GVL_IO.Line_Filler_Valves_1_Open_physical := Line.Filler.Valves[1].Open;"),
    ).toBeGreaterThan(call);
  });

  test("starts on a Start edge, stops on Stop and latches an emergency stop until acknowledged", () => {
    const runtime = machine(core);
    runtime.set("StartButton", true);
    runtime.scan(10);
    expect(line(runtime, "Status").State).toBe(0n);
    runtime.set("StartButton", false);
    runtime.scan(10);

    start(runtime);
    expect(line(runtime, "Status").State).toBe(1n);
    expect(line(runtime, "Status").Message).toBe("Running");
    expect(runtime.get("RunLamp")).toBe(true);

    runtime.set("StopButton", true);
    runtime.scan(10);
    expect(line(runtime, "Status").State).toBe(0n);
    runtime.set("StopButton", false);
    start(runtime);
    expect(line(runtime, "Status").State).toBe(1n);

    runtime.set("EStopHealthy", false);
    runtime.scan(10);
    expect(line(runtime, "Status").State).toBe(2n);
    expect(runtime.get("RunLamp")).toBe(false);
    // Start alone cannot leave the fault.
    start(runtime);
    expect(line(runtime, "Status").State).toBe(2n);
    runtime.set("StopButton", true);
    runtime.scan(10);
    expect(line(runtime, "Status").State).toBe(0n);
  });

  test("flashes the fault lamp from Util.BLINK at its phase boundaries", () => {
    const runtime = machine(core);
    start(runtime);
    runtime.set("EStopHealthy", false);
    runtime.scan(10);
    const lamp: Value[] = [];
    for (let elapsed = 10; elapsed <= 1500; elapsed += 10) {
      runtime.scan(10);
      if (elapsed % 250 === 0) lamp.push(runtime.get("FaultLamp")!);
    }
    // Low for 500 ms, high for 500 ms, then low again.
    expect(lamp).toEqual([false, true, true, false, false, true]);
  });

  test("latches the selected recipe only while stopped", () => {
    const runtime = machine(core);
    runtime.set("RecipeSelector", 2n);
    runtime.scan(10);
    const recipe = () => record(line(runtime, "Status").Recipe);
    expect(recipe()).toEqual({
      Product: 2n,
      Name: "Orange juice 1 L",
      FillTime: 2_500_000_000n,
      ConveyorSpeed: 300n,
    });
    start(runtime);
    expect(line(runtime, "Infeed").Speed).toBe(300n);
    runtime.set("RecipeSelector", 4n);
    runtime.scan(10);
    expect(recipe().Name).toBe("Orange juice 1 L");
    runtime.set("StopButton", true);
    runtime.scan(10);
    expect(recipe().Name).toBe("Orange juice 1 L");
    runtime.scan(10);
    expect(recipe().Name).toBe("Lemon soda 0.5 L");
    expect(line(runtime, "Infeed").Speed).toBe(0n);
    runtime.set("RecipeSelector", 9n);
    runtime.scan(10);
    expect(recipe().Product).toBe(1n);
  });

  test("fills a set of bottles for the recipe time, counts them and releases them", () => {
    const runtime = machine(core);
    runtime.set("RecipeSelector", 3n);
    start(runtime);
    const filler = line(runtime, "Filler");
    expect(filler.GateClosed).toBe(true);
    filler.BottlesInPlace = true;
    runtime.scan(10);
    expect(filler.Step).toBe(1n);
    expect(valves(runtime).every((valve) => valve.Open === true)).toBe(true);

    // Stopping mid-fill closes every valve and restarts the fill time on resume.
    runtime.scan(600);
    runtime.set("StopButton", true);
    runtime.scan(10);
    expect(valves(runtime).every((valve) => valve.Open === false)).toBe(true);
    runtime.set("StopButton", false);
    start(runtime);
    runtime.scan(1180);
    expect(filler.Step).toBe(1n);
    runtime.scan(10);
    expect(filler.Step).toBe(2n);
    expect(filler.GateClosed).toBe(false);
    expect(valves(runtime).map((valve) => valve.Open)).toEqual([false, false, false, false]);
    expect(valves(runtime).map((valve) => valve.Fills)).toEqual([1n, 1n, 1n, 1n]);
    expect(counters(runtime).Filled).toBe(4n);

    runtime.scan(10);
    expect(filler.Step).toBe(2n);
    filler.BottlesInPlace = false;
    runtime.scan(10);
    expect(filler.Step).toBe(0n);
    expect(filler.GateClosed).toBe(true);
  });

  test("copies a 480-byte label, acknowledges it and rejects no-reads with a timed pulse", () => {
    const runtime = machine(core);
    const reader = line(runtime, "Reader");
    const input = record(reader.Input);
    const bytes = Array.from({ length: 480 }, (_, index) => BigInt(index % 256));
    Object.assign(input, {
      ResultsAvailable: true,
      ResultCode: 1n,
      ResultLength: 480n,
      ResultData: bytes,
    });
    runtime.scan(10);
    expect(reader.LastCode).toEqual(bytes);
    expect(reader.LastLength).toBe(480n);
    // (0 + ... + 255) + (0 + ... + 223) = 57616, and 57616 mod 256 = 16.
    expect(reader.LastChecksum).toBe(16n);
    expect(record(reader.Output).ResultsAck).toBe(true);
    input.ResultData = Array(480).fill(7n);
    runtime.scan(10);
    expect(reader.LastCode).toEqual(bytes);
    input.ResultsAvailable = false;
    runtime.scan(10);
    expect(record(reader.Output).ResultsAck).toBe(false);

    for (const [code, length] of [
      [0n, 12n],
      [1n, 0n],
      [1n, 481n],
    ]) {
      Object.assign(input, { ResultsAvailable: true, ResultCode: code, ResultLength: length });
      runtime.scan(10);
      expect(runtime.get("RejectGate")).toBe(true);
      expect(record(reader.Output).ResultsAck).toBe(true);
      input.ResultsAvailable = false;
      runtime.scan(290);
      expect(runtime.get("RejectGate")).toBe(true);
      runtime.scan(10);
      expect(runtime.get("RejectGate")).toBe(false);
    }
    expect(reader.NoReads).toBe(3n);
    expect(counters(runtime).Rejected).toBe(3n);
    expect(line(runtime, "Status").RejectsShown).toBe(3n);
    expect(reader.LastLength).toBe(480n);
  });

  test("clips the HMI reject counter and wraps the retained totals", () => {
    const runtime = machine(core);
    counters(runtime).Rejected = 70_000n;
    runtime.scan(10);
    expect(line(runtime, "Status").RejectsShown).toBe(65_535n);
    counters(runtime).Rejected = 4_294_967_295n;
    Object.assign(record(line(runtime, "Reader").Input), {
      ResultsAvailable: true,
      ResultCode: 0n,
    });
    runtime.scan(10);
    expect(counters(runtime).Rejected).toBe(0n);
  });

  test("the heartbeat task owns its own counter and wraps it", () => {
    const runtime = machine(checked("./src/heartbeat.ts", "heartbeat"));
    const watchdog = record(runtime.get("Watchdog", "Diagnostics"));
    watchdog.Ticks = 4_294_967_294n;
    runtime.scan(100);
    expect(watchdog).toEqual({ Ticks: 4_294_967_295n, Alive: true });
    runtime.scan(100);
    expect(watchdog).toEqual({ Ticks: 0n, Alive: false });
  });
});

describe("raw Structured Text variant", () => {
  test("binds qualified IO names in memory and keeps every IEC object kind", async () => {
    const directory = join(example, "raw-st");
    // The same resolution `tsplc check` performs for a raw-ST project.
    const { config, configFile, root } = await loadTsplcConfig(join(directory, "tsplc.config.ts"));
    const io = resolveIo(config, await loadHardware(config, root));
    const sources = await loadSources(resolveConfig({ ...rawBuildConfig(config), io }, configFile));
    expect(sources.entry).toBe("Main");
    const list = sources.objects.find((object) => object.name === "IO");
    if (!list) throw new Error("Missing IO global list.");
    for (const binding of [
      "StartButton AT %IX700.0 : BOOL;",
      "CapperRun AT %QX700.0 : BOOL;",
      "ZoneStatus AT %IW512 : UINT;",
      "InfeedSpeed AT %QW524 : UINT;",
    ])
      expect(list.declaration).toContain(binding);
    expect(readFileSync(join(directory, "src/io/IO.st"), "utf8")).not.toContain(" AT ");

    const descendants = (objects: SourceObject[]): SourceObject[] =>
      objects.flatMap((object) => [object, ...descendants(object.children)]);
    const objects = descendants(sources.objects);
    for (const kind of ["program", "function_block", "function", "interface", "method"])
      expect(objects.some((object) => object.kind === kind)).toBe(true);
    for (const kind of ["property", "get", "set", "action", "dut", "gvl"])
      expect(objects.some((object) => object.kind === kind)).toBe(true);
    for (const kind of ["structure", "enumeration", "union", "alias"])
      expect(objects.some((object) => object.dutType === kind)).toBe(true);
    const capper = sources.objects.find((object) => object.name === "FB_Capper");
    expect(capper?.folder).toEqual(["capping"]);
    expect(capper?.children.map((child) => child.name)).toEqual(["Reset"]);
  });
});
