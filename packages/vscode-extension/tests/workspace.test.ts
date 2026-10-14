import { afterEach, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Workspace } from "../src/server/workspace";

const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});
const folder = async () => {
  const path = await mkdtemp(join(tmpdir(), "codesys-st-workspace-"));
  temporary.push(path);
  return path;
};
const source = async (root: string, name: string, text: string) => {
  const path = join(root, name);
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, text);
  return pathToFileURL(path).href;
};

it("discovers isolated PLC projects without evaluating their config", async () => {
  const root = await folder();
  await source(root, "a/codesys-build.config.ts", "throw new Error('MUST NOT EXECUTE');");
  await source(root, "b/codesys-build.config.ts", "throw new Error('MUST NOT EXECUTE');");
  await source(root, "a/src/Type.st", "TYPE Item : BOOL; END_TYPE");
  await source(root, "b/src/Type.st", "TYPE Item : INT; END_TYPE");
  const a = await source(
    root,
    "a/src/Main.st",
    "PROGRAM Main VAR X : Item; END_VAR X := TRUE; END_PROGRAM",
  );
  const b = await source(
    root,
    "b/src/Main.st",
    "PROGRAM Main VAR X : Item; END_VAR X := TRUE; END_PROGRAM",
  );
  const workspace = new Workspace([root], { sourceRoots: [], libraryPaths: [] }, () => {});
  await workspace.refresh();
  expect(workspace.projects).toHaveLength(2);
  expect(workspace.service(a).diagnostics(a)).toEqual([]);
  expect(
    workspace
      .service(b)
      .diagnostics(b)
      .some((d) => d.code === "type-mismatch"),
  ).toBe(true);
});

it("preserves unsaved buffers across disk refresh and restores disk on close", async () => {
  const root = await folder();
  const uri = await source(
    root,
    "Main.st",
    "PROGRAM Main VAR Flag : BOOL; END_VAR Flag := TRUE; END_PROGRAM",
  );
  const workspace = new Workspace([root], { sourceRoots: [], libraryPaths: [] }, () => {});
  workspace.setDocument(uri, "PROGRAM Main VAR Flag : BOOL; END_VAR Flag := 123; END_PROGRAM", 2);
  await workspace.refresh();
  expect(
    workspace
      .service(uri)
      .diagnostics(uri)
      .some((d) => d.code === "type-mismatch"),
  ).toBe(true);
  workspace.closeDocument(uri);
  await workspace.refresh();
  expect(workspace.service(uri).diagnostics(uri)).toEqual([]);
});

it("refreshes deleted dependencies and skips symlinks and generated directories", async () => {
  const root = await folder();
  const type = await source(root, "Item.st", "TYPE Item : INT; END_TYPE");
  const main = await source(root, "Main.st", "PROGRAM Main VAR X : Item; END_VAR END_PROGRAM");
  await source(root, "build/Bad.st", "not ST");
  await symlink(join(root, "Item.st"), join(root, "Other.st"));
  const workspace = new Workspace([root], { sourceRoots: [], libraryPaths: [] }, () => {});
  await workspace.refresh();
  expect(workspace.allUris()).toHaveLength(2);
  expect(workspace.service(main).diagnostics(main)).toEqual([]);
  await rm(new URL(type));
  await workspace.refresh();
  expect(
    workspace
      .service(main)
      .diagnostics(main)
      .some((d) => d.code === "unknown-type"),
  ).toBe(true);
});

it("honors custom source and library roots", async () => {
  const root = await folder();
  const main = await source(
    root,
    "plc/Main.st",
    "PROGRAM Main VAR X : VendorType; END_VAR END_PROGRAM",
  );
  await source(root, "signatures/VendorType.st", "TYPE VendorType : DINT; END_TYPE");
  const workspace = new Workspace(
    [root],
    { sourceRoots: ["plc"], libraryPaths: ["signatures"] },
    () => {},
  );
  await workspace.refresh();
  expect(workspace.service(main).diagnostics(main)).toEqual([]);
});
