import { expect, it } from "bun:test";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execute = promisify(execFile);
const imageId = `sha256:${"a".repeat(64)}`;
const controllerModule = fileURLToPath(new URL("./controller-online.ts", import.meta.url));
const configModule = fileURLToPath(new URL("./config.ts", import.meta.url));

const fixture = async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'codesys controller, "quoted"-'));
  await mkdir(resolve(root, "bin"));
  await mkdir(resolve(root, "sources/domain"), { recursive: true });
  await writeFile(resolve(root, "sources/domain/Main.st"), "PROGRAM Main\nRETURN;\nEND_PROGRAM");
  await writeFile(resolve(root, "base.project"), "original project template");
  await writeFile(
    resolve(root, "probe.ts"),
    `
import {updateController,inspectController} from ${JSON.stringify(controllerModule)};
import {resolveConfig} from ${JSON.stringify(configModule)};
const config=resolveConfig({
 template:"base.project",sourceDir:"sources",entry:"sources/domain/Main.st",
 docker:{image:"builder:mutable-tag",cpuSet:"0-1"},runtime:{composeFile:"compose.yaml"},
 online:{network:"controller-net",gateway:{host:"gateway.test"},device:{host:"plc.test"},
 credentials:{usernameEnv:"TEST_PLC_USERNAME",passwordEnv:"TEST_PLC_PASSWORD"}}
},process.cwd()+"/config.ts");
const [operation,options]=process.argv.slice(2);
if(process.env.TEST_MISSING_ONLINE) delete config.online;
if(process.env.TEST_MISSING_DOCKER) delete config.docker;
if(process.env.TEST_MISSING_SOURCES) {
 config.sourceDir=process.cwd()+"/unavailable-sources";
 config.libraries=[{title:"Unavailable",path:process.cwd()+"/unavailable.library",sha256:"a".repeat(64)}];
}
const result=operation==="inspect" ? await inspectController(config,JSON.parse(options).read) : await updateController(config,operation,JSON.parse(options));
console.log("CONTROLLER_RESULT="+JSON.stringify(result));
`,
  );
  await writeFile(
    resolve(root, "bin/docker"),
    `#!${process.execPath}
import {createHash} from "node:crypto";
import {readFile,writeFile,mkdir,appendFile} from "node:fs/promises";
const args=process.argv.slice(2);
const mode=process.env.TEST_DOCKER_MODE;
const imageId=${JSON.stringify(imageId)};
await appendFile(process.env.TEST_DOCKER_CALLS,JSON.stringify(args)+"\\n");
if(args[0]==="image") {
 if(mode==="bad-image") console.log("mutable-tag");
 else if(mode==="inspect-failure") process.exit(23);
 else console.log(imageId);
 process.exit(0);
}
const mounts=args.filter((value,index)=>args[index-1]==="--mount");
const source=(target)=>{
 const mount=mounts.find(value=>value.includes("target="+target+",") || value.endsWith("target="+target));
 return /"source=((?:[^"]|"")*)"/.exec(mount)[1].replaceAll('""','"');
};
const input=source("/input"), output=source("/output");
if(process.env.TEST_DOCKER_LOG) console.log("controller runner progress");
const request=JSON.parse(await readFile(input+"/config.json","utf8"));
await writeFile(process.env.TEST_DOCKER_RECORD,JSON.stringify({args,input,request}));
await mkdir(output+"/.codesys/controller",{recursive:true});
await writeFile(output+"/.codesys/controller/diagnostics.log","preserved container diagnostics");
if(mode==="run-failure") process.exit(17);
if(mode==="missing-receipt") process.exit(0);
const option=(name)=>args[args.indexOf(name)+1];
const receipt={
 schemaVersion:1,operationId:option("--operation-id"),operation:args[args.indexOf(imageId)+1],
 imageId:option("--image-id"),templateHash:createHash("sha256").update(await readFile(source("/template.project"))).digest("hex"),
 target:{network:request.online.network,gateway:request.online.gateway,device:request.online.device},
 generation:"generation-001",application:"Application",applicationGuid:"application-guid",
 controllerIds:{codeId:"code-id",dataId:"data-id"},state:"run",values:{"Main.counter":"42"}
};

if(mode==="stale") receipt.operationId="00000000-0000-4000-8000-000000000000";
if(mode==="wrong-image") receipt.imageId="sha256:"+"b".repeat(64);
if(mode==="wrong-template") receipt.templateHash="b".repeat(64);
if(mode==="wrong-target") receipt.target.device.host="other-controller.test";
if(mode==="wrong-operation") receipt.operation="download";
if(mode==="invalid-values") receipt.values={counter:42};
await writeFile(output+"/.codesys/controller/result.json",JSON.stringify(receipt));
`,
    { mode: 0o755 },
  );
  const record = resolve(root, "record.json");
  const calls = resolve(root, "calls.jsonl");
  return {
    root,
    async run(
      operation = "online-change",
      options: Record<string, unknown> = {},
      environment: Record<string, string | undefined> = {},
    ) {
      return execute(
        process.execPath,
        [resolve(root, "probe.ts"), operation, JSON.stringify(options)],
        {
          cwd: root,
          env: {
            ...process.env,
            PATH: `${resolve(root, "bin")}:${process.env["PATH"]}`,
            TEST_PLC_USERNAME: "synthetic-user-secret",
            TEST_PLC_PASSWORD: "synthetic-password-secret",
            TEST_DOCKER_RECORD: record,
            TEST_DOCKER_CALLS: calls,
            ...environment,
          },
        },
      );
    },
    async recorded() {
      return JSON.parse(await readFile(record, "utf8"));
    },
    async calls() {
      return (await readFile(calls, "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
    },
    async cleanup() {
      await rm(root, { recursive: true, force: true });
    },
  };
};

it("inspection does not mount sources or libraries and routes container logs away from JSON stdout", async () => {
  const test = await fixture();
  try {
    const result = await test.run(
      "inspect",
      {},
      { TEST_MISSING_SOURCES: "1", TEST_DOCKER_LOG: "1", VPLC_LOG_STDERR: "1" },
    );
    expect(result.stdout).toStartWith("CONTROLLER_RESULT=");
    expect(result.stdout).not.toContain("controller runner progress");
    expect(result.stderr).toContain("controller runner progress");
    const record = await test.recorded();
    expect(record.args.some((value: string) => value.includes("target=/sources"))).toBe(false);
    expect(record.request.libraries).toEqual([]);
  } finally {
    await test.cleanup();
  }
});

it("pins the Docker image, forwards credential names and validates the controller receipt", async () => {
  const test = await fixture();
  try {
    const result = await test.run("online-change", {
      initializeUser: true,
      read: ["Main.counter"],
    });
    expect(result.stdout).toContain('"Main.counter":"42"');
    const calls = await test.calls();
    expect(calls[0]).toEqual(["image", "inspect", "--format", "{{.Id}}", "builder:mutable-tag"]);
    const record = await test.recorded();
    expect(record.args).toContain(imageId);
    expect(record.args).not.toContain("builder:mutable-tag");
    expect(record.args).toContain("--init");
    expect(
      record.args.slice(
        record.args.indexOf("--cpuset-cpus"),
        record.args.indexOf("--cpuset-cpus") + 2,
      ),
    ).toEqual(["--cpuset-cpus", "0-1"]);
    expect(
      record.args.slice(record.args.indexOf("--network"), record.args.indexOf("--network") + 2),
    ).toEqual(["--network", "controller-net"]);
    expect(record.args).toContain("--initialize-user");
    expect(
      record.args.slice(record.args.indexOf("--read"), record.args.indexOf("--read") + 2),
    ).toEqual(["--read", '["Main.counter"]']);
    expect(
      record.args.filter((_value: string, index: number) => record.args[index - 1] === "--env"),
    ).toEqual(["TEST_PLC_USERNAME", "TEST_PLC_PASSWORD"]);
    expect(JSON.stringify(record)).not.toContain("synthetic-user-secret");
    expect(JSON.stringify(record)).not.toContain("synthetic-password-secret");
    expect(record.request.sourceDir).toBe("/sources");
    expect(record.request.entry).toBe("/sources/domain/Main.st");
    expect(record.request.template).toBe("/template.project");
    expect(record.request.outDir).toBe("/output");
    expect(record.request.configFile).toBeUndefined();
    expect(record.request.docker).toBeUndefined();
    expect(record.request.runtime).toBeUndefined();
    expect(record.request.online.gateway.port).toBe(1217);
    expect(record.request.online.device.port).toBe(11740);
    await expect(readFile(resolve(record.input, "config.json"))).rejects.toThrow();
  } finally {
    await test.cleanup();
  }
});

it.each(["stale", "wrong-image", "wrong-template", "wrong-target", "wrong-operation"])(
  "rejects a %s receipt and preserves diagnostics",
  async (mode) => {
    const test = await fixture();
    try {
      await expect(test.run("online-change", {}, { TEST_DOCKER_MODE: mode })).rejects.toThrow(
        "Controller receipt does not match",
      );
      const record = await test.recorded();
      await expect(readFile(resolve(record.input, "config.json"))).rejects.toThrow();
      expect(
        await readFile(resolve(test.root, "build/.codesys/controller/diagnostics.log"), "utf8"),
      ).toBe("preserved container diagnostics");
    } finally {
      await test.cleanup();
    }
  },
);

it.each(["run-failure", "missing-receipt", "invalid-values"])(
  "cleans transient requests after %s without altering the baseline",
  async (mode) => {
    const test = await fixture();
    try {
      const baseline = resolve(test.root, "build/.codesys/controller/baseline.json");
      await mkdir(resolve(test.root, "build/.codesys/controller"), {
        recursive: true,
      });
      await writeFile(baseline, "existing immutable baseline");
      await expect(test.run("online-change", {}, { TEST_DOCKER_MODE: mode })).rejects.toThrow(
        mode === "run-failure"
          ? "Docker controller operation failed (17)"
          : "Docker did not produce a valid controller receipt",
      );
      const record = await test.recorded();
      expect(record.args).toContain("online-change");
      expect(record.args).not.toContain("download");
      expect((await test.calls()).filter((args: string[]) => args[0] === "run")).toHaveLength(1);
      await expect(readFile(resolve(record.input, "config.json"))).rejects.toThrow();
      expect(await readFile(baseline, "utf8")).toBe("existing immutable baseline");
    } finally {
      await test.cleanup();
    }
  },
);

it("inspects the baseline generation without user initialization", async () => {
  const test = await fixture();
  try {
    const result = await test.run("inspect", { read: ["Main.counter"] });
    expect(result.stdout).toContain('"generation":"generation-001"');
    const record = await test.recorded();
    expect(record.args).toContain("inspect");
    expect(record.args).not.toContain("--initialize-user");
  } finally {
    await test.cleanup();
  }
});

it.each([
  { TEST_MISSING_ONLINE: "1" },
  { TEST_MISSING_DOCKER: "1" },
  { TEST_PLC_PASSWORD: undefined },
  { TEST_DOCKER_MODE: "inspect-failure" },
  { TEST_DOCKER_MODE: "bad-image" },
])(
  "rejects missing configuration, credentials or an unpinned image before running a container: %j",
  async (environment) => {
    const test = await fixture();
    try {
      await expect(test.run("online-change", {}, environment)).rejects.toThrow();
      await expect(test.recorded()).rejects.toThrow();
    } finally {
      await test.cleanup();
    }
  },
);
