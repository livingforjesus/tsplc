import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import fc from "fast-check";
import { LanguageService } from "../src/language/service";

describe("authored source compatibility", () => {
  it("refuses an unreferenced global rename that creates another global declaration", () => {
    const service = new LanguageService();
    service.setDocument("file:///A.st", "VAR_GLOBAL First : INT; END_VAR");
    service.setDocument("file:///B.st", "VAR_GLOBAL Second : INT; END_VAR");
    expect(() => service.rename("file:///A.st", { line: 0, character: 13 }, "Second")).toThrow();
  });
  it("declines object rename before prompting for a new name", () => {
    const service = new LanguageService();
    service.setDocument("file:///Main.st", "PROGRAM Main END_PROGRAM");
    expect(service.prepareRename("file:///Main.st", { line: 0, character: 9 })).toBeNull();
  });
  it("supports the advertised .iecst extension for split declarations", () => {
    const service = new LanguageService();
    service.setDocument(
      "file:///FB_Box/declaration.iecst",
      "FUNCTION_BLOCK FB_Box VAR Count : INT; END_VAR",
    );
    service.setDocument("file:///FB_Box/implementation.iecst", "Count := 1;");
    expect(service.diagnostics("file:///FB_Box/declaration.iecst")).toEqual([]);
    expect(service.diagnostics("file:///FB_Box/implementation.iecst")).toEqual([]);
  });
  for (const [fixture, count] of [
    ["blueprint", 27],
    ["build-tool", 51],
  ] as const) {
    it(`analyzes all ${count} ${fixture} source files without diagnostics`, async () => {
      const root = join(import.meta.dir, "fixtures", fixture);
      const service = new LanguageService();
      const uris: string[] = [];
      for await (const file of new Bun.Glob("**/*.st").scan(root)) {
        const path = join(root, file);
        const uri = pathToFileURL(path).href;
        uris.push(uri);
        service.setDocument(uri, await Bun.file(path).text());
      }
      expect(uris).toHaveLength(count);
      expect(
        uris.flatMap((uri) =>
          service.diagnostics(uri).map((diagnostic) => ({ uri, ...diagnostic })),
        ),
      ).toEqual([]);
    });
  }
  it("detects every mutated BOOL field assignment in generated structs", () => {
    fc.assert(
      fc.property(fc.array(fc.boolean(), { minLength: 1, maxLength: 30 }), (flags) => {
        const service = new LanguageService();
        service.setDocument(
          "file:///generated/ST_Test.st",
          `TYPE ST_Test : STRUCT ${flags.map((_, i) => `Field${i} : BOOL;`).join(" ")} END_STRUCT END_TYPE`,
        );
        service.setDocument(
          "file:///generated/Main.st",
          `PROGRAM Main VAR Value : ST_Test; END_VAR ${flags.map((valid, i) => `Value.Field${i} := ${valid ? "TRUE" : "123"};`).join(" ")} END_PROGRAM`,
        );
        expect(
          service
            .diagnostics("file:///generated/Main.st")
            .filter((d) => d.code === "type-mismatch"),
        ).toHaveLength(flags.filter((valid) => !valid).length);
      }),
      { seed: 611313, numRuns: 100 },
    );
  });
  it("keeps semantic token ranges ordered and in bounds", async () => {
    const service = new LanguageService();
    const uri = "file:///Main.st";
    const text =
      "PROGRAM Main\r\nVAR\r\n (* 🦺 *) Value : BOOL;\r\nEND_VAR\r\nValue := TRUE;\r\nEND_PROGRAM";
    service.setDocument(uri, text);
    const data = service.semanticTokens(uri).data;
    let line = 0;
    let character = 0;
    for (let i = 0; i < data.length; i += 5) {
      const delta = data[i] ?? 0;
      line += delta;
      character = delta ? (data[i + 1] ?? 0) : character + (data[i + 1] ?? 0);
      expect(data[i + 2]).toBeGreaterThan(0);
      expect(character + (data[i + 2] ?? 0)).toBeLessThanOrEqual(
        text.split("\r\n")[line]?.length ?? 0,
      );
    }
  });
  it("uses valid JavaScript indentation regexes, including lowercase ST", async () => {
    const config = await Bun.file(join(import.meta.dir, "../language-configuration.json")).json();
    const increase = new RegExp(
      config.indentationRules.increaseIndentPattern.pattern,
      config.indentationRules.increaseIndentPattern.flags,
    );
    const decrease = new RegExp(
      config.indentationRules.decreaseIndentPattern.pattern,
      config.indentationRules.decreaseIndentPattern.flags,
    );
    expect(increase.test("if Enabled then")).toBe(true);
    expect(decrease.test("end_if;")).toBe(true);
    expect(increase.test("// IF TRUE THEN")).toBe(false);
  });
});
