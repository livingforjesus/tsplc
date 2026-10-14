import { afterAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { emitCodesys, planCodesys } from "@vplc/compiler/codesys";
import { analyze } from "@vplc/compiler";
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

// Authored PLC TypeScript is compiler input. Tests execute normalized IR only.
const core = checked(join(example, "tsconfig.json"), "./src/main.ts");
type Runtime = ReturnType<typeof machine>;
type RecordValue = { [key: string]: Value };

function record(value: Value | undefined): RecordValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Expected a PLC record");
  }
  return value;
}
function array(value: Value | undefined): Value[] {
  if (!Array.isArray(value)) throw new Error("Expected a PLC fixed array");
  return value;
}
function stored(runtime: Runtime, name: string): RecordValue {
  return record(runtime.get(name));
}
function output(runtime: Runtime, name: string): RecordValue {
  return record(stored(runtime, name).out);
}
function driver(imports: string, body: string): Runtime {
  const directory = mkdtempSync(join(tmpdir(), "plcts-garden-driver-"));
  temporaryDirectories.push(directory);
  writeFileSync(
    join(directory, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: { allowImportingTsExtensions: true },
      include: ["main.ts"],
    }),
  );
  const resolved = imports
    .replaceAll("@garden/", `${example}/src/`)
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

function originalInitialValues(name: string): bigint[] {
  const xml = readFileSync(join(example, "upstream/plc_garden_controller.xml"), "utf8");
  const variable = xml.match(new RegExp(`<variable name="${name}">([\\s\\S]*?)</variable>`))?.[1];
  if (!variable) throw new Error(`Missing original ${name}`);
  return [...variable.matchAll(/<simpleValue value="(-?\d+)"/g)].map((value) => {
    if (value[1] === undefined) throw new Error("Missing numeric XML initializer");
    return BigInt(value[1]);
  });
}

const flowerImports = `
import { defaultValue, type BOOL, type INT } from "@vplc/compiler/types";
import type { Flower_typ } from "@garden/types.ts";
import { simulateFlower } from "@garden/flower.ts";
export const input = defaultValue<{ flower: Flower_typ; pulse: BOOL; nozzleX: INT; nozzleY: INT; valve: BOOL }>();
export let result: Flower_typ = defaultValue<Flower_typ>();`;
const flowerBody =
  "result = simulateFlower(input.flower, input.pulse, input.nozzleX, input.nozzleY, input.valve);";
function flower(overrides: RecordValue = {}): RecordValue {
  return {
    x: 0n,
    y: 0n,
    alpha: 255n,
    red: 2n,
    green: 253n,
    blue: 0n,
    color: 0n,
    hum: 100,
    alive: true,
    ...overrides,
  };
}

