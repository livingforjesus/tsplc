import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import fc from "fast-check";
import { TextDocument } from "vscode-languageserver-textdocument";
import type { Diagnostic, Position, Range } from "vscode-languageserver-types";
import { LanguageService } from "../src/language/service";

const root = "file:///adversarial/";
const uri = (path: string) => root + path;
const program = (declarations: string, body: string) =>
  `PROGRAM Main\nVAR\n${declarations}\nEND_VAR\n${body}\nEND_PROGRAM`;
const workspace = (files: Record<string, string>) => {
  const service = new LanguageService();
  for (const [path, text] of Object.entries(files)) {
    service.setDocument(uri(path), text);
  }
  return service;
};
const position = (text: string, needle: string, occurrence = 0): Position => {
  let offset = -1;
  for (let index = 0; index <= occurrence; index++) {
    offset = text.indexOf(needle, offset + 1);
    if (offset < 0) {
      throw new Error(`Missing occurrence ${occurrence} of ${JSON.stringify(needle)}`);
    }
  }
  return TextDocument.create("test.st", "codesys-st", 1, text).positionAt(offset + needle.length);
};
const messages = (diagnostics: Diagnostic[]) =>
  diagnostics.map(({ message }) => message).join("\n");
const errors = (service: LanguageService, path = "Main.st") =>
  service.diagnostics(uri(path)).filter(({ severity }) => severity === 1);
const labels = (service: LanguageService, path: string, text: string, needle: string) =>
  service.completion(uri(path), position(text, needle)).map(({ label }) => label);
const rangeText = (text: string, range: Range) => {
  const document = TextDocument.create("test.st", "codesys-st", 1, text);
  return text.slice(document.offsetAt(range.start), document.offsetAt(range.end));
};
const fixture = async () => {
  const directory = join(import.meta.dir, "fixtures/conveyor");
  const files: Record<string, string> = {};
  for await (const path of new Bun.Glob("**/*.st").scan(directory)) {
    files[path] = await Bun.file(join(directory, path)).text();
  }
  return { files, service: workspace(files) };
};

describe("adversarial source ownership", () => {
  it.each(["PUBLIC", "INTERNAL", "ABSTRACT"])(
    "accepts the build-tool's TYPE %s declaration",
    (modifier) => {
      const service = workspace({
        "E_State.st": `TYPE ${modifier} E_State : (Idle, Active); END_TYPE`,
      });
      expect(errors(service, "E_State.st")).toEqual([]);
    },
  );

  it("checks the portable conveyor project without false error diagnostics", async () => {
    const { files, service } = await fixture();
    const actual = Object.keys(files).flatMap((path) =>
      errors(service, path).map((diagnostic) => ({ path, ...diagnostic })),
    );
    expect(actual).toEqual([]);
  });

  it("completes and navigates through a parent pointer, array, and nested DUT", async () => {
    const { files, service } = await fixture();
    const path = "transport/FB_Conveyor/methods/SetMotionSignal/SetMotionSignal.implementation.st";
    const text = files[path];
    if (!text) throw new Error("Fixture method missing");
    expect(labels(service, path, text, "pConveyor^.Zones[ZoneIndex].Output.")).toContain(
      "MotionAsserted",
    );
    const definition = service.definition(uri(path), position(text, "Output.MotionAsserted"));
    expect(definition).toHaveLength(1);
    expect(definition[0]?.uri).toBe(uri("types/ST_Output.st"));
  });

  it.each([
    ["FB_Box/declaration.st", "FB_Box/implementation.st"],
    ["FB_Box/FB_Box.declaration.st", "FB_Box/FB_Box.implementation.st"],
    ["FB_Box/declaration.st", "FB_Box/FB_Box.implementation.st"],
    ["FB_Box/FB_Box.declaration.st", "FB_Box/implementation.st"],
    ["domain/FB_Box.declaration.st", "domain/FB_Box.implementation.st"],
  ])("binds %s to %s", (declarationPath, implementationPath) => {
    const service = workspace({
      [declarationPath]: "FUNCTION_BLOCK FB_Box\nVAR\nCount : INT;\nEND_VAR",
      [implementationPath]: "Count := 1;",
    });
    expect(errors(service, implementationPath)).toEqual([]);
    expect(service.definition(uri(implementationPath), { line: 0, character: 3 })[0]?.uri).toBe(
      uri(declarationPath),
    );
  });

  it("keeps identically named methods and their parameters in separate parents", () => {
    const main = program("A : FB_A; B : FB_B;", "A.Run(Value := TRUE); B.Run(Value := 7);");
    const service = workspace({
      "FB_A/source.st": "FUNCTION_BLOCK FB_A\nEND_FUNCTION_BLOCK",
      "FB_A/methods/Run.st": "METHOD Run\nVAR_INPUT\nValue : BOOL;\nEND_VAR\nEND_METHOD",
      "FB_B/source.st": "FUNCTION_BLOCK FB_B\nEND_FUNCTION_BLOCK",
      "FB_B/methods/Run.st": "METHOD Run\nVAR_INPUT\nValue : INT;\nEND_VAR\nEND_METHOD",
      "Main.st": main,
    });
    expect(errors(service)).toEqual([]);
    expect(service.definition(uri("Main.st"), position(main, "A.Run"))[0]?.uri).toBe(
      uri("FB_A/methods/Run.st"),
    );
    expect(service.definition(uri("Main.st"), position(main, "B.Run"))[0]?.uri).toBe(
      uri("FB_B/methods/Run.st"),
    );
  });

  it("does not manufacture namespaces from domain directories", () => {
    const service = workspace({
      "a/State.st": "TYPE State : INT; END_TYPE",
      "b/state.st": "TYPE state : BOOL; END_TYPE",
    });
    expect(messages([...errors(service, "a/State.st"), ...errors(service, "b/state.st")])).toMatch(
      /duplicate|already/i,
    );
  });
});

