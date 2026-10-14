import { expect, test } from "bun:test";
import { vplcConfigSchema } from "./schema.ts";

const monitor = (settings: Record<string, unknown>) =>
  vplcConfigSchema.parse({
    backend: "codesys",
    monitor: { endpoint: "opc.tcp://plc.test:4840", ...settings },
  }).monitor!;

test("monitoring defaults to encrypted sessions and an explicit certificate trust store", () => {
  expect(monitor({})).toMatchObject({
    securityMode: "SignAndEncrypt",
    securityPolicy: "Basic256Sha256",
    certificateDirectory: ".vplc/opcua-pki",
  });
  expect(monitor({ securityMode: "None" })).toMatchObject({
    securityMode: "None",
    securityPolicy: "None",
  });
  expect(monitor({ username: "operator", passwordEnv: "OPCUA_PASSWORD" }).passwordEnv).toBe(
    "OPCUA_PASSWORD",
  );
});

test("monitoring refuses incompatible security and plaintext stored passwords", () => {
  for (const settings of [
    { username: "operator", password: "synthetic" },
    { securityMode: "None", username: "operator" },
    { securityMode: "SignAndEncrypt", securityPolicy: "None" },
    { securityMode: "None", securityPolicy: "Basic256Sha256" },
    { passwordEnv: "OPCUA_PASSWORD" },
  ])
    expect(() => monitor(settings)).toThrow();
});
