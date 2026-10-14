import { expect, it } from "bun:test";
import { integerExpression } from "./constants";

it("evaluates qualified bounds and integer arithmetic without executing source", () => {
  const count = 4;
  expect(
    integerExpression("Limits . Count * (2 + 1) - 5 / 2", (name) => {
      if (name !== "Limits.Count") throw new Error(`Unknown constant ${name}`);
      return count;
    }),
  ).toBe(count * 3 - 2);
});

it.each(["1 2", "2#2", "1 / 0", "9007199254740993 - 9007199254740992", "1; process.exit()"])(
  "rejects invalid integer expression %s",
  (expression) => {
    expect(() =>
      integerExpression(expression, () => {
        throw new Error("Unexpected constant");
      }),
    ).toThrow();
  },
);
