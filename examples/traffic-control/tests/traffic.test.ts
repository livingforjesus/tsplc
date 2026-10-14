import { afterAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyze } from "@vplc/compiler";
import { normalizeModule, type VerifiedCoreModule } from "@vplc/compiler/ir";
import { emitCodesys, planCodesys } from "@vplc/compiler/codesys";
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

// Only normalized PLC IR executes in these tests. Authored PLC TypeScript is
// analyzed as source; no PLC module is imported or executed by JavaScript.
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
  const directory = mkdtempSync(join(tmpdir(), "plcts-traffic-driver-"));
  temporaryDirectories.push(directory);
  writeFileSync(
    join(directory, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: { allowImportingTsExtensions: true },
      include: ["main.ts"],
    }),
  );
  writeFileSync(
    join(directory, "main.ts"),
    `${imports.replaceAll("@traffic/", `${example}/src/`).replaceAll("@vplc/compiler/types", `${example}/../../packages/compiler/types/index`)}\nexport function main(): void {\n${body}\n}\n`,
  );
  return machine(checked(join(directory, "tsconfig.json"), "./main.ts"));
}

afterAll(() => {
  for (const directory of temporaryDirectories) rmSync(directory, { recursive: true, force: true });
});

describe("complete upstream traffic-control port", () => {
  test("maps every authored object and emits all actions, types and native blocks", () => {
    const manifest = JSON.parse(readFileSync(join(example, "port.json"), "utf8"));
    expect(manifest.objects).toHaveLength(16);
    const upstream = JSON.parse(readFileSync(join(example, "upstream.json"), "utf8"));
    expect(upstream.files).toHaveLength(22);
    for (const file of upstream.files) {
      const hash = createHash("sha256")
        .update(readFileSync(join(example, "upstream", file.path)))
        .digest("hex");
      expect(hash).toBe(file.sha256);
    }

    for (const object of manifest.objects) {
      expect(object.paths.length).toBeGreaterThan(0);
      for (const path of object.paths) expect(existsSync(join(example, path))).toBe(true);
    }
    const actions = manifest.objects.filter((object: { kind: string }) => object.kind === "action");
    expect(actions).toHaveLength(8);
    for (const action of actions) {
      expect(core.functions.some((fn) => fn.name === action.name.split(".")[1])).toBe(true);
    }
    const planned = planCodesys(
      core,
      {
        tasks: [
          { name: "MainTask", intervalNanoseconds: "5000000", priority: 1, programs: ["main"] },
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
    const declarations = bundle.objects.map((object) => object.declaration).join("\n");
    expect(declarations).toContain("Util.BLINK");
    expect(declarations).toContain("TON");
    expect(declarations).toContain("STRING(255)");
    expect(core.blocks.filter((block) => !block.standard).map((block) => block.name)).toEqual([
      "Sprite",
    ]);
  });

  test("initializes every sprite exactly once and preserves relative positions and public defaults", () => {
    const runtime = machine(core);
    const definitions = structuredClone(stored(runtime, "definitions"));
    runtime.scan(5);
    for (const [name, value] of Object.entries(definitions)) {
      const definition = record(value);
      const result = output(runtime, name);
      const moveX = name.endsWith("HL") ? 1n : name.endsWith("HR") ? -1n : 0n;
      const moveY = name.endsWith("VU") ? 1n : name.endsWith("VD") ? -1n : 0n;
      expect(result.actX).toBe(BigInt(definition.x as bigint) + moveX);
      expect(result.actY).toBe(BigInt(definition.y as bigint) + moveY);
      expect(result.x).toBe(moveX);
      expect(result.y).toBe(moveY);
      expect(result.atDestination).toBe(false);
      expect(definition.speed).toBe(0n);
    }
    expect(stored(runtime, "state").vCollision).toBe(false);
    expect(stored(runtime, "state").vDangerousCombination).toBe(false);

    // Changing a source initializer later does not teleport persistent position.
    record(stored(runtime, "definitions").carC1HL).x = 100n;
    runtime.scan(5);
    expect(output(runtime, "carC1HL").actX).toBe(-48n);
    expect(output(runtime, "carC1HL").x).toBe(-148n);
  });

  test("keeps inclusive controller boundaries, integer countdown, timer capture and reset", () => {
    const runtime = driver('import { controller } from "@traffic/controller.ts";', "controller();");
    runtime.scan(0);
    const io = stored(runtime, "gIO");
    expect(record(io.Cross1PedLDU).TimeToSequenceChange).toBe(28n);
    runtime.scan(25995);
    expect(record(io.Cross1PedLDU).TimeToSequenceChange).toBe(2n);
    runtime.scan(5);
    expect(record(io.Cross1CarL)).toEqual({ RedLamp: false, YellowLamp: true, GreenLamp: true });
    runtime.scan(2000);
    expect(record(io.Cross1CarL)).toEqual({ RedLamp: true, YellowLamp: true, GreenLamp: false });
    expect(record(io.Cross1PedLDU).TimeToSequenceChange).toBe(0n);
    runtime.scan(5);
    expect(record(io.Cross1PedLDU).TimeToSequenceChange).toBe(33n);
    runtime.scan(1995);
    expect(record(io.Cross1CarU)).toEqual({ RedLamp: true, YellowLamp: true, GreenLamp: true });
    runtime.scan(30000);
    expect(record(io.Cross1CarL)).toEqual({ RedLamp: true, YellowLamp: true, GreenLamp: true });
    runtime.scan(2000);
    expect(stored(runtime, "controllerState").vElapsedTime).toBe(62000000000n);
    expect(record(io.Cross1PedLDU).TimeToSequenceChange).toBe(0n);
    expect(output(runtime, "TactTimer").ET).toBe(0n);
    runtime.scan(5);
    expect(stored(runtime, "controllerState").vElapsedTime).toBe(0n);
    expect(record(io.Cross1PedLDU).TimeToSequenceChange).toBe(28n);
  });

  test("runs the entire simulator at 5ms, holds red decision points and uses prior BLINK OUT", () => {
    const runtime = machine(core);
    runtime.scan(5);
    runtime.scan(5);
    expect(output(runtime, "carC1HL").actX).toBe(-48n);
    expect(output(runtime, "carC1HR").actX).toBe(566n);
    expect(output(runtime, "carC1VU").actY).toBe(-49n);
    stored(runtime, "state").vPoliceControl = true;
    for (let scan = 0; scan < 199; scan++) runtime.scan(5);
    expect(output(runtime, "blinker").OUT).toBe(true);
    expect(record(stored(runtime, "lights").Cross1CarU).YellowLamp).toBe(false);
    runtime.scan(5);
    expect(record(stored(runtime, "lights").Cross1CarU).YellowLamp).toBe(true);
    expect(record(stored(runtime, "lights").Cross1PedLUD)).toEqual({
      RedLight: false,
      GreenLight: false,
      TimeToSequenceChange: 0n,
    });
    expect(stored(runtime, "gIO").PoliceModeActivated).toBe(true);
    for (let scan = 0; scan < 200; scan++) runtime.scan(5);
    expect(output(runtime, "blinker").OUT).toBe(false);
    expect(record(stored(runtime, "lights").Cross1CarU).YellowLamp).toBe(false);
  });

  test("freezes on collision and keeps last-check reason and crash-coordinate priority", () => {
    const runtime = machine(core);
    runtime.scan(5);
    const definitions = stored(runtime, "definitions");
    for (const name of Object.keys(definitions)) {
      output(runtime, name).actX = 100n;
      output(runtime, name).actY = 100n;
    }
    stored(runtime, "state").vCollision = true;
    runtime.scan(5);
    expect(output(runtime, "carC1HL").actX).toBe(100n);
    expect(stored(runtime, "state")).toMatchObject({
      vCollision: true,
      vCrashFlagX: 100n,
      vCrashFlagY: 100n,
      vFaultReason: "COLLISSION AT CAR C2VD AND PEDESTRIAN C2HR",
    });
    expect(record(stored(runtime, "lights").Cross1CarU)).toEqual({
      RedLamp: false,
      YellowLamp: false,
      GreenLamp: false,
    });
    // Police has priority over the freeze and updates the actual persistent sprites.
    stored(runtime, "state").vPoliceControl = true;
    runtime.scan(5);
    expect(output(runtime, "carC1HL").actX).not.toBe(100n);
    expect(stored(runtime, "state").vCrashFlagX).toBe(-200n);
    expect(stored(runtime, "state").vCrashFlagY).toBe(-200n);
  });

  test("rectangle touching is clear while one-pixel overlap collides", () => {
    const runtime = driver(
      'import { isSpriteColliding } from "@traffic/geometry.ts";\nimport { defaultValue, type BOOL } from "@vplc/compiler/types";\nimport type { SpriteOutputs } from "@traffic/sprite.ts";\nimport type { SpriteDef_typ } from "@traffic/types.ts";\nexport const a = defaultValue<SpriteOutputs>();\nexport const b = defaultValue<SpriteOutputs>();\nexport const size = defaultValue<SpriteDef_typ>();\nexport let result: BOOL = false;',
      "result = isSpriteColliding(a, size, b, size);",
    );
    stored(runtime, "size").width = 10n;
    stored(runtime, "size").height = 10n;
    stored(runtime, "b").actX = 10n;
    runtime.scan(5);
    expect(runtime.get("result")).toBe(false);
    stored(runtime, "b").actX = 9n;
    runtime.scan(5);
    expect(runtime.get("result")).toBe(true);
    // Comparison temporaries retain the wide sum rather than wrapping to INT.
    stored(runtime, "a").actX = 32760n;
    stored(runtime, "b").actX = 32760n;
    stored(runtime, "size").width = 20n;
    runtime.scan(5);
    expect(runtime.get("result")).toBe(true);
    stored(runtime, "a").actX = -32760n;
    stored(runtime, "b").actX = -32760n;
    stored(runtime, "size").width = -20n;
    runtime.scan(5);
    expect(runtime.get("result")).toBe(false);
  });
  test("matches all twelve initializer records against the pinned XML, including zero speed", () => {
    const runtime = machine(core);
    const definitions = stored(runtime, "definitions");
    const xml = readFileSync(join(example, "upstream/plc_traffic_control.xml"), "utf8");
    expect(Object.keys(definitions)).toHaveLength(12);
    for (const [name, definition] of Object.entries(definitions)) {
      const variable = xml.match(
        new RegExp(`<variable name="${name}">([\\s\\S]*?)<documentation>`),
      );
      if (!variable?.[1]) throw new Error(`Missing upstream initializer ${name}`);
      const fields = Object.fromEntries(
        [...variable[1].matchAll(/<value member="(\w+)">\s*<simpleValue value="(-?\d+)"/g)].map(
          (field) => [field[1], BigInt(field[2] ?? "0")],
        ),
      );
      expect(record(definition)).toEqual({ ...fields, speed: 0n });
    }
  });

  test("wraps screen crossings, INT arithmetic and relative coordinates exactly", () => {
    const imports =
      'import { Sprite } from "@traffic/sprite.ts";\nimport { defaultValue, type INT } from "@vplc/compiler/types";\nimport type { SpriteDef_typ } from "@traffic/types.ts";\nexport const definition = defaultValue<SpriteDef_typ>();\nexport const sprite = new Sprite();\nexport let moveX: INT = 0;\nexport let moveY: INT = 0;';
    const body = "sprite.update({ init: definition, goTo: [0, 0], moveX, moveY });";
    const negativeDimensions = driver(imports, body);
    Object.assign(stored(negativeDimensions, "definition"), {
      x: -10n,
      y: -10n,
      width: -32768n,
      height: -32768n,
      screenWidth: 100n,
      screenHeight: 100n,
    });
    negativeDimensions.scan(5);
    expect(output(negativeDimensions, "sprite")).toEqual({
      actX: 100n,
      actY: 100n,
      x: 110n,
      y: 110n,
      atDestination: false,
    });

    for (const scenario of [
      { x: 1980n, y: 720n, move: 0n, actX: 1980n, actY: 720n, relativeX: 0n, relativeY: 0n },
      { x: -200n, y: -80n, move: 0n, actX: -200n, actY: -80n, relativeX: 0n, relativeY: 0n },
      { x: 1980n, y: 720n, move: 1n, actX: -200n, actY: -80n, relativeX: -2180n, relativeY: -800n },
      { x: -200n, y: -80n, move: -1n, actX: 1980n, actY: 720n, relativeX: 2180n, relativeY: 800n },
      {
        x: 32767n,
        y: 32767n,
        move: 1n,
        actX: 1980n,
        actY: 720n,
        relativeX: -30787n,
        relativeY: -32047n,
      },
    ]) {
      const runtime = driver(imports, body);
      Object.assign(stored(runtime, "definition"), {
        x: scenario.x,
        y: scenario.y,
        width: 200n,
        height: 80n,
        screenWidth: 1980n,
        screenHeight: 720n,
      });
      runtime.set("moveX", scenario.move);
      runtime.set("moveY", scenario.move);
      runtime.scan(5);
      expect(output(runtime, "sprite")).toEqual({
        actX: scenario.actX,
        actY: scenario.actY,
        x: scenario.relativeX,
        y: scenario.relativeY,
        atDestination: false,
      });
    }
  });

  test("preserves dangerous-lamp check order and collision messages take precedence", () => {
    const runtime = driver(
      'import { UPDATE_OBJECTS } from "@traffic/simulator.ts";\nimport { FAULT_MONITOR } from "@traffic/faults.ts";\nlet initialized: BOOL = false;',
      "if (!initialized) { UPDATE_OBJECTS(); initialized = true; }\nFAULT_MONITOR();",
    );
    runtime.scan(5);
    const lights = stored(runtime, "lights");
    record(lights.Cross1CarU).GreenLamp = true;
    record(lights.Cross1PedULR).GreenLight = true;
    record(lights.Cross2CarR).GreenLamp = true;
    record(lights.Cross2PedRDU).GreenLight = true;
    runtime.scan(5);
    expect(stored(runtime, "state").vDangerousCombination).toBe(true);
    expect(stored(runtime, "state").vFaultReason).toBe(
      "DANGEROUS COMBINATION AT CROSS2 -> HORIZONTAL CARS AND VERTICAL PEDESTRIANS GREEN AT THE SAME TIME",
    );
    for (const name of Object.keys(stored(runtime, "definitions"))) {
      output(runtime, name).actX = 100n;
      output(runtime, name).actY = 100n;
    }
    runtime.scan(5);
    expect(stored(runtime, "state").vDangerousCombination).toBe(true);
    expect(stored(runtime, "state").vFaultReason).toBe(
      "COLLISSION AT CAR C2VD AND PEDESTRIAN C2HR",
    );
    for (const [name, definition] of Object.entries(stored(runtime, "definitions"))) {
      const position = record(definition);
      if (typeof position.x !== "bigint" || typeof position.y !== "bigint") {
        throw new Error("Expected integer sprite coordinates");
      }
      output(runtime, name).actX = position.x;
      output(runtime, name).actY = position.y;
    }
    for (const light of Object.values(lights)) {
      if (light && typeof light === "object" && !Array.isArray(light)) {
        for (const [field, value] of Object.entries(light)) {
          if (typeof value === "boolean") light[field] = false;
        }
      }
    }
    runtime.scan(5);
    expect(stored(runtime, "state")).toMatchObject({
      vDangerousCombination: false,
      vCollision: false,
      vCrashFlagX: -200n,
      vCrashFlagY: -200n,
    });
    // FAULT_MONITOR clears conditions but the normal simulator branch owns message clearing.
    expect(stored(runtime, "state").vFaultReason).toBe(
      "COLLISSION AT CAR C2VD AND PEDESTRIAN C2HR",
    );
  });
});