describe("adversarial type safety", () => {
  it.each(["[1, 2, 3]", "[3(0)]"])("rejects excess array initializers in %s", (initializer) => {
    const service = workspace({
      "Main.st": program(`Items : ARRAY[1..2] OF INT := ${initializer};`, ""),
    });
    expect(messages(errors(service))).toMatch(/initializ|elements|capacity|size|values/i);
  });

  it.each(["[1]", "[2(0)]"])(
    "preserves valid partial and repeated array initialization %s",
    (initializer) => {
      const service = workspace({
        "Main.st": program(`Items : ARRAY[1..2] OF INT := ${initializer};`, ""),
      });
      expect(errors(service)).toEqual([]);
    },
  );

  it("rejects a mutable variable as a fixed array bound", () => {
    const service = workspace({
      "Main.st": program("Count : INT := 3; Items : ARRAY[1..Count] OF INT;", ""),
    });
    expect(errors(service).length).toBeGreaterThan(0);
  });

  it("accepts an integer constant expression as a fixed array bound", () => {
    const service = workspace({
      "Main.st":
        "PROGRAM Main\nVAR CONSTANT\nCapacity : INT := 3;\nEND_VAR\nVAR\nItems : ARRAY[1..Capacity - 1] OF INT;\nEND_VAR\nEND_PROGRAM",
    });
    expect(errors(service)).toEqual([]);
  });

  it("rejects an open array outside VAR_IN_OUT", () => {
    const service = workspace({
      "Main.st": program("Items : ARRAY[*] OF INT;", ""),
    });
    expect(errors(service).length).toBeGreaterThan(0);
  });

  it("accepts a static array passed to an open VAR_IN_OUT array", () => {
    const service = workspace({
      "F_Read.st":
        "FUNCTION F_Read : INT\nVAR_IN_OUT\nItems : ARRAY[*] OF INT;\nEND_VAR\nF_Read := 0;\nEND_FUNCTION",
      "Main.st": program(
        "Items : ARRAY[-2..3] OF INT; Result : INT;",
        "Result := F_Read(Items := Items);",
      ),
    });
    expect(errors(service)).toEqual([]);
    expect(errors(service, "F_Read.st")).toEqual([]);
  });

  it.each([
    "ARRAY[1..2] OF REFERENCE TO INT",
    "POINTER TO REFERENCE TO INT",
    "REFERENCE TO REFERENCE TO INT",
    "REFERENCE TO BIT",
    "POINTER TO BIT",
    "ARRAY[1..2] OF BIT",
    "POINTER TO ReferenceAlias",
  ])("rejects forbidden reference or bit element type %s", (type) => {
    const service = workspace({
      "ReferenceAlias.st": "TYPE ReferenceAlias : REFERENCE TO INT; END_TYPE",
      "Main.st": program(`Invalid : ${type};`, ""),
    });
    expect(errors(service).length).toBeGreaterThan(0);
  });

  it("preserves valid recursive pointer-based data structures", () => {
    const service = workspace({
      "ST_Node.st":
        "TYPE ST_Node : STRUCT Next : POINTER TO ST_Node; Value : INT; END_STRUCT END_TYPE",
      "Main.st": program("Node : ST_Node;", "Node.Next := ADR(Node); Node.Next^.Value := 1;"),
    });
    expect(errors(service)).toEqual([]);
    expect(errors(service, "ST_Node.st")).toEqual([]);
  });

  it("validates bounds on an alias's own array type", () => {
    const service = workspace({
      "Bad.st": "TYPE Bad : ARRAY[10..1] OF INT; END_TYPE",
    });
    expect(messages(errors(service, "Bad.st"))).toMatch(/bound|range/i);
  });

  it("diagnoses cyclic constant initializers instead of silently losing their value", () => {
    const service = workspace({
      "Settings.st": "VAR_GLOBAL CONSTANT A : INT := B; B : INT := A; END_VAR",
    });
    expect(messages(errors(service, "Settings.st"))).toMatch(/cycl|recurs|constant/i);
  });

  it.each([
    ["Enabled : BOOL;", "Enabled := 'yes';"],
    ["Enabled : BOOL;", "Enabled := 42;"],
    ["Count : DoesNotExist;", ""],
    ["Count : INT;", "Count := MissingValue;"],
    ["Count : INT;", "MissingTarget := Count;"],
    ["Count : INT;", "IF Count THEN Count := 1; END_IF;"],
    ["Enabled : BOOL;", "Enabled := TRUE + FALSE;"],
  ])("rejects incompatible or unresolved code %#", (declaration, body) => {
    const service = workspace({ "Main.st": program(declaration, body) });
    expect(errors(service).length).toBeGreaterThan(0);
  });

  it("reports a misspelled deep member at its actual source range", async () => {
    const { files, service } = await fixture();
    const path = "transport/FB_Conveyor/methods/SetMotionSignal/SetMotionSignal.implementation.st";
    const text = files[path]?.replace("MotionAsserted", "MotionAssertted");
    if (!text) throw new Error("Fixture method missing");
    service.setDocument(uri(path), text, 2);
    const diagnostic = errors(service, path).find(({ message }) =>
      /MotionAssertted/i.test(message),
    );
    expect(diagnostic).toBeDefined();
    if (diagnostic) expect(rangeText(text, diagnostic.range)).toBe("MotionAssertted");
  });

  it("does not leak qualified-only GVL members into scope or completion", () => {
    const main = program("Value : INT;", "Value := ZoneCapacity;\nZon");
    const service = workspace({
      "PlantConstants.st":
        "{attribute 'qualified_only'}\nVAR_GLOBAL CONSTANT\nZoneCapacity : INT := 128;\nEND_VAR",
      "Main.st": main,
    });
    expect(messages(errors(service))).toMatch(/ZoneCapacity/i);
    expect(labels(service, "Main.st", main, "\nZon")).not.toContain("ZoneCapacity");
  });

  it("allows a local to shadow a qualified-only global member", () => {
    const service = workspace({
      "Settings.st": "{attribute 'qualified_only'}\nVAR_GLOBAL\nEnabled : INT;\nEND_VAR",
      "Main.st": program("Enabled : BOOL;", "Enabled := TRUE;"),
    });
    expect(errors(service)).toEqual([]);
  });

  it("rejects writes to qualified constants", () => {
    const service = workspace({
      "Settings.st":
        "{attribute 'qualified_only'}\nVAR_GLOBAL CONSTANT\nCapacity : UINT := 10;\nEND_VAR",
      "Main.st": program("", "Settings.Capacity := 12;"),
    });
    expect(messages(errors(service))).toMatch(/constant|read.only|writ/i);
  });

  it.each(["10", "Count + 1", "TRUE"])("rejects non-writable in-out argument %s", (argument) => {
    const service = workspace({
      "F_Update.st":
        "FUNCTION F_Update : INT\nVAR_IN_OUT\nValue : INT;\nEND_VAR\nF_Update := Value;\nEND_FUNCTION",
      "Main.st": program("Count : INT;", `Count := F_Update(Value := ${argument});`),
    });
    expect(errors(service).length).toBeGreaterThan(0);
  });

  it("allows unconnected input parameters on a function block", () => {
    const service = workspace({
      "FB_Timer.st":
        "FUNCTION_BLOCK FB_Timer\nVAR_INPUT\nEnabled : BOOL := FALSE; Delay : TIME := T#1s;\nEND_VAR\nEND_FUNCTION_BLOCK",
      "Main.st": program("Timer : FB_Timer;", "Timer();"),
    });
    expect(errors(service)).toEqual([]);
  });

  it("infers generic selection operators using formal parameter names rather than source order", () => {
    const service = workspace({
      "Main.st": program("Result : INT;", "Result := SEL(IN0 := 10, G := TRUE, IN1 := 20);"),
    });
    expect(errors(service)).toEqual([]);
  });

  it("accepts string literals of another length for VAR_IN_OUT CONSTANT", () => {
    const service = workspace({
      "F_Length.st":
        "FUNCTION F_Length : INT\nVAR_IN_OUT CONSTANT\nValue : STRING(10);\nEND_VAR\nF_Length := 0;\nEND_FUNCTION",
      "Main.st": program("Result : INT;", "Result := F_Length(Value := 'x');"),
    });
    expect(errors(service)).toEqual([]);
  });

  it.each(["Value := TRUE", "Wrong := 1", "Value := 1, Value := 2"])(
    "rejects invalid named arguments %s",
    (arguments_) => {
      const service = workspace({
        "F_Read.st":
          "FUNCTION F_Read : INT\nVAR_INPUT\nValue : INT;\nEND_VAR\nF_Read := Value;\nEND_FUNCTION",
        "Main.st": program("Count : INT;", `Count := F_Read(${arguments_});`),
      });
      expect(errors(service).length).toBeGreaterThan(0);
    },
  );

  it.each(["Items[0] := 1;", "Items[4] := 1;", "Items[TRUE] := 1;"])(
    "rejects invalid array access %s",
    (body) => {
      const service = workspace({
        "Main.st": program("Items : ARRAY[1..3] OF INT;", body),
      });
      expect(errors(service).length).toBeGreaterThan(0);
    },
  );

  it("implicitly dereferences references while preserving their type", () => {
    const main = program(
      "Item : ST_Item; Ref : REFERENCE TO ST_Item;",
      "Ref REF= Item; Ref.Enabled := TRUE;",
    );
    const service = workspace({
      "ST_Item.st": "TYPE ST_Item : STRUCT Enabled : BOOL; END_STRUCT END_TYPE",
      "Main.st": main,
    });
    expect(errors(service)).toEqual([]);
    expect(labels(service, "Main.st", main, "Ref.")).toContain("Enabled");
  });

  it("rejects widening conversions for by-reference parameters", () => {
    const service = workspace({
      "F_Update.st":
        "FUNCTION F_Update : INT\nVAR_IN_OUT\nValue : DINT;\nEND_VAR\nF_Update := 0;\nEND_FUNCTION",
      "Main.st": program("Count : INT; Result : INT;", "Result := F_Update(Value := Count);"),
    });
    expect(errors(service).length).toBeGreaterThan(0);
  });

  it.each([
    ["", "%QX0.0"],
    ["OutputBit AT %QX0.0 : BOOL;", "OutputBit"],
  ])(
    "rejects directly addressed bit storage as a VAR_IN_OUT argument %#",
    (declaration, argument) => {
      const service = workspace({
        "F_Set.st":
          "FUNCTION F_Set : BOOL\nVAR_IN_OUT\nValue : BOOL;\nEND_VAR\nF_Set := Value;\nEND_FUNCTION",
        "Main.st": program(
          `Result : BOOL; ${declaration}`,
          `Result := F_Set(Value := ${argument});`,
        ),
      });
      expect(errors(service).length).toBeGreaterThan(0);
    },
  );

  it.each(["UINT#-1", "INT#32768", "BYTE#256", "2#2"])(
    "rejects impossible numeric literal %s",
    (literal) => {
      const service = workspace({
        "Main.st": program("Value : LINT;", `Value := ${literal};`),
      });
      expect(errors(service).length).toBeGreaterThan(0);
    },
  );

  it.each(["BOOL#2", "BOOL#-1", "BOOL#1.5"])(
    "rejects invalid typed Boolean literal %s",
    (literal) => {
      const service = workspace({
        "Main.st": program("Flag : BOOL;", `Flag := ${literal};`),
      });
      expect(errors(service).length).toBeGreaterThan(0);
    },
  );

  it("keeps nominally distinct strict enumerations distinct", () => {
    const service = workspace({
      "E_A.st":
        "{attribute 'strict'}\n{attribute 'qualified_only'}\nTYPE E_A : (Idle, Active); END_TYPE",
      "E_B.st":
        "{attribute 'strict'}\n{attribute 'qualified_only'}\nTYPE E_B : (Idle, Active); END_TYPE",
      "Main.st": program("State : E_A;", "State := E_B.Idle;"),
    });
    expect(errors(service).length).toBeGreaterThan(0);
  });

  it("rejects arithmetic on strict enumeration values", () => {
    const service = workspace({
      "E_State.st":
        "{attribute 'strict'}\n{attribute 'qualified_only'}\nTYPE E_State : (Idle, Active); END_TYPE",
      "Main.st": program("State : E_State;", "State := E_State.Idle + 1;"),
    });
    expect(errors(service).length).toBeGreaterThan(0);
  });

  it("does not offer members for an unresolved receiver", () => {
    const main = program("Item : ST_Item;", "MissingReceiver.");
    const service = workspace({
      "ST_Item.st": "TYPE ST_Item : STRUCT SecretField : BOOL; END_STRUCT END_TYPE",
      "Main.st": main,
    });
    expect(labels(service, "Main.st", main, "MissingReceiver.")).not.toContain("SecretField");
  });
});

