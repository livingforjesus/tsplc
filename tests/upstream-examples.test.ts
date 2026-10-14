import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { isAbsolute, join } from "node:path";

const examples = join(import.meta.dir, "../examples");
const imported = [
  ["traffic-control", 22, 16],
  ["mixing-tank", 18, 7],
  ["garden-controller", 27, 18],
] as const;

interface Snapshot {
  repository: string;
  revision: string;
  license: string;
  files: { path: string; sha256: string }[];
}

function hash(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function files(directory: string, prefix = ""): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = prefix + entry.name;
    return entry.isDirectory() ? files(join(directory, entry.name), `${path}/`) : [path];
  });
}

describe("licensed upstream example snapshots", () => {
  for (const [name, count] of imported) {
    test(`${name} preserves every pinned upstream file and license`, () => {
      const directory = join(examples, name);
      const snapshot: Snapshot = JSON.parse(readFileSync(join(directory, "upstream.json"), "utf8"));
      expect(snapshot.repository).toStartWith("https://github.com/tkucic/");
      expect(snapshot.revision).toMatch(/^[a-f0-9]{40}$/);
      expect(snapshot.license).toBe("MIT");
      expect(snapshot.files).toHaveLength(count);
      expect(files(join(directory, "upstream")).sort()).toEqual(
        snapshot.files.map((file) => file.path).sort(),
      );
      for (const file of snapshot.files) {
        expect(isAbsolute(file.path)).toBe(false);
        expect(file.path).not.toMatch(/(?:^|\/)\.\.(?:\/|$)/);
        expect(hash(join(directory, "upstream", file.path))).toBe(file.sha256);
      }
      expect(readFileSync(join(directory, "LICENSE"), "utf8")).toBe(
        readFileSync(join(directory, "upstream/LICENSE"), "utf8"),
      );
    });
  }

  test("the Util template preserves its source and pins its prepared project", () => {
    const directory = join(examples, "templates");
    const provenance: {
      source: string;
      sourceSha256: string;
      project: string;
      sha256: string;
      addedLibrary: string;
    } = JSON.parse(readFileSync(join(directory, "provenance.json"), "utf8"));
    expect(hash(join(directory, provenance.source))).toBe(provenance.sourceSha256);
    expect(hash(join(directory, provenance.project))).toBe(provenance.sha256);
    expect(provenance.addedLibrary).toBe("Util, 3.5.22.0 (System)");
  });
});

describe("complete authored example ports", () => {
  for (const [name, , count] of imported) {
    test(`${name} accounts for every original source object and maintained source file`, () => {
      const directory = join(examples, name);
      const manifest: {
        source: string;
        objects: { kind: string; name: string; paths: string[] }[];
      } = JSON.parse(readFileSync(join(directory, "port.json"), "utf8"));
      expect(manifest.source).toMatch(/^upstream\/[A-Za-z_]+\.xml$/);
      const xml = readFileSync(join(directory, manifest.source), "utf8");
      const original: string[] = [];
      // These immutable PLCopen fixtures use unprefixed tags and this exact
      // attribute order. This inventories their authored objects, not arbitrary XML.
      for (const match of xml.matchAll(/<dataType name="([^"]+)"/g)) {
        original.push(`type:${match[1]}`);
      }
      for (const match of xml.matchAll(/<globalVars name="([^"]+)"/g)) {
        original.push(`globals:${match[1]}`);
      }
      for (const match of xml.matchAll(
        /<pou name="([^"]+)" pouType="([^"]+)">([\s\S]*?)<\/pou>/g,
      )) {
        original.push(`${match[2]}:${match[1]}`);
        const body = match[3];
        if (body === undefined) throw new Error("Missing original POU body");
        for (const action of body.matchAll(/<action name="([^"]+)"/g)) {
          original.push(`action:${match[1]}.${action[1]}`);
        }
      }
      expect(original).toHaveLength(count);
      expect(manifest.objects.map((object) => `${object.kind}:${object.name}`).sort()).toEqual(
        original.sort(),
      );
      const accounted = new Set<string>();
      for (const object of manifest.objects) {
        expect(object.paths.length).toBeGreaterThan(0);
        for (const path of object.paths) {
          expect(path).toMatch(/^src\/[A-Za-z0-9_/-]+\.ts$/);
          expect(readFileSync(join(directory, path), "utf8").trim().length).toBeGreaterThan(0);
          accounted.add(path);
        }
      }
      expect([...accounted].sort()).toEqual(
        files(join(directory, "src"))
          .map((path) => `src/${path}`)
          .sort(),
      );
    });
  }
});
