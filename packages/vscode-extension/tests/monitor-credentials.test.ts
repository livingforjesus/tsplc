import { expect, test } from "bun:test";
import { vplcConfigSchema } from "@vplc/config/schema";
import { monitorPassword, monitorPasswordKey } from "../src/monitor-credentials.ts";

function monitor(settings: { username?: string; passwordEnv?: string } = {}) {
  return vplcConfigSchema.parse({
    backend: "codesys",
    monitor: { endpoint: "opc.tcp://fixture:4840", ...settings },
  }).monitor!;
}

function storage() {
  const values = new Map<string, string>();
  return {
    values,
    get: async (key: string) => values.get(key),
    store: async (key: string, value: string) => {
      values.set(key, value);
    },
  };
}

test("anonymous and environment credentials never prompt or save a password", async () => {
  const secrets = storage();
  let prompts = 0;
  const prompt = async () => {
    prompts++;
    return "unused";
  };
  expect(await monitorPassword(monitor(), secrets, prompt)).toBeUndefined();
  expect(
    await monitorPassword(
      monitor({ username: "reader", passwordEnv: "PLC_PASSWORD" }),
      secrets,
      prompt,
      {
        PLC_PASSWORD: "fixture-secret",
      },
    ),
  ).toBe("fixture-secret");
  expect(prompts).toBe(0);
  expect(secrets.values.size).toBe(0);
  await expect(
    monitorPassword(
      monitor({ username: "reader", passwordEnv: "PLC_PASSWORD" }),
      secrets,
      prompt,
      {},
    ),
  ).rejects.toThrow("Environment variable PLC_PASSWORD is not set in VS Code.");
});

test("a masked password prompt saves only in SecretStorage and reuses the endpoint/user entry", async () => {
  const config = monitor({ username: "reader" });
  const secrets = storage();
  let prompts = 0;
  const prompt: Parameters<typeof monitorPassword>[2] = async (options) => {
    prompts++;
    expect(options.password).toBe(true);
    expect(options.prompt).toContain("reader at opc.tcp://fixture:4840");
    expect(options.prompt).toContain("SecretStorage");
    return "fixture-secret";
  };
  expect(await monitorPassword(config, secrets, prompt)).toBe("fixture-secret");
  expect(await monitorPassword(config, secrets, prompt)).toBe("fixture-secret");
  expect(prompts).toBe(1);
  expect(secrets.values.get(monitorPasswordKey(config.endpoint, "reader"))).toBe("fixture-secret");
  expect(JSON.stringify(config)).not.toContain("fixture-secret");
  expect(monitorPasswordKey(config.endpoint, "other")).not.toBe(
    monitorPasswordKey(config.endpoint, "reader"),
  );
  expect(monitorPasswordKey("opc.tcp://other:4840", "reader")).not.toBe(
    monitorPasswordKey(config.endpoint, "reader"),
  );
});

test("cancelling the password prompt cancels connection without caching an empty password", async () => {
  const secrets = storage();
  expect(
    await monitorPassword(monitor({ username: "reader" }), secrets, async () => undefined),
  ).toBeNull();
  expect(secrets.values.size).toBe(0);
});