describe("adversarial CODESYS object relationships", () => {
  it.each(["PRG_ConveyorSetup.st", "PRG_ConveyorSetup/PRG_ConveyorSetup.declaration.st"])(
    "exposes program variables declared in %s to other programs",
    (declarationPath) => {
      const declaration = "PROGRAM PRG_ConveyorSetup\nVAR\nConveyorStarted : BOOL;\nEND_VAR";
      const consumer = program(
        "Enabled : BOOL;",
        "Enabled := PRG_ConveyorSetup.ConveyorStarted; PRG_ConveyorSetup.ConveyorStarted := FALSE;",
      );
      const service = workspace({
        [declarationPath]: declarationPath.endsWith(".declaration.st")
          ? declaration
          : `${declaration}\nEND_PROGRAM`,
        "Main.st": consumer,
      });
      expect(errors(service)).toEqual([]);
      expect(labels(service, "Main.st", consumer, "PRG_ConveyorSetup.")).toContain(
        "ConveyorStarted",
      );
      expect(
        service.definition(
          uri("Main.st"),
          position(consumer, "PRG_ConveyorSetup.ConveyorStarted"),
        )[0]?.uri,
      ).toBe(uri(declarationPath));
    },
  );

  it("keeps temporary program variables out of external scope", () => {
    const consumer = program("Enabled : BOOL;", "Enabled := PRG_ConveyorSetup.Scratch;");
    const service = workspace({
      "PRG_ConveyorSetup.st":
        "PROGRAM PRG_ConveyorSetup\nVAR_TEMP\nScratch : BOOL;\nEND_VAR\nEND_PROGRAM",
      "Main.st": consumer,
    });
    expect(errors(service).map(({ code }) => code)).toEqual(["inaccessible-member"]);
    expect(labels(service, "Main.st", consumer, "PRG_ConveyorSetup.")).not.toContain("Scratch");
  });

  it("offers protected methods in derived blocks while hiding them externally", () => {
    const childMethod = "METHOD Run\nTHIS^.ProtectedMethod(); SUPER^.PublicMethod();\nEND_METHOD";
    const main = program("Child : FB_Child;", "Child.PublicMethod();");
    const service = workspace({
      "FB_Base/source.st":
        "FUNCTION_BLOCK FB_Base\nVAR\nState : BOOL;\nEND_VAR\nEND_FUNCTION_BLOCK",
      "FB_Base/methods/Secret.st": "METHOD PRIVATE Secret\nEND_METHOD",
      "FB_Base/methods/ProtectedMethod.st": "METHOD PROTECTED ProtectedMethod\nEND_METHOD",
      "FB_Base/methods/PublicMethod.st": "METHOD PUBLIC PublicMethod\nEND_METHOD",
      "FB_Child/source.st": "FUNCTION_BLOCK FB_Child EXTENDS FB_Base\nEND_FUNCTION_BLOCK",
      "FB_Child/methods/Run.st": childMethod,
      "Main.st": main,
    });
    expect(errors(service, "FB_Child/methods/Run.st")).toEqual([]);
    expect(errors(service)).toEqual([]);
    const internal = labels(service, "FB_Child/methods/Run.st", childMethod, "THIS^.");
    expect(internal).toContain("ProtectedMethod");
    expect(internal).not.toContain("Secret");
    const external = labels(service, "Main.st", main, "Child.");
    expect(external).toContain("PublicMethod");
    expect(external).not.toContain("ProtectedMethod");
    expect(external).not.toContain("Secret");
    expect(external).not.toContain("State");
  });

  it("inherits interface methods and validates an implementing function block", () => {
    const main = program(
      "Device : FB_Device; Contract : I_Device;",
      "Contract := Device; Contract.Start(Enabled := TRUE);",
    );
    const service = workspace({
      "I_Base/source.st": "INTERFACE I_Base\nEND_INTERFACE",
      "I_Base/methods/Start.st": "METHOD Start\nVAR_INPUT\nEnabled : BOOL;\nEND_VAR",
      "I_Device/source.st": "INTERFACE I_Device EXTENDS I_Base\nEND_INTERFACE",
      "I_Device/methods/Stop.st": "METHOD Stop",
      "FB_Device/source.st": "FUNCTION_BLOCK FB_Device IMPLEMENTS I_Device\nEND_FUNCTION_BLOCK",
      "FB_Device/methods/Start.st": "METHOD Start\nVAR_INPUT\nEnabled : BOOL;\nEND_VAR\nEND_METHOD",
      "FB_Device/methods/Stop.st": "METHOD Stop\nEND_METHOD",
      "Main.st": main,
    });
    expect(errors(service)).toEqual([]);
    expect(errors(service, "FB_Device/source.st")).toEqual([]);
    expect(labels(service, "Main.st", main, "Contract.")).toEqual(
      expect.arrayContaining(["Start", "Stop"]),
    );
    service.removeDocument(uri("FB_Device/methods/Start.st"));
    expect(messages(errors(service, "FB_Device/source.st"))).toMatch(/Start/);
  });

  it("gives property accessors parent scope and separate local scopes", () => {
    const getter = "VAR\nScratch : BOOL;\nEND_VAR\nScratch := Storage; Value := Scratch;";
    const setter = "VAR\nScratch : INT;\nEND_VAR\nScratch := 1; Storage := Value;";
    const main = program("Box : FB_Box; Result : BOOL;", "Box.Value := TRUE; Result := Box.Value;");
    const service = workspace({
      "FB_Box/source.st":
        "FUNCTION_BLOCK FB_Box\nVAR\nStorage : BOOL;\nEND_VAR\nEND_FUNCTION_BLOCK",
      "FB_Box/properties/Value/declaration.st": "PROPERTY PUBLIC Value : BOOL",
      "FB_Box/properties/Value/get.st": getter,
      "FB_Box/properties/Value/set.st": setter,
      "Main.st": main,
    });
    for (const path of [
      "Main.st",
      "FB_Box/properties/Value/get.st",
      "FB_Box/properties/Value/set.st",
    ])
      expect(errors(service, path)).toEqual([]);
    const edits = service.rename(
      uri("FB_Box/properties/Value/get.st"),
      position(getter, "Scratch"),
      "Temporary",
    ).changes;
    expect(edits?.[uri("FB_Box/properties/Value/get.st")]).toHaveLength(3);
    expect(edits?.[uri("FB_Box/properties/Value/set.st")]).toBeUndefined();
    service.removeDocument(uri("FB_Box/properties/Value/set.st"));
    expect(messages(errors(service))).toMatch(/read.only|writ/i);
  });

  it("rejects reading a write-only property", () => {
    const service = workspace({
      "FB_Box/source.st": "FUNCTION_BLOCK FB_Box\nEND_FUNCTION_BLOCK",
      "FB_Box/properties/Value/declaration.st": "PROPERTY PUBLIC Value : BOOL",
      "FB_Box/properties/Value/set.st": "RETURN;",
      "Main.st": program("Box : FB_Box; Result : BOOL;", "Result := Box.Value;"),
    });
    expect(messages(errors(service))).toMatch(/getter|write.only/i);
  });

  it("detects duplicate declarations within one property accessor", () => {
    const service = workspace({
      "FB_Box/source.st": "FUNCTION_BLOCK FB_Box\nEND_FUNCTION_BLOCK",
      "FB_Box/properties/Value/declaration.st": "PROPERTY Value : BOOL",
      "FB_Box/properties/Value/get.st":
        "VAR\nScratch : INT; scratch : BOOL;\nEND_VAR\nValue := TRUE;",
    });
    expect(messages(errors(service, "FB_Box/properties/Value/get.st"))).toMatch(
      /duplicate|already/i,
    );
  });

  it("rejects rename collisions between locals in the same property accessor", () => {
    const getter =
      "VAR\nScratch : BOOL; Temporary : BOOL;\nEND_VAR\nScratch := TRUE; Value := Scratch;";
    const service = workspace({
      "FB_Box/source.st": "FUNCTION_BLOCK FB_Box\nEND_FUNCTION_BLOCK",
      "FB_Box/properties/Value/declaration.st": "PROPERTY Value : BOOL",
      "FB_Box/properties/Value/get.st": getter,
    });
    expect(() =>
      service.rename(
        uri("FB_Box/properties/Value/get.st"),
        position(getter, "Scratch"),
        "Temporary",
      ),
    ).toThrow();
  });

  it("resolves aliases around both a pointer and its array target", () => {
    const main = program(
      "Values : ZoneArray; pZones : ZonePointer;",
      "pZones := ADR(Values); pZones^[-2].Enabled := TRUE;",
    );
    const service = workspace({
      "ST_Zone.st": "TYPE ST_Zone : STRUCT Enabled : BOOL; END_STRUCT END_TYPE",
      "ZoneArray.st": "TYPE ZoneArray : ARRAY[-2..2] OF ST_Zone; END_TYPE",
      "ZonePointer.st": "TYPE ZonePointer : POINTER TO ZoneArray; END_TYPE",
      "Main.st": main,
    });
    expect(errors(service)).toEqual([]);
    expect(labels(service, "Main.st", main, "pZones^[-2].")).toContain("Enabled");
    expect(service.typeDefinition(uri("Main.st"), position(main, "pZones"))[0]?.uri).toBe(
      uri("ST_Zone.st"),
    );
  });

  it("binds implementation-only actions to their owning object", () => {
    const action = "Enabled := FALSE;";
    const service = workspace({
      "FB_Box/source.st":
        "FUNCTION_BLOCK FB_Box\nVAR\nEnabled : BOOL;\nEND_VAR\nEND_FUNCTION_BLOCK",
      "FB_Box/actions/Reset.st": action,
      "Main.st": program("Box : FB_Box;", "Box.Reset();"),
    });
    expect(errors(service, "FB_Box/actions/Reset.st")).toEqual([]);
    expect(errors(service)).toEqual([]);
    expect(
      service.definition(uri("FB_Box/actions/Reset.st"), position(action, "Enabled"))[0]?.uri,
    ).toBe(uri("FB_Box/source.st"));
  });
});

