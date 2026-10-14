import { expect, test } from "bun:test";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execute = promisify(execFile);
const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));

test.each([
  [process.execPath, cli],
  ["/bin/sh", fileURLToPath(new URL("../docker/codesys-build", import.meta.url))],
])(
  "public entrypoint %s builds through Docker with the shared config and verified artifacts",
  async (...entrypoint) => {
    const root = await mkdtemp(resolve(tmpdir(), "codesys docker, build-"));
    try {
      await mkdir(resolve(root, "bin"));
      await mkdir(resolve(root, "sources/domain"), { recursive: true });
      await writeFile(
        resolve(root, "sources/domain/Main.st"),
        "PROGRAM Main\nRETURN;\nEND_PROGRAM",
      );
      await writeFile(resolve(root, "base.project"), "template");
      await writeFile(
        resolve(root, "config.ts"),
        `export const config = {backend:"codesys",build:{template: "base.project", sourceDir: "sources", entry: "sources/domain/Main.st", docker: {image: "builder:test"}}};`,
      );
      await writeFile(
        resolve(root, "bin/docker"),
        `#!${process.execPath}
import {readFile,writeFile,mkdir} from "node:fs/promises";
const args=process.argv.slice(2);
const mounts=args.filter((value,index)=>args[index-1]==="--mount");
const source=(target)=>{
 const mount=mounts.find(value=>value.includes("target="+target+"," ) || value.endsWith("target="+target));
 return /"source=((?:[^"]|"")*)"/.exec(mount)[1].replaceAll('""','"');
};
const input=source("/input");
const output=source("/output");
const request=JSON.parse(await readFile(input+"/config.json","utf8"));
await writeFile(process.env.CODESYS_DOCKER_RECORD,JSON.stringify({args,input,request}));
if(process.env.CODESYS_DOCKER_FAIL) process.exit(17);
await mkdir(output+"/runtime",{recursive:true});
for (const file of ["Application.project","runtime/Application.app","runtime/Application.crc"]) await writeFile(output+"/"+file,"compiled");
await writeFile(output+"/build.json",JSON.stringify({mode:"build",application:"Application"}));
`,
        { mode: 0o755 },
      );
      const record = resolve(root, "record.json");
      const options = {
        cwd: root,
        env: {
          ...process.env,
          PATH: `${resolve(root, "bin")}:${process.env["PATH"]}`,
          CODESYS_DOCKER_RECORD: record,
        },
      };
      const result = await execute(
        entrypoint[0]!,
        [entrypoint[1]!, "build", "--config", "config.ts"],
        options,
      );
      expect(result.stdout).toContain("Building with Docker (builder:test)");
      const recorded = JSON.parse(await readFile(record, "utf8"));
      expect(recorded.args).toContain("builder:test");
      expect(recorded.args).not.toContain("--platform");
      expect(recorded.args).toContain("--init");
      expect(recorded.request.sourceDir).toBe("/sources");
      expect(recorded.request.entry).toBe("/sources/domain/Main.st");
      expect(recorded.request.outDir).toBe("/output");
      expect(recorded.request.docker).toBeUndefined();
      expect(recorded.request.configFile).toBeUndefined();
      expect(recorded.request.codesys).toBeUndefined();
      expect(await readFile(resolve(root, "build/runtime/Application.app"), "utf8")).toBe(
        "compiled",
      );
      await expect(readFile(resolve(recorded.input, "config.json"))).rejects.toThrow();
      await expect(
        execute(entrypoint[0]!, [entrypoint[1]!, "build", "--config", "config.ts"], {
          ...options,
          env: { ...options.env, CODESYS_DOCKER_FAIL: "true" },
        }),
      ).rejects.toThrow("Docker build failed (17)");
      const failed = JSON.parse(await readFile(record, "utf8"));
      await expect(readFile(resolve(failed.input, "config.json"))).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
