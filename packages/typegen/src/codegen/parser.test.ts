import { expect, test } from "bun:test";
import { parseGlobals } from "./parser.ts";

test("mapped globals retain their PLC types independently of direct addresses", () => {
  const list = parseGlobals(
    {
      name: "GVL_IO.st",
      text: `
    {attribute 'qualified_only'}
    VAR_GLOBAL
      Ready AT %IX0.0 : BOOL;
      Status AT %IW512 : UINT;
      Output AT %QB576 : BYTE := BYTE#0;
      Allocated AT %I* : BOOL;
    END_VAR`,
    },
    "GVL_IO",
  );
  expect(list.members.map((member) => [member.name, member.type])).toEqual([
    ["Ready", { kind: "named", name: "BOOL" }],
    ["Status", { kind: "named", name: "UINT" }],
    ["Output", { kind: "named", name: "BYTE" }],
    ["Allocated", { kind: "named", name: "BOOL" }],
  ]);
  expect(list.members[2]?.initial).toBe("BYTE # 0");
});

test("retained global qualifiers do not become variable names", () => {
  expect(
    parseGlobals(
      { name: "Settings.st", text: "VAR_GLOBAL PERSISTENT RETAIN Count : UINT; END_VAR" },
      "Settings",
    ).members[0]?.name,
  ).toBe("Count");
  expect(() =>
    parseGlobals({ name: "Invalid.st", text: "VAR_GLOBAL Ready AT : BOOL; END_VAR" }, "Invalid"),
  ).toThrow("direct address");
});