describe("adversarial editor transactions", () => {
  it("rejects a global rename that would capture references with a local variable", () => {
    const globals = "VAR_GLOBAL Count : INT; END_VAR";
    const main = program("Total : INT;", "Total := Count;");
    const service = workspace({ "Counters.st": globals, "Main.st": main });
    expect(() => service.rename(uri("Counters.st"), position(globals, "Count"), "Total")).toThrow();
  });

  it("allows a qualified global rename despite an unrelated same-name local", () => {
    const globals = "{attribute 'qualified_only'}\nVAR_GLOBAL Count : INT; END_VAR";
    const main = program("Total : INT;", "Total := Counters.Count;");
    const service = workspace({ "Counters.st": globals, "Main.st": main });
    const edits = service.rename(uri("Counters.st"), position(globals, "Count"), "Total").changes;
    expect(edits?.[uri("Main.st")]).toHaveLength(1);
  });

  it("allows a qualified field rename despite an unrelated same-name local", () => {
    const type = "TYPE ST_Item : STRUCT Value : INT; END_STRUCT END_TYPE";
    const main = program("Item : ST_Item; Count : INT;", "Item.Value := Count;");
    const service = workspace({ "ST_Item.st": type, "Main.st": main });
    const edits = service.rename(uri("ST_Item.st"), position(type, "Value"), "Count").changes;
    expect(edits?.[uri("Main.st")]).toHaveLength(1);
  });

  it("replaces the whole identifier when completing in the middle of a member", () => {
    const main = program("Item : ST_Item;", "Item.MotionAsserted := TRUE;");
    const service = workspace({
      "ST_Item.st": "TYPE ST_Item : STRUCT MotionAsserted : BOOL; END_STRUCT END_TYPE",
      "Main.st": main,
    });
    const completion = service
      .completion(uri("Main.st"), position(main, "Item.Moti"))
      .find(({ label }) => label === "MotionAsserted");
    expect(completion?.textEdit).toBeDefined();
    const edit = completion?.textEdit;
    if (edit && "range" in edit) expect(rangeText(main, edit.range)).toBe("MotionAsserted");
  });

  it("suppresses completion inside typed STRING literals", () => {
    const main = program("Message : STRING;", "Message := STRING#'hello';");
    const service = workspace({ "Main.st": main });
    expect(service.completion(uri("Main.st"), position(main, "STRING#'hel")).length).toBe(0);
  });

  it.each([
    "// hello",
    "(* hello",
    "Message := 'hello",
    'Message := "hello',
    "Message := STRING#'hello",
  ])("suppresses completion at the unfinished trivia boundary %s", (body) => {
    const main = `PROGRAM Main\nVAR\nMessage : STRING;\nEND_VAR\n${body}`;
    const service = workspace({ "Main.st": main });
    const cursor = TextDocument.create(uri("Main.st"), "codesys-st", 1, main).positionAt(
      main.length,
    );
    expect(service.completion(uri("Main.st"), cursor).length).toBe(0);
  });

  it("allows completion immediately after a closed block comment", () => {
    const main = "PROGRAM Main\nVAR\nEnabled : BOOL;\nEND_VAR\n(* finished *)";
    const service = workspace({ "Main.st": main });
    expect(labels(service, "Main.st", main, "(* finished *)")).toContain("Enabled");
  });

  it("updates dependent completion when a field type changes and disappears", () => {
    const main = program("Item : ST_Item;", "Item.Value.");
    const service = workspace({
      "ST_A.st": "TYPE ST_A : STRUCT First : BOOL; END_STRUCT END_TYPE",
      "ST_B.st": "TYPE ST_B : STRUCT Second : BOOL; END_STRUCT END_TYPE",
      "ST_Item.st": "TYPE ST_Item : STRUCT Value : ST_A; END_STRUCT END_TYPE",
      "Main.st": main,
    });
    expect(labels(service, "Main.st", main, "Item.Value.")).toContain("First");
    service.setDocument(
      uri("ST_Item.st"),
      "TYPE ST_Item : STRUCT Value : ST_B; END_STRUCT END_TYPE",
      2,
    );
    const changed = labels(service, "Main.st", main, "Item.Value.");
    expect(changed).toContain("Second");
    expect(changed).not.toContain("First");
    service.removeDocument(uri("ST_B.st"));
    expect(labels(service, "Main.st", main, "Item.Value.")).not.toContain("Second");
    expect(errors(service, "ST_Item.st").length).toBeGreaterThan(0);
  });

  it("keeps two independent source roots isolated", () => {
    const main = program("Count : OnlyInFirst;", "");
    const first = workspace({
      "OnlyInFirst.st": "TYPE OnlyInFirst : INT; END_TYPE",
      "Main.st": main,
    });
    const second = workspace({ "Main.st": main });
    expect(errors(first)).toEqual([]);
    expect(errors(second).length).toBeGreaterThan(0);
  });

  it("renames only the selected symbol, excluding same-spelling fields and trivia", () => {
    const main = program(
      "Left : ST_A; Right : ST_B;",
      "Left.Value := TRUE; Right.Value := 1;\n// Left.Value\nLog('Left.Value');",
    );
    const a = "TYPE ST_A : STRUCT Value : BOOL; END_STRUCT END_TYPE";
    const b = "TYPE ST_B : STRUCT Value : INT; END_STRUCT END_TYPE";
    const service = workspace({ "ST_A.st": a, "ST_B.st": b, "Main.st": main });
    const edits = service.rename(uri("Main.st"), position(main, "Left.Value"), "Enabled").changes;
    expect(edits?.[uri("ST_A.st")]).toHaveLength(1);
    expect(edits?.[uri("ST_B.st")]).toBeUndefined();
    expect(edits?.[uri("Main.st")]).toHaveLength(1);
    for (const edit of edits?.[uri("Main.st")] ?? []) {
      expect(rangeText(main, edit.range)).toBe("Value");
      expect(edit.newText).toBe("Enabled");
    }
  });

  it.each(["IF", "Bad Name", "123Name"])("rejects invalid rename target %s", (newName) => {
    const main = program("Count : INT;", "Count := 1;");
    const service = workspace({ "Main.st": main });
    expect(() => service.rename(uri("Main.st"), position(main, "Count"), newName)).toThrow();
  });

  it("rejects rename collisions ignoring case", () => {
    const main = program("Count : INT; Total : INT;", "Count := Total;");
    const service = workspace({ "Main.st": main });
    expect(() => service.rename(uri("Main.st"), position(main, "Count"), "total")).toThrow();
  });

  it("renames a formal parameter label without renaming the caller's same-name variable", () => {
    const main = program("Value : INT; Result : INT;", "Result := F_Read(Value := Value);");
    const functionText =
      "FUNCTION F_Read : INT\nVAR_INPUT\nValue : INT;\nEND_VAR\nF_Read := Value;\nEND_FUNCTION";
    const service = workspace({ "F_Read.st": functionText, "Main.st": main });
    const edits = service.rename(
      uri("F_Read.st"),
      position(functionText, "Value"),
      "Amount",
    ).changes;
    expect(edits?.[uri("F_Read.st")]).toHaveLength(2);
    expect(edits?.[uri("Main.st")]).toHaveLength(1);
    const edit = edits?.[uri("Main.st")]?.[0];
    if (edit) {
      const document = TextDocument.create(uri("Main.st"), "codesys-st", 1, main);
      expect(document.offsetAt(edit.range.start)).toBe(main.indexOf("Value := Value"));
    }
  });

  it.each(["\n", "\r\n", "\r"])(
    "preserves UTF-16 diagnostic offsets with %j line endings",
    (eol) => {
      const main = program("Enabled : BOOL;", "(* 😀 *) Enabled := MissingName;").replaceAll(
        "\n",
        eol,
      );
      const service = workspace({ "Main.st": main });
      const diagnostic = errors(service).find(({ message }) => /MissingName/i.test(message));
      expect(diagnostic).toBeDefined();
      if (diagnostic) expect(rangeText(main, diagnostic.range)).toBe("MissingName");
    },
  );

  it("emits valid semantic token ranges without coloring comment or string lookalikes", () => {
    const main =
      `\uFEFF${program("Value : INT; Message : STRING;", "(* 😀 Value *) Value := 1; Message := 'Value';")}`.replaceAll(
        "\n",
        "\r\n",
      );
    const service = workspace({ "Main.st": main });
    const data = service.semanticTokens(uri("Main.st")).data;
    expect(data.length % 5).toBe(0);
    const names: string[] = [];
    let line = 0;
    let character = 0;
    let previousEnd = -1;
    const document = TextDocument.create(uri("Main.st"), "codesys-st", 1, main);
    for (let index = 0; index < data.length; index += 5) {
      const [lineDelta = -1, characterDelta = -1, length = -1, type = -1] = data.slice(
        index,
        index + 5,
      );
      expect(lineDelta).toBeGreaterThanOrEqual(0);
      expect(characterDelta).toBeGreaterThanOrEqual(0);
      expect(length).toBeGreaterThan(0);
      expect(type).toBeGreaterThanOrEqual(0);
      line += lineDelta;
      character = lineDelta === 0 ? character + characterDelta : characterDelta;
      const start = document.offsetAt({ line, character });
      const end = document.offsetAt({ line, character: character + length });
      expect(start).toBeGreaterThanOrEqual(previousEnd);
      expect(end - start).toBe(length);
      names.push(main.slice(start, end));
      previousEnd = end;
    }
    expect(names.filter((name) => name === "Value")).toHaveLength(2);
    expect(names.filter((name) => name === "Message")).toHaveLength(2);
  });

  it("keeps signature help on the outer call after a nested call", () => {
    const main = program("Result : INT;", "Result := F_Add(Left := ABS(-1), Right := ");
    const service = workspace({
      "F_Add.st":
        "FUNCTION F_Add : INT\nVAR_INPUT\nLeft : INT; Right : INT;\nEND_VAR\nF_Add := Left + Right;\nEND_FUNCTION",
      "Main.st": main,
    });
    const help = service.signatureHelp(uri("Main.st"), position(main, "Right := "));
    expect(help?.signatures[0]?.label).toMatch(/F_Add/i);
    expect(help?.activeParameter).toBe(1);
  });
});

