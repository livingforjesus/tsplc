import { expect, test } from "bun:test";
import { bindStructuredTextIo } from "./io.ts";
import type { SourceObject } from "./sources.ts";
const unit = (declaration: string): SourceObject => ({
  kind: "gvl",
  name: "LineIO",
  declaration,
  source: "LineIO.st",
  folder: [],
  children: [],
});
test("binds the configured scalar address while preserving comments and source implementation", () => {
  const object = unit(
    "(* Sensor *)\nVAR_GLOBAL\n  Start : BOOL;\n  Value AT %IW3 : UINT;\nEND_VAR\n",
  );
  bindStructuredTextIo([object], {
    "LineIO.Start": { address: "%IX25.3" },
    "LineIO.Value": { address: "%IW4" },
  });
  expect(object.declaration).toContain("Start AT %IX25.3 : BOOL;");
  expect(object.declaration).toContain("Value AT %IW4 : UINT;");
  expect(object.declaration).toStartWith("(* Sensor *)");
});
test("rejects ambiguous names and mismatched IO widths", () => {
  const a = unit("VAR_GLOBAL Start : BOOL; END_VAR"),
    b = { ...a, name: "Other" };
  expect(() => bindStructuredTextIo([a, b], { Start: { address: "%IX0.0" } })).toThrow("found 2");
  expect(() => bindStructuredTextIo([a], { Start: { address: "%IB0" } })).toThrow("incompatible");
});
test("binds an EDS byte span to an array declaration with the same layout", () => {
  const object = unit(
    "VAR_GLOBAL\n  Result : ARRAY [1..480] OF BYTE;\n  Flags : ARRAY[0..7] OF BOOL;\nEND_VAR\n",
  );
  bindStructuredTextIo([object], {
    "LineIO.Result": { address: "%IB16", type: "ARRAY[0..479] OF BYTE" },
  });
  expect(object.declaration).toContain("Result AT %IB16 : ARRAY [1..480] OF BYTE;");
  expect(() =>
    bindStructuredTextIo([unit("VAR_GLOBAL Result : ARRAY[0..9] OF BYTE; END_VAR")], {
      Result: { address: "%IB16", type: "ARRAY[0..479] OF BYTE" },
    }),
  ).toThrow("expected");
  expect(() => bindStructuredTextIo([object], { Flags: { address: "%IX0.0" } })).toThrow(
    "incompatible",
  );
});
