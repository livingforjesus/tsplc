import { afterAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyze } from "@vplc/compiler";
import { emitCodesys, planCodesys } from "@vplc/compiler/codesys";
import { normalizeModule, type VerifiedCoreModule } from "@vplc/compiler/ir";
import { machine, type Value } from "../../../tests/support/machine.ts";

const example = join(dirname(fileURLToPath(import.meta.url)), "..");
const temporaryDirectories: string[] = [];

function checked(tsconfig: string, module: string): VerifiedCoreModule {
  const source = analyze({ tsconfig, programs: { main: { module, export: "main" } } });
  if (!source.module) throw new Error(JSON.stringify(source.diagnostics));
  const normalized = normalizeModule(source.module);
  if (!normalized.core) throw new Error(JSON.stringify(normalized.diagnostics));
  return normalized.core;
}

// Tests execute normalized PLC IR only. Authored TypeScript remains compiler input.
const core = checked(join(example, "tsconfig.json"), "./src/main.ts");
type Runtime = ReturnType<typeof machine>;
type RecordValue = { [key: string]: Value };

function record(value: Value | undefined): RecordValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Expected a PLC record");
  }
  return value;
}

function stored(runtime: Runtime, name: string): RecordValue {
  return record(runtime.get(name));
}

function output(runtime: Runtime, name: string): RecordValue {
  return record(stored(runtime, name).out);
}

function driver(imports: string, body: string): Runtime {
  const directory = mkdtempSync(join(tmpdir(), "plcts-mixing-driver-"));
  temporaryDirectories.push(directory);
  writeFileSync(
    join(directory, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: { allowImportingTsExtensions: true },
      include: ["main.ts"],
    }),
  );
  const resolved = imports
    .replaceAll("@mixing/", `${example}/src/`)
    .replaceAll("@vplc/compiler/types", `${example}/../../packages/compiler/types/index`);
  writeFileSync(
    join(directory, "main.ts"),
    `${resolved}\nexport function main(): void {\n${body}\n}\n`,
  );
  return machine(checked(join(directory, "tsconfig.json"), "./main.ts"));
}

afterAll(() => {
  for (const directory of temporaryDirectories) rmSync(directory, { recursive: true, force: true });
});