describe("adversarial incomplete and pathological input", () => {
  it("survives 1,000 reproducible token mutations across editing requests", () => {
    const service = new LanguageService();
    fc.assert(
      fc.property(
        fc.array(
          fc.constantFrom(
            "PROGRAM",
            "END_PROGRAM",
            "VAR",
            "END_VAR",
            "ARRAY",
            "OF",
            "POINTER",
            "TO",
            "INT",
            "CASE",
            "IF",
            "THEN",
            "END_IF",
            "END_CASE",
            "Foo",
            "1",
            "2",
            "(",
            ")",
            "[",
            "]",
            ":",
            ":=",
            ";",
            ",",
            "^",
            ".",
            " ",
            "\n",
            "*",
            "{",
            "}",
            "'",
          ),
          { maxLength: 100 },
        ),
        (pieces) => {
          const text = pieces.join(" ");
          service.setDocument(uri("Fuzz.st"), text);
          const cursor = TextDocument.create(uri("Fuzz.st"), "codesys-st", 1, text).positionAt(
            text.length,
          );
          service.diagnostics(uri("Fuzz.st"));
          service.completion(uri("Fuzz.st"), cursor);
          service.definition(uri("Fuzz.st"), cursor);
          service.hover(uri("Fuzz.st"), cursor);
        },
      ),
      { seed: 20260919, numRuns: 1000 },
    );
  });

  it("accepts a nested CASE without mistaking its label for the outer label", () => {
    const service = workspace({
      "Main.st": "PROGRAM Main\nCASE 1 OF 1: CASE 1 OF 1: RETURN; END_CASE; END_CASE;\nEND_PROGRAM",
    });
    expect(errors(service)).toEqual([]);
  });

  it("survives every prefix of representative source through all read requests", () => {
    const source = program(
      "Data : ARRAY[1..3] OF POINTER TO INT; Enabled : BOOL;",
      "IF Enabled THEN Data[1]^ := 16#FF; END_IF;",
    );
    const service = new LanguageService();
    for (let end = 0; end <= source.length; end++) {
      const text = source.slice(0, end);
      service.setDocument(uri("Main.st"), text, end);
      const cursor = TextDocument.create(uri("Main.st"), "codesys-st", end, text).positionAt(end);
      expect(() => {
        service.diagnostics(uri("Main.st"));
        service.completion(uri("Main.st"), cursor);
        service.hover(uri("Main.st"), cursor);
        service.definition(uri("Main.st"), cursor);
        service.typeDefinition(uri("Main.st"), cursor);
        service.references(uri("Main.st"), cursor);
        service.signatureHelp(uri("Main.st"), cursor);
        service.documentSymbols(uri("Main.st"));
        service.semanticTokens(uri("Main.st"));
        service.foldingRanges(uri("Main.st"));
      }).not.toThrow();
    }
  });

  it("does not recurse forever through cyclic aliases or inheritance", () => {
    const service = workspace({
      "A.st": "TYPE A : B; END_TYPE",
      "B.st": "TYPE B : A; END_TYPE",
      "FB_A.st": "FUNCTION_BLOCK FB_A EXTENDS FB_B END_FUNCTION_BLOCK",
      "FB_B.st": "FUNCTION_BLOCK FB_B EXTENDS FB_A END_FUNCTION_BLOCK",
      "Main.st": program("Value : A; Box : FB_A;", "Box."),
    });
    expect(() => service.completion(uri("Main.st"), { line: 4, character: 4 })).not.toThrow();
    const diagnostics = ["A.st", "B.st", "FB_A.st", "FB_B.st"].flatMap((path) =>
      errors(service, path),
    );
    expect(messages(diagnostics)).toMatch(/cycl|recursive/i);
  });

  it("ignores one thousand nested comment levels and keyword-like identifiers", () => {
    const comment = `${"(*".repeat(1000)} END_VAR METHOD Fake ${"*)".repeat(1000)}`;
    const main = `${comment}\n${program("END_Value : INT; VAR_FUTURE : INT;", "END_Value := VAR_FUTURE;")}`;
    const service = workspace({ "Main.st": main });
    expect(errors(service)).toEqual([]);
    expect(service.workspaceSymbols("Fake")).toEqual([]);
  });
});