describe("complete upstream garden-controller port", () => {
  test("preserves all 27 files, 18 objects, 200 route coordinates and 100 initialized flowers", () => {
    const upstream = JSON.parse(readFileSync(join(example, "upstream.json"), "utf8"));
    expect(upstream.files).toHaveLength(27);
    for (const file of upstream.files) {
      expect(
        createHash("sha256")
          .update(readFileSync(join(example, "upstream", file.path)))
          .digest("hex"),
      ).toBe(file.sha256);
    }
    const manifest = JSON.parse(readFileSync(join(example, "port.json"), "utf8"));
    expect(manifest.objects).toHaveLength(18);
    for (const object of manifest.objects) {
      expect(object.paths.length).toBeGreaterThan(0);
      for (const path of object.paths) expect(existsSync(join(example, path))).toBe(true);
    }
    const runtime = machine(core);
    for (let garden = 1; garden <= 4; garden++) {
      const route = array(runtime.get(`vG${garden}Platform_Instructions`));
      expect(route.flatMap((pair) => array(pair))).toEqual(
        originalInitialValues(`vG${garden}Platform_Instructions`),
      );
      const cells = array(runtime.get(`vGarden${garden}`));
      expect(cells).toHaveLength(25);
      expect(cells.flatMap((cell) => [record(cell).x, record(cell).y])).toEqual(
        originalInitialValues(`vGarden${garden}`),
      );
      for (const cell of cells) {
        const value = record(cell);
        if (value.x === undefined || value.y === undefined)
          throw new Error("Missing flower coordinates");
        expect(value).toEqual(flower({ x: value.x, y: value.y }));
      }
      expect(record(stored(runtime, "gIO")[`Garden${garden}_HMI`]).CtrlOn).toBe(true);
      expect(record(stored(runtime, "platforms")[`vGarden${garden}Platform`])).toEqual({
        x: 0n,
        y: 0n,
        OpenValveCmd: false,
      });
    }
    expect(output(runtime, "clock").pulse).toBe(false);
    for (let garden = 1; garden <= 4; garden++) {
      expect(output(runtime, `garden${garden}AutoWater`)).toEqual({
        servoX_CW: false,
        servoX_CCW: false,
        servoY_CW: false,
        servoY_CCW: false,
        waterTankOpenCmd: false,
      });
    }
    expect(Object.keys(stored(runtime, "gIO"))).toHaveLength(32);
    expect(core.blocks.filter((block) => !block.standard).map((block) => block.name)).toEqual([
      "ClockPulse",
      "AutomaticFlowerWatering",
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
    const text = emitCodesys(planned.plan)
      .objects.map((object) => object.declaration + object.implementation)
      .join("\n");
    for (const token of ["BLINK", "R_TRIG", "TON", "ARRAY[0..24]", "LREAL", "DWORD"])
      expect(text).toContain(token);
  });

  test("uses wide geometry edges, strict overlap and INT assignment boundaries", () => {
    const runtime = driver(
      `
import { defaultValue, type BOOL, type INT } from "@vplc/compiler/types";
import { checkOverlapRectangle } from "@garden/geometry.ts";
import { absoluteOffset, moveAxis } from "@garden/platform.ts";
export const input = defaultValue<{ x: INT; y: INT; w: INT; h: INT; x2: INT; y2: INT; w2: INT; h2: INT; ccw: BOOL; cw: BOOL }>();
export const result = defaultValue<{ overlap: BOOL; offset: INT; position: INT; boundedNegative: INT; boundedPositive: INT }>();`,
      `
result.overlap = checkOverlapRectangle(input.x, input.y, input.w, input.h, input.x2, input.y2, input.w2, input.h2);
result.offset = absoluteOffset(input.x);
result.position = moveAxis(input.x, input.ccw, input.cw, 1, -32768, 32767);
result.boundedNegative = moveAxis(input.x, true, true, 1, -404, 0);
result.boundedPositive = moveAxis(input.x, true, true, -1, 0, 404);`,
    );
    const input = stored(runtime, "input");
    Object.assign(input, {
      x: 32760n,
      y: 0n,
      w: 20n,
      h: 10n,
      x2: 32760n,
      y2: 0n,
      w2: 20n,
      h2: 10n,
      ccw: true,
      cw: true,
    });
    runtime.scan();
    expect(stored(runtime, "result")).toMatchObject({
      overlap: true,
      offset: 32760n,
      position: 32761n,
    });
    input.x = 32767n;
    runtime.scan();
    expect(stored(runtime, "result").position).toBe(-32768n);
    expect(stored(runtime, "result").boundedNegative).toBe(-404n);
    input.x = -32768n;
    input.ccw = false;
    input.cw = false;
    runtime.scan();
    expect(stored(runtime, "result").offset).toBe(-32768n);
    expect(stored(runtime, "result").boundedPositive).toBe(404n);
    Object.assign(input, { x: 0n, y: 0n, w: 10n, h: 10n, x2: 10n, y2: 0n, w2: 10n, h2: 10n });
    runtime.scan();
    expect(stored(runtime, "result").overlap).toBe(false);
    input.x2 = 9n;
    runtime.scan();
    expect(stored(runtime, "result").overlap).toBe(true);
    Object.assign(input, { x: -32768n, w: 32767n, x2: -2n, w2: 10n });
    runtime.scan();
    expect(stored(runtime, "result").overlap).toBe(true);
  });

  test("wraps BYTE stores before LIMIT, samples alive first and packs DWORD in the authored order", () => {
    const runtime = driver(flowerImports, flowerBody);
    const input = stored(runtime, "input");
    Object.assign(input, { pulse: true, nozzleX: 0n, nozzleY: 0n, valve: false });
    const cases = [
      { input: flower({ hum: 0, red: 255n, green: 0n }), red: 1n, green: 1n, alive: false },
      { input: flower({ hum: 0, red: 253n, green: 100n }), red: 254n, green: 99n, alive: true },
      { input: flower({ hum: 100, red: 0n, green: 253n }), red: 254n, green: 254n, alive: true },
      { input: flower({ hum: 100, red: 2n, green: 255n }), red: 2n, green: 1n, alive: true },
      { input: flower({ hum: 100, red: 254n, green: 99n }), red: 254n, green: 99n, alive: false },
    ];
    for (const sample of cases) {
      input.flower = sample.input;
      runtime.scan();
      const result = stored(runtime, "result");
      expect(result).toMatchObject({ red: sample.red, green: sample.green, alive: sample.alive });
      expect(result.color).toBe(0xff000000n | (sample.red << 16n) | (sample.green << 8n));
    }
    input.flower = flower({ alpha: 0x12n, red: 0x34n, green: 0x56n, blue: 0x78n });
    input.pulse = false;
    runtime.scan();
    expect(stored(runtime, "result").color).toBe(0x12345678n);
  });

  test("keeps 0.07 promoted subtraction/MAX separate from the REAL watering store", () => {
    const runtime = driver(flowerImports, flowerBody);
    const input = stored(runtime, "input");
    Object.assign(input, { nozzleX: 0n, nozzleY: 0n });
    for (const level of [Math.fround(0.1), Math.fround(0.07), 0, -1, 100, 200]) {
      for (const pulse of [false, true]) {
        for (const valve of [false, true]) {
          input.flower = flower({ hum: level });
          input.pulse = pulse;
          input.valve = valve;
          runtime.scan();
          const decreased = Math.fround(Math.max(0, level - 0.07 * Number(pulse)));
          const expected = valve ? Math.fround(decreased + 4 * Number(pulse)) : decreased;
          expect(stored(runtime, "result").hum).toBe(expected);
        }
      }
    }
    // MAX equal signed-zero ties are undocumented by the vendor. Check the
    // numerical lower bound for injected -0 without asserting its sign bit.
    input.flower = flower({ hum: -0 });
    input.pulse = false;
    input.valve = false;
    runtime.scan();
    expect(stored(runtime, "result").hum === 0).toBe(true);
  });

  test("executes all four 25-step routes, holds watering state away from target and wraps to step zero", () => {
    const runtime = driver(
      `
import { defaultValue, type INT } from "@vplc/compiler/types";
import * as routes from "@garden/routes.ts";
import { garden1AutoWater, garden2AutoWater, garden3AutoWater, garden4AutoWater } from "@garden/watering.ts";
export const position = defaultValue<{ x: INT; y: INT }>();`,
      `
garden1AutoWater.update({instructions: routes.vG1Platform_Instructions, xAxis: position.x, yAxis: position.y});
garden2AutoWater.update({instructions: routes.vG2Platform_Instructions, xAxis: position.x, yAxis: position.y});
garden3AutoWater.update({instructions: routes.vG3Platform_Instructions, xAxis: position.x, yAxis: position.y});
garden4AutoWater.update({instructions: routes.vG4Platform_Instructions, xAxis: position.x, yAxis: position.y});`,
    );
    // Each persistent block has its own index/timer. Unrelated routes may progress
    // during this test, so complete each in a fresh independent model below.
    const position = stored(runtime, "position");
    Object.assign(position, { x: 365n, y: 320n });
    runtime.scan(20);
    expect(output(runtime, "garden1AutoWater").waterTankOpenCmd).toBe(true);
    position.x = 0n;
    runtime.scan(500);
    expect(output(runtime, "garden1AutoWater").waterTankOpenCmd).toBe(true);
    position.x = 365n;
    runtime.scan(500);
    expect(output(runtime, "garden1AutoWater").waterTankOpenCmd).toBe(false);
    expect(output(runtime, "garden1AutoWater").servoX_CW).toBe(false);
    runtime.scan(20);
    expect(output(runtime, "garden1AutoWater").servoX_CCW).toBe(true);

    for (let garden = 1; garden <= 4; garden++) {
      const single = driver(
        `
import { defaultValue, type INT } from "@vplc/compiler/types";
import { vG${garden}Platform_Instructions } from "@garden/routes.ts";
import { garden${garden}AutoWater } from "@garden/watering.ts";
export const position = defaultValue<{ x: INT; y: INT }>();`,
        `garden${garden}AutoWater.update({instructions: vG${garden}Platform_Instructions, xAxis: position.x, yAxis: position.y});`,
      );
      const route = originalInitialValues(`vG${garden}Platform_Instructions`);
      for (let step = 0; step < 25; step++) {
        Object.assign(stored(single, "position"), { x: route[step * 2], y: route[step * 2 + 1] });
        single.scan(20);
        expect(output(single, `garden${garden}AutoWater`).waterTankOpenCmd).toBe(true);
        single.scan(999);
        expect(output(single, `garden${garden}AutoWater`).waterTankOpenCmd).toBe(true);
        single.scan(1);
        expect(output(single, `garden${garden}AutoWater`)).toEqual({
          servoX_CW: false,
          servoX_CCW: false,
          servoY_CW: false,
          servoY_CCW: false,
          waterTankOpenCmd: false,
        });
      }
      Object.assign(stored(single, "position"), { x: route[0], y: route[1] });
      single.scan(20);
      expect(output(single, `garden${garden}AutoWater`).waterTankOpenCmd).toBe(true);
    }
  });

  test("maps all manual/diagonal commands and observes controller before simulator feedback", () => {
    const runtime = machine(core);
    const io = stored(runtime, "gIO");
    for (let garden = 1; garden <= 4; garden++) {
      const hmi = record(io[`Garden${garden}_HMI`]);
      hmi.LeftUpCmd = true;
      hmi.OpenWaterValve = true;
      const platform = record(stored(runtime, "platforms")[`vGarden${garden}Platform`]);
      platform.x = garden === 1 || garden === 3 ? -100n : 100n;
      platform.y = garden === 1 || garden === 2 ? -100n : 100n;
    }
    runtime.scan(20);
    for (let garden = 1; garden <= 4; garden++) {
      const xClockwise = garden === 1 || garden === 3;
      const yClockwise = garden === 1 || garden === 2;
      expect(io[`Garden${garden}_ServoX_CW`]).toBe(xClockwise);
      expect(io[`Garden${garden}_ServoX_CCW`]).toBe(!xClockwise);
      expect(io[`Garden${garden}_ServoY_CW`]).toBe(yClockwise);
      expect(io[`Garden${garden}_ServoY_CCW`]).toBe(!yClockwise);
      const platform = record(stored(runtime, "platforms")[`vGarden${garden}Platform`]);
      expect(platform.x).toBe(xClockwise ? -101n : 99n);
      expect(platform.y).toBe(yClockwise ? -101n : 99n);
      expect(platform.OpenValveCmd).toBe(true);
      expect(io[`Garden${garden}_ServoX_Offset`]).toBe(xClockwise ? 101n : 99n);
      expect(io[`Garden${garden}_ServoY_Offset`]).toBe(yClockwise ? 101n : 99n);
      expect(array(runtime.get(`vGarden${garden}`)).every((cell) => record(cell).hum === 100)).toBe(
        true,
      );
      const hmi = record(io[`Garden${garden}_HMI`]);
      hmi.LeftUpCmd = false;
      hmi.OpenWaterValve = false;
    }
    runtime.scan(20);
    // Valve feedback is copied after flowers: the closing scan still waters the
    // overlapping cell using the previous scan's open valve and platform state.
    expect(record(array(runtime.get("vGarden1"))[18]).hum).toBe(
      Math.fround(Math.fround(100 - 0.07) + 4),
    );
    expect(record(stored(runtime, "platforms").vGarden1Platform).OpenValveCmd).toBe(false);
    for (let garden = 1; garden <= 4; garden++) {
      expect(io[`Garden${garden}_ServoX_CW`]).toBe(false);
      expect(io[`Garden${garden}_ServoX_CCW`]).toBe(false);
      expect(io[`Garden${garden}_ServoY_CW`]).toBe(false);
      expect(io[`Garden${garden}_ServoY_CCW`]).toBe(false);
    }
  });

  test("maps all eight manual directions and leaves automatic timing held during manual mode", () => {
    const runtime = driver(`import { controller } from "@garden/controller.ts";`, "controller();");
    const io = stored(runtime, "gIO");
    const directions = [
      { command: "LeftCmd", left: true, right: false, up: false, down: false },
      { command: "RightCmd", left: false, right: true, up: false, down: false },
      { command: "UpCmd", left: false, right: false, up: true, down: false },
      { command: "DownCmd", left: false, right: false, up: false, down: true },
      { command: "LeftUpCmd", left: true, right: false, up: true, down: false },
      { command: "RightUpCmd", left: false, right: true, up: true, down: false },
      { command: "LeftDownCmd", left: true, right: false, up: false, down: true },
      { command: "RightDownCmd", left: false, right: true, up: false, down: true },
    ];
    for (const direction of directions) {
      for (let garden = 1; garden <= 4; garden++) {
        record(io[`Garden${garden}_HMI`])[direction.command] = true;
      }
      runtime.scan(20);
      for (let garden = 1; garden <= 4; garden++) {
        const normalX = garden === 1 || garden === 3;
        const normalY = garden === 1 || garden === 2;
        expect(io[`Garden${garden}_ServoX_CW`]).toBe(normalX ? direction.left : direction.right);
        expect(io[`Garden${garden}_ServoX_CCW`]).toBe(normalX ? direction.right : direction.left);
        expect(io[`Garden${garden}_ServoY_CW`]).toBe(normalY ? direction.up : direction.down);
        expect(io[`Garden${garden}_ServoY_CCW`]).toBe(normalY ? direction.down : direction.up);
        record(io[`Garden${garden}_HMI`])[direction.command] = false;
      }
    }

    const hmi = record(io.Garden1_HMI);
    hmi.CtrlOn = false;
    io.Garden1_ServoX_Offset = 365n;
    io.Garden1_ServoY_Offset = 320n;
    runtime.scan(20);
    expect(output(runtime, "garden1AutoWater").waterTankOpenCmd).toBe(true);
    hmi.CtrlOn = true;
    runtime.scan(1500);
    expect(io.Garden1_WaterTankOpenCmd).toBe(false);
    expect(output(runtime, "garden1AutoWater").waterTankOpenCmd).toBe(true);
    hmi.CtrlOn = false;
    runtime.scan(20);
    expect(output(runtime, "garden1AutoWater").waterTankOpenCmd).toBe(false);
    runtime.scan(20);
    expect(io.Garden1_ServoX_CCW).toBe(true);
  });

  test("updates all 100 flowers on the native clock pulse and counts alive before color changes", () => {
    const runtime = machine(core);
    let expected = 100;
    for (let scan = 0; scan < 20; scan++) {
      runtime.scan(20);
      const pulse = output(runtime, "clock").pulse;
      expect(pulse).toBe(scan % 2 === 1);
      expected = Math.fround(Math.max(0, expected - 0.07 * Number(pulse)));
      for (let garden = 1; garden <= 4; garden++) {
        expect(stored(runtime, "simulationState")[`vG${garden}PlantsAlive`]).toBe(25n);
        for (const cell of array(runtime.get(`vGarden${garden}`)))
          expect(record(cell).hum).toBe(expected);
      }
    }
    const dead = record(array(runtime.get("vGarden1"))[0]);
    dead.red = 254n;
    dead.green = 99n;
    runtime.scan(20);
    expect(stored(runtime, "simulationState").vG1PlantsAlive).toBe(24n);
    expect(record(array(runtime.get("vGarden1"))[0]).alive).toBe(false);
  });

  test("runs controller/platform feedback to the first automatic targets and advances after dwell", () => {
    const runtime = machine(core);
    const io = stored(runtime, "gIO");
    for (let garden = 1; garden <= 4; garden++) record(io[`Garden${garden}_HMI`]).CtrlOn = false;
    const sawWater = [false, false, false, false];
    const sawCompletion = [false, false, false, false];
    for (let scan = 0; scan < 430; scan++) {
      runtime.scan(20);
      for (let garden = 1; garden <= 4; garden++) {
        const opened = io[`Garden${garden}_WaterTankOpenCmd`] === true;
        if (opened) sawWater[garden - 1] = true;
        if (sawWater[garden - 1] && !opened) sawCompletion[garden - 1] = true;
      }
    }
    expect(sawWater).toEqual([true, true, true, true]);
    expect(sawCompletion).toEqual([true, true, true, true]);
    expect(io.Garden1_ServoX_Offset).toBeLessThan(365n);
    expect(io.Garden2_ServoY_Offset).toBeLessThan(320n);
  });
});
