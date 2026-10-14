import { expect, it } from "bun:test";
import { parseSource } from "./st/parse";

it("selects the vendor persistent-variable-list role from global section modifiers", () => {
  const source =
    "{attribute 'qualified_only'}\nVAR_GLOBAL (* nested (* comment *) *) RETAIN\nPERSISTENT\ncount : DINT := 30;\nEND_VAR";
  expect(parseSource(source, { name: "GVL_Persistent" })).toMatchObject({
    kind: "gvl",
    persistent: true,
    declaration: source,
  });
});

it("does not select a persistent list from comments, strings, or program-local modifiers", () => {
  expect(
    parseSource(
      "{attribute 'note' := 'PERSISTENT'}\nVAR_GLOBAL // PERSISTENT\nvalue : STRING := 'PERSISTENT';\nEND_VAR",
      { name: "GVL" },
    ).persistent,
  ).toBeUndefined();
  expect(
    parseSource("PROGRAM Main\nVAR PERSISTENT RETAIN\ncount : DINT;\nEND_VAR\nRETURN;\nEND_PROGRAM")
      .persistent,
  ).toBeUndefined();
});
