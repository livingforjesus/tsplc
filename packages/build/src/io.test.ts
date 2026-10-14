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