describe("complete upstream mixing-tank port", () => {
  test("preserves every upstream file and object, enum values, globals and native emission", () => {
    const upstream = JSON.parse(readFileSync(join(example, "upstream.json"), "utf8"));
    expect(upstream.files).toHaveLength(18);
    for (const file of upstream.files) {
      expect(
        createHash("sha256")
          .update(readFileSync(join(example, "upstream", file.path)))
          .digest("hex"),
      ).toBe(file.sha256);
    }
    const manifest = JSON.parse(readFileSync(join(example, "port.json"), "utf8"));
    expect(manifest.objects).toHaveLength(7);
    for (const object of manifest.objects) {
      expect(object.paths.length).toBeGreaterThan(0);
      for (const path of object.paths) expect(existsSync(join(example, path))).toBe(true);
    }
    const runtime = machine(core);
    expect(stored(runtime, "controllerState")).toEqual({ vMode: 0n, vModeOld: 0n, vAutoState: 0n });
    expect(stored(runtime, "simulatorState")).toEqual({ vTankLevel: 25, vMotorRotating: 0 });
    expect(Object.keys(stored(runtime, "IO"))).toHaveLength(10);
    expect(Object.keys(stored(runtime, "HMI"))).toHaveLength(14);
    expect(core.blocks.filter((block) => !block.standard).map((block) => block.name)).toEqual([
      "GenericBistableDeviceModel",
    ]);
    const planned = planCodesys(
      core,
      {
        tasks: [
          { name: "MainTask", intervalNanoseconds: "20000000", priority: 1, programs: ["main"] },
        ],
      },
      {
        engineering: { kind: "v3.5" },
        profile: { directAddressing: "byte" },
        io: {},
        programNames: { main: "Main" },
      },
    );
    if (!planned.plan) throw new Error(JSON.stringify(planned.diagnostics));
    const bundle = emitCodesys(planned.plan);
    const text = bundle.objects
      .map((object) => object.declaration + object.implementation)
      .join("\n");
    expect(text).toContain("TON");
    expect(text).toContain("REAL");
    expect(text).toContain("MANUAL := 0");
    expect(text).toContain("AUTO := 1");
    expect(text).toContain("DRAINING := 0");
    expect(text).toContain("FILLING := 1");
    expect(text).toContain("MIXING := 2");
  });

  test("runs a complete automatic drain-fill-mix-drain cycle through all four device models", () => {
    const runtime = machine(core);
    runtime.scan(20);
    stored(runtime, "HMI").SetToAuto = true;
    const transitions: bigint[] = [0n];
    let mixingFeedbackAt: number | undefined;
    let mixingStoppedAt: number | undefined;
    let elapsed = 20;
    for (let scan = 0; scan < 3000; scan++) {
      const before = structuredClone(stored(runtime, "IO"));
      const previousState = stored(runtime, "controllerState").vAutoState;
      runtime.scan(20);
      elapsed += 20;
      const state = stored(runtime, "controllerState").vAutoState;
      if (state !== previousState) {
        transitions.push(BigInt(state as bigint));
        if (state === 1n) {
          expect(before.xDI_LS02_TankLevelEmpty).toBe(true);
          expect(before.xDI_VV03_TankDrain_Opened).toBe(false);
        } else if (state === 2n) {
          expect(before.xDI_LS01_TankLevelFull).toBe(true);
          expect(before.xDI_VV01_Medium1_Opened).toBe(false);
          expect(before.xDI_VV02_Medium2_Opened).toBe(false);
        } else {
          mixingStoppedAt = elapsed;
          expect(output(runtime, "MixingTimer")).toMatchObject({ Q: true, ET: 10000000000n });
          expect(stored(runtime, "IO").xDO_M1_MixerMotorRunCmd).toBe(false);
          expect(stored(runtime, "IO").xDI_M1_MixerMotorRunning).toBe(false);
        }
      }
      if (
        state === 2n &&
        stored(runtime, "IO").xDI_M1_MixerMotorRunning &&
        mixingFeedbackAt === undefined
      ) {
        mixingFeedbackAt = elapsed;
      }
      const level = stored(runtime, "simulatorState").vTankLevel;
      if (typeof level !== "number" || level < 0 || level > 100 || Math.fround(level) !== level) {
        throw new Error("Tank simulation lost its bounded REAL storage contract");
      }
      if (stored(runtime, "HMI").CyclesCompleted === 2n) break;
    }
    expect(transitions).toEqual([0n, 1n, 2n, 0n, 1n]);
    expect(stored(runtime, "HMI")).toMatchObject({
      CyclesCompleted: 2n,
      SetToAuto: false,
      InAuto: true,
      InManual: false,
    });
    expect(mixingFeedbackAt).toBeDefined();
    expect(mixingStoppedAt).toBeDefined();
    // Controller sees new simulator feedback on the next 20ms scan.
    expect(Number(mixingStoppedAt) - Number(mixingFeedbackAt)).toBe(10020);
  });

  test("manual commands wait for feedback, latch devices and let stop/close win", () => {
    const runtime = machine(core);
    // Upstream manual mode allows opening even when full feedback is set.
    stored(runtime, "IO").xDI_LS01_TankLevelFull = true;
    Object.assign(stored(runtime, "HMI"), {
      MixerRunCmd: true,
      Medium1OpenCmd: true,
      Medium2OpenCmd: true,
      DrainOpenCmd: true,
    });
    runtime.scan(20);
    expect(stored(runtime, "IO")).toMatchObject({
      xDO_M1_MixerMotorRunCmd: true,
      xDO_VV01_Medium1_OpenCmd: true,
      xDO_VV02_Medium2_OpenCmd: true,
      xDO_VV03_TankDrain_OpenCmd: true,
    });
    expect(stored(runtime, "HMI").Medium1OpenCmd).toBe(true);
    for (let scan = 0; scan < 50; scan++) runtime.scan(20);
    expect(stored(runtime, "IO")).toMatchObject({
      xDI_VV01_Medium1_Opened: true,
      xDI_VV02_Medium2_Opened: true,
      xDI_VV03_TankDrain_Opened: true,
      xDI_M1_MixerMotorRunning: false,
    });
    expect(stored(runtime, "HMI").Medium1OpenCmd).toBe(true);
    runtime.scan(20);
    expect(stored(runtime, "HMI").Medium1OpenCmd).toBe(false);
    for (let scan = 0; scan < 49; scan++) runtime.scan(20);
    expect(stored(runtime, "IO").xDI_M1_MixerMotorRunning).toBe(true);
    runtime.scan(20);
    expect(stored(runtime, "HMI").MixerRunCmd).toBe(false);

    Object.assign(stored(runtime, "HMI"), {
      MixerRunCmd: true,
      MixerStopCmd: true,
      Medium1OpenCmd: true,
      Medium1CloseCmd: true,
      Medium2CloseCmd: true,
      DrainCloseCmd: true,
    });
    runtime.scan(20);
    expect(stored(runtime, "IO")).toMatchObject({
      xDO_M1_MixerMotorRunCmd: false,
      xDO_VV01_Medium1_OpenCmd: false,
      xDO_VV02_Medium2_OpenCmd: false,
      xDO_VV03_TankDrain_OpenCmd: false,
      xDI_M1_MixerMotorRunning: false,
    });
    expect(stored(runtime, "HMI").Medium1CloseCmd).toBe(true);
    for (let scan = 0; scan < 50; scan++) runtime.scan(20);
    expect(stored(runtime, "IO").xDI_VV01_Medium1_Opened).toBe(false);
    runtime.scan(20);
    expect(stored(runtime, "HMI")).toMatchObject({
      MixerStopCmd: false,
      Medium1CloseCmd: false,
      Medium2CloseCmd: false,
      DrainCloseCmd: false,
      InManual: true,
    });
  });

  test("model failure inputs inhibit transitions and a changed command resets the delay", () => {
    const runtime = driver(
      'import { GenericBistableDeviceModel } from "@mixing/device-model.ts";\nimport { defaultValue, seconds } from "@vplc/compiler/types";\nexport const commands = defaultValue<{ActivateCmd:BOOL;DeactivateCmd:BOOL;simActFail:BOOL;simDeactFail:BOOL}>();\nexport const device = new GenericBistableDeviceModel();',
      "device.update({ActivateCmd:commands.ActivateCmd,DeactivateCmd:commands.DeactivateCmd,cfgActTime:seconds(1),cfgDeactTime:seconds(1),simActFail:commands.simActFail,simDeactFail:commands.simDeactFail});",
    );
    expect(output(runtime, "device")).toEqual({ Activated: false, Deactivated: false });
    Object.assign(stored(runtime, "commands"), { ActivateCmd: true, simActFail: true });
    runtime.scan(20);
    runtime.scan(2000);
    expect(output(runtime, "device")).toEqual({ Activated: false, Deactivated: true });
    stored(runtime, "commands").simActFail = false;
    runtime.scan(20);
    runtime.scan(500);
    stored(runtime, "commands").ActivateCmd = false;
    runtime.scan(20);
    stored(runtime, "commands").ActivateCmd = true;
    runtime.scan(20);
    runtime.scan(980);
    expect(output(runtime, "device").Activated).toBe(false);
    runtime.scan(20);
    expect(output(runtime, "device")).toEqual({ Activated: true, Deactivated: false });

    Object.assign(stored(runtime, "commands"), {
      ActivateCmd: false,
      DeactivateCmd: true,
      simDeactFail: true,
    });
    runtime.scan(20);
    runtime.scan(2000);
    expect(output(runtime, "device").Activated).toBe(true);
    stored(runtime, "commands").simDeactFail = false;
    runtime.scan(20);
    runtime.scan(980);
    expect(output(runtime, "device").Activated).toBe(true);
    runtime.scan(20);
    expect(output(runtime, "device")).toEqual({ Activated: false, Deactivated: true });
  });

  test("REAL simulation rounds the promoted expression once, clamps levels and resets rotations", () => {
    const runtime = driver('import { simulator } from "@mixing/simulator.ts";', "simulator();");
    Object.assign(stored(runtime, "IO"), {
      xDO_VV01_Medium1_OpenCmd: true,
      xDO_VV02_Medium2_OpenCmd: true,
      xDO_VV03_TankDrain_OpenCmd: true,
      xDO_M1_MixerMotorRunCmd: true,
    });
    stored(runtime, "simulatorState").vTankLevel = Math.fround(0.1);
    runtime.scan(20);
    runtime.scan(1000);
    const expected = Math.fround(Math.fround(0.1) + 0.1 + 0.1 - 0.2);
    expect(stored(runtime, "simulatorState").vTankLevel).toBe(expected);
    expect(expected).toBe(Math.fround(0.1));
    runtime.scan(1000);
    stored(runtime, "simulatorState").vMotorRotating = 359;
    runtime.scan(20);
    expect(stored(runtime, "simulatorState").vMotorRotating).toBe(0);
    stored(runtime, "simulatorState").vTankLevel = 100;
    stored(runtime, "IO").xDO_VV03_TankDrain_OpenCmd = false;
    runtime.scan(20);
    runtime.scan(1000);
    expect(stored(runtime, "simulatorState").vTankLevel).toBe(100);
    expect(stored(runtime, "IO").xDI_LS01_TankLevelFull).toBe(true);
    stored(runtime, "simulatorState").vTankLevel = 0;
    Object.assign(stored(runtime, "IO"), {
      xDO_VV01_Medium1_OpenCmd: false,
      xDO_VV02_Medium2_OpenCmd: false,
      xDO_VV03_TankDrain_OpenCmd: true,
    });
    runtime.scan(20);
    runtime.scan(1000);
    // The earlier REAL store of 0.2 leaves a small positive promoted residue.
    expect(stored(runtime, "simulatorState").vTankLevel).toBe(
      Math.fround(Math.fround(0.1 + 0.1) - 0.2),
    );
    runtime.scan(20);
    expect(stored(runtime, "simulatorState").vTankLevel).toBe(0);
    expect(stored(runtime, "IO").xDI_LS02_TankLevelEmpty).toBe(true);
  });

  test("all eight valve combinations match the original promoted expression and one REAL store", () => {
    const inputs = [
      Math.fround(0.1),
      Math.fround(0.3),
      25,
      -0,
      0,
      100,
      Math.fround(3.4028234663852886e38),
    ];
    for (let combination = 0; combination < 8; combination++) {
      const medium1 = Boolean(combination & 1);
      const medium2 = Boolean(combination & 2);
      const drain = Boolean(combination & 4);
      const runtime = driver('import { simulator } from "@mixing/simulator.ts";', "simulator();");
      Object.assign(stored(runtime, "IO"), {
        xDO_VV01_Medium1_OpenCmd: medium1,
        xDO_VV02_Medium2_OpenCmd: medium2,
        xDO_VV03_TankDrain_OpenCmd: drain,
      });
      runtime.scan(0);
      runtime.scan(1000);
      expect(output(runtime, "MediumValve1").Activated).toBe(medium1);
      expect(output(runtime, "MediumValve2").Activated).toBe(medium2);
      expect(output(runtime, "DrainValve").Activated).toBe(drain);

      for (const level of inputs) {
        stored(runtime, "simulatorState").vTankLevel = level;
        runtime.scan(20);
        // JavaScript numbers represent these LREAL operations in source order;
        // Math.fround represents only the final original REAL assignment.
        const promoted =
          level + 0.1 * Number(medium1) + 0.1 * Number(medium2) - 0.2 * Number(drain);
        const expected = Math.max(0, Math.min(100, Math.fround(promoted)));
        const actual = stored(runtime, "simulatorState").vTankLevel;
        expect(Object.is(actual, expected)).toBe(true);
        if (combination === 7 && Object.is(level, Math.fround(0.1))) {
          const prematurelyRounded = Math.fround(
            Math.fround(Math.fround(level + Math.fround(0.1)) + Math.fround(0.1)) -
              Math.fround(0.2),
          );
          expect(actual).not.toBe(prematurelyRounded);
        }
      }
    }
  });

  test("mode entry, feedback reset, UINT cycle wrap and zero arithmetic retain the original rules", () => {
    const runtime = driver('import { controller } from "@mixing/controller.ts";', "controller();");
    Object.assign(stored(runtime, "IO"), {
      xDI_LS02_TankLevelEmpty: true,
      xDI_VV03_TankDrain_Opened: false,
    });
    Object.assign(stored(runtime, "HMI"), {
      SetToAuto: true,
      CyclesCompleted: 65535n,
      MixerRunCmd: true,
      MotorRotating: -0,
    });
    runtime.scan(20);
    expect(stored(runtime, "controllerState")).toEqual({ vMode: 1n, vModeOld: 1n, vAutoState: 1n });
    expect(stored(runtime, "HMI").CyclesCompleted).toBe(0n);
    expect(Object.is(stored(runtime, "HMI").MotorRotating, 0)).toBe(true);
    Object.assign(stored(runtime, "IO"), { xDI_M1_MixerMotorRunning: true });
    stored(runtime, "HMI").MotorRotating = 358;
    runtime.scan(20);
    expect(stored(runtime, "HMI").MotorRotating).toBe(0);
    expect(stored(runtime, "HMI").MixerRunCmd).toBe(false);
    stored(runtime, "HMI").SetToManual = true;
    runtime.scan(20);
    expect(stored(runtime, "controllerState")).toEqual({ vMode: 0n, vModeOld: 0n, vAutoState: 0n });
    expect(stored(runtime, "HMI")).toMatchObject({
      SetToManual: false,
      InAuto: false,
      InManual: true,
    });

    const simulation = driver('import { simulator } from "@mixing/simulator.ts";', "simulator();");
    stored(simulation, "simulatorState").vTankLevel = -0;
    stored(simulation, "simulatorState").vMotorRotating = -0;
    simulation.scan(20);
    expect(Object.is(stored(simulation, "simulatorState").vTankLevel, 0)).toBe(true);
    expect(Object.is(stored(simulation, "simulatorState").vMotorRotating, 0)).toBe(true);
  });
  test("an interrupted mixing timer holds outputs until the next authored MIXING update", () => {
    const runtime = driver('import { controller } from "@mixing/controller.ts";', "controller();");
    Object.assign(stored(runtime, "controllerState"), { vMode: 1n, vModeOld: 1n, vAutoState: 2n });
    stored(runtime, "IO").xDI_M1_MixerMotorRunning = true;
    runtime.scan(0);
    runtime.scan(4000);
    expect(output(runtime, "MixingTimer")).toMatchObject({ Q: false, ET: 4000000000n });

    stored(runtime, "HMI").SetToManual = true;
    runtime.scan(20);
    runtime.scan(6000);
    expect(stored(runtime, "controllerState").vAutoState).toBe(0n);
    expect(output(runtime, "MixingTimer")).toMatchObject({ Q: false, ET: 4000000000n });

    stored(runtime, "HMI").SetToAuto = true;
    runtime.scan(20);
    expect(output(runtime, "MixingTimer")).toMatchObject({ Q: false, ET: 4000000000n });
    // With running feedback still true, elapsed time is observed on resumption.
    stored(runtime, "controllerState").vAutoState = 2n;
    runtime.scan(20);
    expect(output(runtime, "MixingTimer")).toMatchObject({ Q: true, ET: 10000000000n });
    expect(stored(runtime, "controllerState").vAutoState).toBe(0n);
    expect(stored(runtime, "IO").xDO_M1_MixerMotorRunCmd).toBe(false);
  });
});
